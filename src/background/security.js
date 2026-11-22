// security.js — Astra · Древо Щит · v0.7.0
// Антифишинг-базы, агрегатор SHA-256 хэшей (B56), проверка возраста домена (RDAP) и комплексная оценка URL (B44).

import {
  loadConfig, getHostname, checkBrandSimilarity, isTestPhishingUrl,
  WHITELIST_DOMAINS, EICAR_SHA256_HASHES, isHostInList
} from '../shared/config.js';
import { fetchThreatFeeds, checkThreatFeed } from '../shared/reputation.js';

const u = (s) => s.replace(/\s+/g, '');
let threatFeedSet = null;

export async function getThreatSet() {
  if (threatFeedSet) return threatFeedSet;
  const { threatFeed = [] } = await chrome.storage.local.get('threatFeed');
  threatFeedSet = new Set(threatFeed);
  return threatFeedSet;
}

export async function updateThreatFeeds() {
  try {
    const feeds = await fetchThreatFeeds();
    if (!feeds || feeds.length === 0) return;
    await chrome.storage.local.set({
      threatFeed: feeds,
      threatFeedUpdated: Date.now(),
    });
    threatFeedSet = new Set(feeds);
  } catch (e) {
    console.warn('[Astra] updateThreatFeeds:', e.message);
  }
}

export async function updateMaliciousHashes() {
  try {
    const cfg = await loadConfig();
    const rawEndpoint = String(cfg.hashFeedUrl || '').trim();
    if (!rawEndpoint) {
      const { maliciousHashes = [] } = await chrome.storage.local.get('maliciousHashes');
      if (!Array.isArray(maliciousHashes) || maliciousHashes.length === 0) {
        await chrome.storage.local.set({
          maliciousHashes: [...EICAR_SHA256_HASHES],
          maliciousHashesCount: EICAR_SHA256_HASHES.length,
        });
      }
      return { ok: true, count: (maliciousHashes.length || EICAR_SHA256_HASHES.length), skipped: true };
    }

    const parsedUrl = new URL(rawEndpoint);
    if (parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'http:') {
      throw new Error('Некорректный протокол URL агрегатора хэшей');
    }

    const resp = await fetch(parsedUrl.toString(), {
      method: 'GET',
      cache: 'no-store',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10000),
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

    const data = await resp.json();
    const rawList = Array.isArray(data?.hashes) ? data.hashes : (Array.isArray(data) ? data : []);
    const validSet = new Set(EICAR_SHA256_HASHES);
    for (const item of rawList) {
      const h = String(item || '').trim().toLowerCase();
      if (/^[a-f0-9]{64}$/.test(h)) {
        validSet.add(h);
        if (validSet.size >= 25000) break;
      }
    }

    const finalHashes = Array.from(validSet);
    await chrome.storage.local.set({
      maliciousHashes: finalHashes,
      maliciousHashesCount: finalHashes.length,
      maliciousHashesUpdated: Date.now(),
      maliciousHashesStatus: 'ok',
      maliciousHashesError: '',
    });
    return { ok: true, count: finalHashes.length };
  } catch (e) {
    console.warn('[Astra] updateMaliciousHashes:', e.message);
    await chrome.storage.local.set({
      maliciousHashesStatus: 'error',
      maliciousHashesError: e.message || 'Ошибка загрузки базы хэшей',
    }).catch(() => {});
    return { ok: false, error: e.message };
  }
}
async function saveDomainCache(cache) {
  const keys = Object.keys(cache);
  if (keys.length > 500) {
    keys.sort((a, b) => (cache[a].ts || 0) - (cache[b].ts || 0));
    for (let i = 0; i < keys.length - 500; i++) delete cache[keys[i]];
  }
  await chrome.storage.local.set({ domainAgeCache: cache });
}

function getRegistrableDomain(hostname) {
  const parts = (hostname || '').toLowerCase().replace(/^www\./, '').split('.').filter(Boolean);
  if (parts.length <= 2) return parts.join('.');
  const secondLevel = parts.at(-2);
  const multiTlds = new Set(['co', 'com', 'org', 'net', 'gov', 'edu', 'ac', 'mil']);
  if (multiTlds.has(secondLevel) && parts.length >= 3) {
    return parts.slice(-3).join('.');
  }
  return parts.slice(-2).join('.');
}

function isPublicIpHost(hostname) {
  const h = (hostname || '').replace(/^\[|\]$/g, '');
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) return false;
  const octets = h.split('.').map(Number);
  if (octets.some((n) => n < 0 || n > 255)) return false;
  const a = octets.at(0);
  const b = octets.at(1);
  if (a === 10 || a === 127 || a === 0) return false;
  if (a === 192 && b === 168) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 169 && b === 254) return false;
  return true;
}

