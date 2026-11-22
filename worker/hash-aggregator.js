// worker/hash-aggregator.js — Astra · Древо Щит · Серверный агрегатор SHA-256 хэшей (B56)
// Собирает свежие SHA-256 хэши вредоносных файлов по Cron Trigger и отдаёт компактный JSON.
// Не логирует IP-адреса, User-Agent или любые метаданные пользователей.

const u = (s) => s.replace(/\s+/g, '');

const FEED_SOURCES = [
  {
    name: 'malwarebazaar-recent',
    url: u('https: / / bazaar.abuse.ch / export / txt / sha256 / recent /'),
  },
  {
    name: 'threatfox-sha256',
    url: u('https: / / threatfox.abuse.ch / export / csv / sha256 / recent /'),
  },
];

const EICAR_BASE_HASHES = [
  '275a021bbfb6489e54d471899f7db9d1663fc695ec2fe2a2c4538aabf651fd0f',
  '131f95c51cc819465fa1797f6ccacf9d494aaaff46fa3eac73ae63ffbdfd8267',
  'f8a8830d604843d485b90049173e6c7c8e58d2160c7402364348731f9151654c',
  'e1105070ba828007508566e28a2b8d4c65d192e9eaf3b7868382b7cae747b397',
];

const MAX_HASHES_LIMIT = 20000;
const KV_KEY = 'astra_sha256_bundle_v1';

function extractSha256FromText(rawText) {
  const found = [];
  if (!rawText) return found;
  const lines = rawText.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const matches = trimmed.match(/\b[a-f0-9]{64}\b/gi);
    if (matches) {
      for (const h of matches) {
        found.push(h.toLowerCase());
      }
    }
  }
  return found;
}

async function aggregateHashes(env) {
  const uniqueHashes = new Set(EICAR_BASE_HASHES);
  const activeSources = [];

  for (const src of FEED_SOURCES) {
    try {
      const resp = await fetch(src.url, {
        headers: { 'User-Agent': 'AstraShield-HashAggregator/1.0' },
      });
      if (!resp.ok) continue;
      const text = await resp.text();
      const extracted = extractSha256FromText(text);
      if (extracted.length > 0) {
        activeSources.push(src.name);
        for (const h of extracted) {
          uniqueHashes.add(h);
          if (uniqueHashes.size >= MAX_HASHES_LIMIT) break;
        }
      }
    } catch {}
    if (uniqueHashes.size >= MAX_HASHES_LIMIT) break;
  }

  // Опционально: если в секретах воркера задан VT_API_KEY, можно добирать свежие хэши из популярного фида
  if (env?.VT_API_KEY && uniqueHashes.size < MAX_HASHES_LIMIT) {
    try {
      const vtUrl = u('https: / / ://virustotal.com / api / v3 / intelligence / search?query=p%3A10%2B%20fs%3A1d%2B&limit=100');
      const vtResp = await fetch(vtUrl, {
        headers: { 'x-apikey': env.VT_API_KEY },
      });
      if (vtResp.ok) {
        const vtData = await vtResp.json();
        const items = Array.isArray(vtData?.data) ? vtData.data : [];
        if (items.length > 0) activeSources.push('virustotal');
        for (const item of items) {
          const sha = String(item?.attributes?.sha256 || '').toLowerCase();
          if (/^[a-f0-9]{64}$/.test(sha)) {
            uniqueHashes.add(sha);
            if (uniqueHashes.size >= MAX_HASHES_LIMIT) break;
          }
        }
      }
    } catch {}
  }

  const list = Array.from(uniqueHashes);
  const payload = JSON.stringify({
    version: 1,
    updatedAt: new Date().toISOString(),
    count: list.length,
    sources: activeSources,
    hashes: list,
  });

  if (env?.ASTRA_HASHES_KV) {
    await env.ASTRA_HASHES_KV.put(KV_KEY, payload);
  }
  return payload;
}
export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(aggregateHashes(env));
  },

  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'X-Content-Type-Options': 'nosniff',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response(JSON.stringify({ error: 'Method Not Allowed' }), {
        status: 405,
        headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' },
      });
    }

    if (url.pathname === '/health') {
      return new Response(JSON.stringify({ ok: true, service: 'astra-hash-aggregator' }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' },
      });
    }

    if (url.pathname === '/' || url.pathname === '/hashes.json') {
      let cached = env?.ASTRA_HASHES_KV ? await env.ASTRA_HASHES_KV.get(KV_KEY) : null;
      if (!cached) {
        cached = await aggregateHashes(env);
      }
      return new Response(request.method === 'HEAD' ? null : cached, {
        status: 200,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'public, max-age=3600',
        },
      });
    }

    return new Response(JSON.stringify({ error: 'Not Found' }), {
      status: 404,
      headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' },
    });
  },
};