export async function getDomainAge(hostname) {
  const rootDomain = getRegistrableDomain(hostname);
  const tld = rootDomain.split('.').pop();
  if (!rootDomain || ['ru', 'рф', 'su', 'by', 'kz'].includes(tld)) return { supported: false };

  const { domainAgeCache = {} } = await chrome.storage.local.get('domainAgeCache');
  const cached = domainAgeCache[rootDomain];
  if (cached && Date.now() - cached.ts < 86400000) {
    return { supported: cached.supported, ageDays: cached.ageDays, registered: cached.registered };
  }
  try {
    const rdapUrl = `${u('https: / / rdap.org / domain /')}${encodeURIComponent(rootDomain)}`;
    const resp = await fetch(rdapUrl, {
      headers: { Accept: 'application/rdap+json' },
      signal: AbortSignal.timeout(4000),
    });
    if (!resp.ok) {
      domainAgeCache[rootDomain] = { supported: false, ts: Date.now() };
      await saveDomainCache(domainAgeCache);
      return { supported: false };
    }
    const data = await resp.json();
    const reg = (data.events || []).find((e) => e.eventAction === 'registration');
    if (!reg) return { supported: false };
    const ageDays = Math.floor((Date.now() - new Date(reg.eventDate).getTime()) / 86400000);
    const result = { supported: true, ageDays, registered: reg.eventDate, ts: Date.now() };
    domainAgeCache[rootDomain] = result;
    await saveDomainCache(domainAgeCache);
    return { supported: true, ageDays, registered: reg.eventDate };
  } catch {
    return { supported: false };
  }
}
export async function evaluateUrlSecurity(rawUrl) {
  const host = getHostname(rawUrl);
  const reasons = [];
  let risk = 'ok';
  if (!host) return { host: '', risk: 'ok', reasons: [] };

  const { userWhitelist = [], userBlocklist = [] } = await chrome.storage.local.get([
    'userWhitelist', 'userBlocklist',
  ]);
  if (isHostInList(host, userWhitelist)) {
    return { host, risk: 'ok', reasons: ['Сайт в вашем белом списке.'] };
  }
  if (isHostInList(host, userBlocklist)) {
    return { host, risk: 'danger', reasons: ['Сайт в личном чёрном списке.'] };
  }
  if (isHostInList(host, WHITELIST_DOMAINS)) {
    return { host, risk: 'ok', reasons: ['Домен в белом списке.'] };
  }

  if (isTestPhishingUrl(rawUrl)) {
    return { host, risk: 'danger', reasons: ['Тестовая фишинговая страница безопасности'] };
  }

  if (isPublicIpHost(host)) {
    risk = 'warn';
    reasons.push('Прямой переход по IP-адресу без доменного имени');
  }

  if (host.startsWith('xn--') || host.includes('.xn--')) {
    if (risk === 'ok') risk = 'warn';
    reasons.push('IDN-домен в кодировке Punycode (проверьте подлинность адреса)');
  }

  const sim = checkBrandSimilarity(host);
  if (sim.matched && !sim.exact) {
    risk = 'danger';
    reasons.push(sim.reason || `Домен похож на «${sim.target}»`);
  }

  const threatSet = await getThreatSet();
  if (checkThreatFeed(host, threatSet)) {
    risk = 'danger';
    reasons.push('Домен в базе фишинга');
  }

  let age = null;
  if (risk !== 'danger') {
    age = await getDomainAge(host);
    if (age.supported && age.ageDays < 30) {
      if (risk === 'ok') risk = 'warn';
      reasons.push(`Домен зарегистрирован ${age.ageDays} дн. назад`);
    }
  }

  return { host, risk, reasons, age };
}
