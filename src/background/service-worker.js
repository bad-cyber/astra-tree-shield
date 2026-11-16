/* service-worker.js — Astra · Древо Щит · v0.6.1
   Обновление v0.6.1: B27 — кэш пула доменов (cachedAdblockDomains), таймаут 25 сек,
   резервные зеркала списков и сброс ошибки при частичном успехе.
*/
import { FiltersEngine, Request } from '../../vendor/adblocker.bundle.js';
import {
  loadConfig, getHostname, checkBrandSimilarity,
  WHITELIST_DOMAINS, isHostInList
} from '../shared/config.js';
import { fetchThreatFeeds } from '../shared/reputation.js';

const tabState = new Map();
const tabAnalysis = new Map();
let stats = { blocked: 0, threatsToday: 0, lastReset: Date.now() };
const NOTIFY_ICON = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

// Накопительная статистика экономии трафика
const ESTIMATED_BYTES_BY_TYPE = {
  sub_frame: 85000,
  script: 48000,
  image: 35000,
  stylesheet: 24000,
  xmlhttprequest: 12000,
  fetch: 12000,
  ping: 2048,
  other: 8192,
};
let trafficStatsCache = null;
let trafficFlushTimer = null;

async function recordTrafficSaved(bytesDelta, reqDelta = 0, domDelta = 0) {
  if (!trafficStatsCache) {
    const stored = await chrome.storage.local.get('trafficStats');
    trafficStatsCache = stored.trafficStats || {
      savedBytes: 0,
      blockedRequests: 0,
      blockedDom: 0,
      since: Date.now(),
    };
  }
  trafficStatsCache.savedBytes += bytesDelta;
  trafficStatsCache.blockedRequests += reqDelta;
  trafficStatsCache.blockedDom += domDelta;

  if (!trafficFlushTimer) {
    trafficFlushTimer = setTimeout(async () => {
      trafficFlushTimer = null;
      if (trafficStatsCache) {
        await chrome.storage.local.set({ trafficStats: trafficStatsCache }).catch(() => {});
      }
    }, 2000);
  }
}

function uint8ToBase64(arr) {
  let binary = '';
  const len = arr.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(arr[i]);
  }
  return btoa(binary);
}

function base64ToUint8(base64) {
  const binary_string = atob(base64);
  const len = binary_string.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary_string.charCodeAt(i);
  }
  return bytes;
}

const ENGINE_CACHE_KEY = 'astra_adblocker_engine_v2';
const CACHED_DOMAINS_KEY = 'cachedAdblockDomains';
const FETCH_TIMEOUT_MS = 25000;

function makeMirrorUrl(host, path) {
  return `https://${host}/${path}`;
}

const FILTER_MIRROR_GROUPS = [
  [
    makeMirrorUrl('easylist.to', 'easylist/easylist.txt'),
    makeMirrorUrl('cdn.jsdelivr.net', 'gh/easylist/easylist@gh-pages/easylist.txt'),
    makeMirrorUrl('fastly.jsdelivr.net', 'gh/easylist/easylist@gh-pages/easylist.txt'),
  ],
  [
    makeMirrorUrl('easylist-downloads.adblockplus.org', 'ruadlist+easylist.txt'),
    makeMirrorUrl('://githubusercontent.com', 'AdguardTeam/FiltersRegistry/master/filters/filter_1_Russian/filter.txt'),
    makeMirrorUrl('cdn.jsdelivr.net', 'gh/AdguardTeam/FiltersRegistry@master/filters/filter_1_Russian/filter.txt'),
  ],
];

async function fetchFromMirrorGroup(mirrors, userAgent = 'Astra-Browser-Extension/0.6.1') {
  let lastError = null;
  for (const url of mirrors) {
    try {
      const resp = await fetch(url, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: { 'User-Agent': userAgent },
        cache: 'no-store',
      });
      if (!resp.ok) {
        lastError = new Error(`HTTP ${resp.status}`);
        continue;
      }
      const text = await resp.text();
      if (text && text.length >= 100) {
        return { text, url, error: null };
      }
      lastError = new Error('Пустой ответ сервера');
    } catch (e) {
      lastError = e;
      console.warn(`[Astra] Зеркало ${url} недоступно:`, e.message);
    }
  }
  return { text: null, url: null, error: lastError };
}
let engine = null;
async function getEngine() {
  if (engine) return engine;

  const stored = await chrome.storage.local.get(ENGINE_CACHE_KEY);
  if (stored[ENGINE_CACHE_KEY]) {
    try {
      const binary = base64ToUint8(stored[ENGINE_CACHE_KEY]);
      engine = FiltersEngine.deserialize(binary);
      console.log('[Astra] Движок анализатора загружен из кеша.');
      return engine;
    } catch (e) {
      console.warn('[Astra] Ошибка десериализации движка, пересобираем...', e);
      await chrome.storage.local.remove(ENGINE_CACHE_KEY);
    }
  }

  const texts = [];
  for (const group of FILTER_MIRROR_GROUPS) {
    const res = await fetchFromMirrorGroup(group, 'Astra-Browser-Extension/0.6.1');
    if (res.text) texts.push(res.text);
  }

  if (texts.length === 0) {
    console.warn('[Astra] Все списки правил недоступны, движок пуст.');
    engine = FiltersEngine.parse('');
    return engine;
  }

  engine = FiltersEngine.parse(texts.join('\n'), {
    enableCompression: true,
    loadNetworkFilters: true,
    loadCosmeticFilters: true,
  });

  const serialized = engine.serialize();
  const base64String = uint8ToBase64(serialized);
  await chrome.storage.local.set({ [ENGINE_CACHE_KEY]: base64String });
  console.log('[Astra] Движок анализатора собран и закеширован (Base64).');
  return engine;
}

chrome.webRequest.onBeforeRequest.addListener(
  async (details) => {
    if (details.tabId < 0) return;
    try {
      const eng = await getEngine();
      const req = Request.fromRawDetails({
        type: details.type,
        url: details.url,
        sourceUrl: details.initiator || '',
      });

      const { match } = eng.match(req);
      if (match) {
        const data = tabAnalysis.get(details.tabId) || { requests: [], domBlocks: [] };
        if (!data.requests.some((r) => r.url === details.url)) {
          data.requests.push({
            url: details.url,
            type: details.type,
            filter: match.toString(),
          });
          tabAnalysis.set(details.tabId, data);

          const estBytes = ESTIMATED_BYTES_BY_TYPE[details.type] || ESTIMATED_BYTES_BY_TYPE.other;
          recordTrafficSaved(estBytes, 1, 0);
        }
      }
    } catch (e) {
      // Игнорируем ошибки парсинга отдельных запросов (например, data:)
    }
  },
  { urls: ['<all_urls>'] }
);

chrome.tabs.onRemoved.addListener((id) => {
  tabState.delete(id);
  tabAnalysis.delete(id);
  chrome.storage.session.remove(`metrics_${id}`).catch(() => {});
});

const ID_RANGES = {
  USER_BLOCKLIST: { min: 10000,   max: 19999   },
  ADBLOCK_LIST:   { min: 100000,  max: 599999  },
  HARDCODED:      { min: 200000,  max: 209999  },
  URL_PATTERNS:   { min: 300000,  max: 309999  },
};

const BASE_ADBLOCK_DOMAINS = [
  'yandex.ru/an', 'an.yandex.ru', 'yabs.yandex.ru', 'awaps.yandex.ru',
  '://vk.com', 'ads.vk.ru', 'ad.mail.ru', 'r.mail.ru', 'top-fwz1.mail.ru',
  '://googlesyndication.com', 'googlesyndication.com', 'googleadservices.com', '://google.com',
  'adfox.ru', 'adriver.ru', 'doubleclick.net', 'criteo.com', 'criteo.net',
  'taboola.com', 'outbrain.com', 'mytarget.ru', 'adnxs.com', 'adsrvr.org',
  'smartadserver.com', 'rubiconproject.com', 'pubmatic.com', 'openx.net',
  'casalemedia.com', 'adcolony.com', 'applovin.com', '://unity3d.com',
  'vungle.com', 'chartboost.com', 'ironsrc.com', 'supersonicads.com',
  'adform.net', 'flashtalking.com', 'serving-sys.com', 'sizmek.com',
  'media.net', 'yieldmo.com', 'sharethrough.com', 'teads.tv',
];
let isUpdatingDb = false;

const HARDCODED_AD_RULES = [
  { url: '||yandex.ru/an',           types: ['script', 'sub_frame', 'xmlhttprequest', 'image'] },
  { url: '||an.yandex.ru^',          types: ['script', 'sub_frame', 'xmlhttprequest', 'image'] },
  { url: '||yabs.yandex.ru^',        types: ['script', 'xmlhttprequest', 'image'] },
  { url: '||awaps.yandex.ru^',       types: ['script', 'xmlhttprequest', 'image'] },
  { url: '||advertising.yandex.ru^', types: ['script', 'xmlhttprequest', 'image', 'sub_frame'] },
  { url: '||://vk.com^',            types: ['script', 'sub_frame', 'xmlhttprequest', 'image'] },
  { url: '||ads.vk.ru^',             types: ['script', 'sub_frame', 'xmlhttprequest', 'image'] },
  { url: '||ad.mail.ru^',            types: ['script', 'sub_frame', 'xmlhttprequest', 'image'] },
  { url: '||r.mail.ru^',             types: ['script', 'xmlhttprequest', 'image', 'ping'] },
  { url: '||top-fwz1.mail.ru^',      types: ['script', 'xmlhttprequest', 'image', 'ping'] },
  { url: '||://googlesyndication.com^', types: ['script', 'sub_frame', 'xmlhttprequest', 'image'] },
  { url: '||googlesyndication.com^', types: ['script', 'sub_frame', 'xmlhttprequest', 'image'] },
  { url: '||googleadservices.com^',  types: ['script', 'sub_frame', 'xmlhttprequest', 'image'] },
  { url: '||://google.com^',  types: ['script', 'sub_frame', 'xmlhttprequest'] },
  { url: '||adfox.ru^',              types: ['script', 'sub_frame', 'xmlhttprequest', 'image'] },
  { url: '||adriver.ru^',            types: ['script', 'sub_frame', 'xmlhttprequest', 'image'] },
  { url: '||doubleclick.net^',       types: ['script', 'sub_frame', 'xmlhttprequest', 'image'] },
  { url: '||criteo.com^',            types: ['script', 'sub_frame', 'xmlhttprequest', 'image'] },
  { url: '||criteo.net^',            types: ['script', 'sub_frame', 'xmlhttprequest', 'image'] },
  { url: '||taboola.com^',           types: ['script', 'sub_frame', 'xmlhttprequest', 'image'] },
  { url: '||outbrain.com^',          types: ['script', 'sub_frame', 'xmlhttprequest', 'image'] },
];

const URL_PATTERN_RULES = [
  { urlFilter: 'erid=',           types: ['script', 'image', 'sub_frame', 'xmlhttprequest', 'ping'] },
  { urlFilter: 'adriver=',        types: ['script', 'image', 'sub_frame', 'xmlhttprequest', 'ping'] },
  { urlFilter: 'adfox=',          types: ['script', 'image', 'sub_frame', 'xmlhttprequest', 'ping'] },
  { urlFilter: 'advertising_id=', types: ['script', 'image', 'sub_frame', 'xmlhttprequest', 'ping'] },
  { urlFilter: 'gclid=',          types: ['script', 'image', 'sub_frame', 'xmlhttprequest', 'ping'] },
  { urlFilter: 'fbclid=',         types: ['script', 'image', 'sub_frame', 'xmlhttprequest', 'ping'] },
  { urlFilter: '*/banner^',       types: ['script', 'sub_frame', 'xmlhttprequest'] },
  { urlFilter: '*/banners^',      types: ['script', 'sub_frame', 'xmlhttprequest'] },
  { urlFilter: '*/advert^',       types: ['script', 'sub_frame', 'xmlhttprequest'] },
  { urlFilter: '*/adverts^',      types: ['script', 'sub_frame', 'xmlhttprequest'] },
  { urlFilter: '*/promo^',        types: ['script', 'sub_frame', 'xmlhttprequest'] },
  { urlFilter: '*/sponsor^',      types: ['script', 'sub_frame', 'xmlhttprequest'] },
];

function extractDomain(line) {
  if (!line || line.startsWith('!') || line.startsWith('[') || line.startsWith('#')) return null;
  if (line.includes('##') || line.includes('#@#')) return null;
  if (line.startsWith('@@')) return null;
  if (line.includes('$') || line.includes('/')) return null;

  const match = line.match(/^\|\|([a-zA-Z0-9.-]+)\^?$/);
  if (!match) return null;
  const d = match[1];
  if (d.length < 3 || d.includes('..') || d.startsWith('.') || d.endsWith('.')) return null;
  return d;
}

async function updateAdblockRules() {
  if (isUpdatingDb) return;
  isUpdatingDb = true;

  const domains = new Set(BASE_ADBLOCK_DOMAINS);
  let lastError = null;
  let succeededSources = 0;

  for (const group of FILTER_MIRROR_GROUPS) {
    if (domains.size >= 4450) break;
    const res = await fetchFromMirrorGroup(group, 'Astra-Browser-Extension/0.6.1');
    if (!res.text) {
      if (res.error) lastError = res.error;
      continue;
    }

    succeededSources += 1;
    for (const line of res.text.split(/\r?\n/)) {
      if (domains.size >= 4450) break;
      const d = extractDomain(line.trim());
      if (d && !domains.has(d)) {
        domains.add(d);
      }
    }
  }

  // Если хотя бы один источник сработал — сбрасываем ошибку и сохраняем пул в кэш
  if (succeededSources > 0) {
    lastError = null;
    await chrome.storage.local.set({
      [CACHED_DOMAINS_KEY]: Array.from(domains),
    }).catch(() => {});
  } else {
    // Все внешние зеркала недоступны: восстанавливаем пул из cachedAdblockDomains
    const stored = await chrome.storage.local.get(CACHED_DOMAINS_KEY);
    const cached = Array.isArray(stored[CACHED_DOMAINS_KEY]) ? stored[CACHED_DOMAINS_KEY] : [];
    if (cached.length > 0) {
      for (const d of cached) {
        if (domains.size >= 4450) break;
        domains.add(d);
      }
      console.log(`[Astra] Сеть недоступна: загружено ${domains.size} доменов из кэша.`);
    }
  }

  try {
    const newRules = [];
    let id = ID_RANGES.ADBLOCK_LIST.min;
    for (const d of domains) {
      newRules.push({
        id: id++,
        priority: 2,
        action: { type: 'block' },
        condition: {
          urlFilter: `||${d}^`,
          resourceTypes: ['script', 'image', 'xmlhttprequest', 'sub_frame', 'stylesheet', 'ping'],
        },
      });
    }

    let hid = ID_RANGES.HARDCODED.min;
    for (const r of HARDCODED_AD_RULES) {
      newRules.push({
        id: hid++,
        priority: 10,
        action: { type: 'block' },
        condition: { urlFilter: r.url, resourceTypes: r.types },
      });
    }

    let pid = ID_RANGES.URL_PATTERNS.min;
    for (const r of URL_PATTERN_RULES) {
      newRules.push({
        id: pid++,
        priority: 50,
        action: { type: 'block' },
        condition: { urlFilter: r.urlFilter, resourceTypes: r.types },
      });
    }

    const oldRules = await chrome.declarativeNetRequest.getDynamicRules();
    const toRemove = oldRules
      .filter((r) => !(r.id >= ID_RANGES.USER_BLOCKLIST.min && r.id <= ID_RANGES.USER_BLOCKLIST.max))
      .map((r) => r.id);

    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: toRemove,
      addRules: newRules,
    });

    await chrome.storage.local.set({
      lastAdblockUpdate: Date.now(),
      adblockCount: newRules.length,
      adblockStatus: lastError ? 'error' : 'ok',
      adblockError: lastError ? lastError.message : '',
    });
  } catch (e) {
    console.warn('[Astra] Ошибка применения DNR:', e.message);
    await chrome.storage.local.set({ adblockStatus: 'error', adblockError: e.message });
  } finally {
    setTimeout(() => { isUpdatingDb = false; }, 3000);
  }
}
let threatFeedSet = null;

async function getThreatSet() {
  if (threatFeedSet) return threatFeedSet;
  const { threatFeed = [] } = await chrome.storage.local.get('threatFeed');
  threatFeedSet = new Set(threatFeed);
  return threatFeedSet;
}

async function updateThreatFeeds() {
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

async function applyUserBlocklist() {
  const { userBlocklist = [] } = await chrome.storage.local.get('userBlocklist');
  const newRules = userBlocklist.slice(0, 500).map((domain, i) => ({
    id: ID_RANGES.USER_BLOCKLIST.min + i,
    priority: 100,
    action: { type: 'block' },
    condition: { urlFilter: `||${domain}^` },
  }));

  const oldRules = await chrome.declarativeNetRequest.getDynamicRules();
  const oldIds = oldRules
    .filter((r) => r.id >= ID_RANGES.USER_BLOCKLIST.min && r.id <= ID_RANGES.USER_BLOCKLIST.max)
    .map((r) => r.id);

  try {
    await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: oldIds, addRules: newRules });
  } catch (e) {
    console.warn('[Astra] applyUserBlocklist:', e);
  }
}

chrome.runtime.onInstalled.addListener(async () => {
  const cfg = await loadConfig();
  await chrome.storage.sync.set({ config: cfg });
  await resetDailyStatsIfNeeded();
  chrome.alarms.create('updateFilters', { periodInMinutes: 1440 });
  chrome.alarms.create('updateThreats', { periodInMinutes: 360 });
  updateAdblockRules();
  updateThreatFeeds();
  applyUserBlocklist();
  getEngine();
});

chrome.runtime.onStartup.addListener(() => {
  applyUserBlocklist();
  updateAdblockRules();
  getEngine();
  chrome.storage.local.get('threatFeedUpdated').then(({ threatFeedUpdated = 0 }) => {
    if (Date.now() - threatFeedUpdated > 12 * 3600 * 1000) updateThreatFeeds();
  });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'updateFilters') updateAdblockRules();
  if (alarm.name === 'updateThreats') updateThreatFeeds();
});

function safeSetBadge(tabId, text, color) {
  if (!tabId) return;
  chrome.action.setBadgeText({ tabId, text }).catch(() => {});
  chrome.action.setBadgeBackgroundColor({ tabId, color }).catch(() => {});
}

function safeNotify(title, message) {
  try {
    chrome.notifications
      .create({ type: 'basic', iconUrl: NOTIFY_ICON, title, message, priority: 2 })
      .catch(() => {});
  } catch {}
}

async function resetDailyStatsIfNeeded() {
  const stored = (await chrome.storage.local.get('stats')).stats;
  if (stored) stats = stored;
  const now = Date.now();
  if (!stats.lastReset || now - stats.lastReset > 86400000) {
    stats.threatsToday = 0;
    stats.lastReset = now;
    await chrome.storage.local.set({ stats });
  }
}

async function bumpStats(blockedDelta = 0, threat = false) {
  const stored = (await chrome.storage.local.get('stats')).stats;
  if (stored) stats = stored;
  stats.blocked += blockedDelta;
  if (threat) stats.threatsToday += 1;
  await chrome.storage.local.set({ stats });
}

async function getDomainAge(hostname) {
  const tld = hostname.split('.').pop();
  if (['ru', 'рф', 'su', 'by', 'kz'].includes(tld)) return { supported: false };

  const { domainAgeCache = {} } = await chrome.storage.local.get('domainAgeCache');
  const cached = domainAgeCache[hostname];
  if (cached && Date.now() - cached.ts < 86400000) {
    return { supported: cached.supported, ageDays: cached.ageDays, registered: cached.registered };
  }

  try {
    const rdapUrl = makeMirrorUrl('rdap.org', `domain/${encodeURIComponent(hostname)}`);
    const resp = await fetch(rdapUrl, {
      headers: { Accept: 'application/rdap+json' },
      signal: AbortSignal.timeout(4000),
    });
    if (!resp.ok) {
      const neg = { supported: false, ts: Date.now() };
      domainAgeCache[hostname] = neg;
      await saveDomainCache(domainAgeCache);
      return { supported: false };
    }
    const data = await resp.json();
    const reg = (data.events || []).find((e) => e.eventAction === 'registration');
    if (!reg) return { supported: false };
    const ageDays = Math.floor((Date.now() - new Date(reg.eventDate).getTime()) / 86400000);
    const result = { supported: true, ageDays, registered: reg.eventDate, ts: Date.now() };
    domainAgeCache[hostname] = result;
    await saveDomainCache(domainAgeCache);
    return { supported: true, ageDays, registered: reg.eventDate };
  } catch {
    return { supported: false };
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

chrome.webNavigation.onCommitted.addListener(async (details) => {
  if (details.frameId !== 0 || !details.tabId) return;
  tabAnalysis.delete(details.tabId);
  const cfg = await loadConfig();
  if (!cfg.enabled) return;

  const host = getHostname(details.url);
  const reasons = [];
  let risk = 'ok';

  const { userWhitelist = [] } = await chrome.storage.local.get('userWhitelist');
  const isUserWL = isHostInList(host, userWhitelist);
  const isGlobalWL = isHostInList(host, WHITELIST_DOMAINS);

  if (!isUserWL && !isGlobalWL) {
    if (cfg.modules.phishing) {
      const sim = checkBrandSimilarity(host);
      if (sim.matched && !sim.exact) {
        risk = 'danger';
        reasons.push(sim.reason || `Домен похож на «${sim.target}»`);
      }

      const threatSet = await getThreatSet();
      if (threatSet.has(host)) {
        risk = 'danger';
        reasons.push('Домен в базе фишинга');
      }

      const age = await getDomainAge(host);
      if (age.supported && age.ageDays < 30) {
        if (risk === 'ok') risk = 'warn';
        reasons.push(`Домен зарегистрирован ${age.ageDays} дн. назад`);
      }
      const cur = tabState.get(details.tabId) || {};
      tabState.set(details.tabId, { ...cur, host, age });
    }
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId: details.tabId },
      world: 'MAIN',
      files: ['src/content/main-world-hooks.js'],
    });
  } catch {}

  const prev = tabState.get(details.tabId) || {};
  const next = { ...prev, host, risk: reasons.length ? risk : prev.risk || 'ok', reasons };
  tabState.set(details.tabId, next);

  const colors = { ok: '#2e7d32', warn: '#c9b07b', danger: '#d32f2f' };
  const texts  = { ok: 'OK', warn: '!', danger: 'X' };
  safeSetBadge(details.tabId, texts[next.risk], colors[next.risk]);

  if (next.risk === 'danger' && cfg.modules.phishing) {
    await bumpStats(0, true);
    safeNotify('Astra: Опасный сайт!', `Угроза на ${host}. ${reasons.join('; ') || ''}`);
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    if (msg.type === 'GET_TAB_STATUS') {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab || !tab.id) return sendResponse({ error: 'no tab' });
      const st = tabState.get(tab.id) || { host: getHostname(tab.url), risk: 'ok', reasons: [] };
      await resetDailyStatsIfNeeded();
      const storage = await chrome.storage.local.get([
        'lastAdblockUpdate', 'adblockCount', 'userBlocklist', 'userWhitelist', 'trafficStats',
      ]);
      return sendResponse({ status: st, stats, adblock: storage });
    }

    if (msg.type === 'FORCE_UPDATE_DB') {
      await Promise.all([updateAdblockRules(), updateThreatFeeds()]);
      return sendResponse({ ok: true });
    }

    if (msg.type === 'APPLY_USER_BLOCKLIST') {
      await applyUserBlocklist();
      return sendResponse({ ok: true });
    }

    if (msg.type === 'RESET_TRAFFIC_STATS') {
      trafficStatsCache = {
        savedBytes: 0,
        blockedRequests: 0,
        blockedDom: 0,
        since: Date.now(),
      };
      await chrome.storage.local.set({ trafficStats: trafficStatsCache });
      return sendResponse({ ok: true });
    }

    if (msg.type === 'TOGGLE_BLOCK_SITE') {
      const { userBlocklist = [] } = await chrome.storage.local.get('userBlocklist');
      const { userWhitelist = [] } = await chrome.storage.local.get('userWhitelist');
      let newList, isBlockedNow = false;
      if (userBlocklist.includes(msg.host)) {
        newList = userBlocklist.filter((h) => h !== msg.host);
      } else {
        newList = [...userBlocklist, msg.host];
        isBlockedNow = true;
      }
      const newWL = isBlockedNow ? userWhitelist.filter((h) => h !== msg.host) : userWhitelist;
      await chrome.storage.local.set({ userBlocklist: newList, userWhitelist: newWL });
      await applyUserBlocklist();
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (isBlockedNow && tab?.id) chrome.tabs.reload(tab.id);
      return sendResponse({ blocked: isBlockedNow });
    }

    if (msg.type === 'TOGGLE_WHITELIST') {
      const { userWhitelist = [] } = await chrome.storage.local.get('userWhitelist');
      const { userBlocklist = [] } = await chrome.storage.local.get('userBlocklist');
      let newList, isWLNow = false;
      if (userWhitelist.includes(msg.host)) {
        newList = userWhitelist.filter((h) => h !== msg.host);
      } else {
        newList = [...userWhitelist, msg.host];
        isWLNow = true;
      }
      const newBL = isWLNow ? userBlocklist.filter((h) => h !== msg.host) : userBlocklist;
      await chrome.storage.local.set({ userWhitelist: newList, userBlocklist: newBL });
      await applyUserBlocklist();
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id) chrome.tabs.reload(tab.id);
      return sendResponse({ whitelisted: isWLNow });
    }
    if (msg.type === 'CHECK_URL') {
      const url = msg.url;
      const host = getHostname(url);
      const reasons = [];
      let risk = 'ok';

      if (isHostInList(host, WHITELIST_DOMAINS)) {
        return sendResponse({ risk: 'safe', host, reasons: ['Домен в белом списке.'] });
      }
      const { userBlocklist = [], userWhitelist = [] } = await chrome.storage.local.get([
        'userBlocklist', 'userWhitelist',
      ]);
      if (isHostInList(host, userBlocklist)) {
        return sendResponse({ risk: 'danger', host, reasons: ['Сайт в личном чёрном списке.'] });
      }
      if (isHostInList(host, userWhitelist)) {
        return sendResponse({ risk: 'safe', host, reasons: ['Сайт в вашем белом списке.'] });
      }

      const sim = checkBrandSimilarity(host);
      if (sim.matched && !sim.exact) {
        risk = 'danger';
        reasons.push(sim.reason || `Домен похож на «${sim.target}»`);
      }
      const threatSet = await getThreatSet();
      if (threatSet.has(host)) {
        risk = 'danger';
        reasons.push('Домен в базе фишинга');
      }
      const age = await getDomainAge(host);
      if (age.supported && age.ageDays < 30) {
        if (risk === 'ok') risk = 'warn';
        reasons.push(`Домен зарегистрирован ${age.ageDays} дн. назад`);
      }
      if (reasons.length === 0) reasons.push('Явных угроз не обнаружено.');
      return sendResponse({ risk, host, reasons });
    }

    if (msg.type === 'REPORT_THREAT') {
      await bumpStats(1, true);
      return sendResponse({ ok: true });
    }

    if (msg.type === 'PAGE_METRICS') {
      const tabId = sender.tab?.id;
      if (tabId) {
        await chrome.storage.session.set({ [`metrics_${tabId}`]: msg.metrics }).catch(() => {});
      }
      return sendResponse({ ok: true });
    }

    if (msg.type === 'GET_PAGE_METRICS') {
      const tabId = msg.tabId;
      if (!tabId) return sendResponse({ metrics: null });
      const key = `metrics_${tabId}`;
      const data = await chrome.storage.session.get(key).catch(() => ({}));
      return sendResponse({ metrics: data[key] || null });
    }

    if (msg.type === 'GET_COSMETIC_FILTERS') {
      const { url, ids, classes, hrefs } = msg;
      const eng = await getEngine();

      let hostname = '';
      let domain = '';
      try {
        const tempReq = Request.fromRawDetails({ url, type: 'main_frame' });
        hostname = tempReq.hostname;
        domain = tempReq.domain;
      } catch (e) {
        console.warn('[Astra] Не удалось распарсить URL для Ghostery:', url);
      }

      const cosmetic = eng.getCosmeticsFilters({
        url,
        hostname,
        domain,
        classes: new Set(classes),
        ids: new Set(ids),
        hrefs: hrefs || [],
        getBaseRules: true,
        getInjectionRules: false,
        getExtendedRules: false,
      });
      return sendResponse({ styles: cosmetic.styles || '' });
    }

    if (msg.type === 'REPORT_DOM_BLOCKS') {
      const tabId = sender.tab?.id;
      if (!tabId) return sendResponse({ ok: false });
      const data = tabAnalysis.get(tabId) || { requests: [], domBlocks: [] };
      let newlyAdded = 0;
      for (const b of (msg.blocks || [])) {
        if (!data.domBlocks.some((ex) => ex.selector === b.selector)) {
          data.domBlocks.push(b);
          newlyAdded++;
          if (data.domBlocks.length > 100) data.domBlocks.shift();
        }
      }
      if (newlyAdded > 0) {
        recordTrafficSaved(newlyAdded * 18000, 0, newlyAdded);
      }
      tabAnalysis.set(tabId, data);
      return sendResponse({ ok: true });
    }

    if (msg.type === 'GET_TAB_ANALYSIS') {
      const data = tabAnalysis.get(msg.tabId) || { requests: [], domBlocks: [] };
      return sendResponse(data);
    }
  })();
  return true;
});

const DANGEROUS_EXT = ['.exe', '.msi', '.scr', '.js', '.vbs', '.ps1', '.bat', '.cmd', '.hta', '.lnk'];

chrome.downloads.onCreated.addListener(async (item) => {
  const cfg = await loadConfig();
  if (!cfg.enabled) return;

  const name = (item.filename || item.url || '').toLowerCase();
  const isDangerous = DANGEROUS_EXT.some((ext) => name.endsWith(ext));
  if (!isDangerous) return;

  if (cfg.modules.blockDownloads) {
    try {
      await chrome.downloads.cancel(item.id);
      await chrome.downloads.erase({ id: item.id });
      safeNotify('Astra: Загрузка заблокирована', `Файл: ${name.split('/').pop()}`);
      await bumpStats(1, true);
    } catch (e) {
      safeNotify('Astra: Не удалось заблокировать', `${name.split('/').pop()}`);
    }
  } else if (cfg.modules.downloads) {
    safeNotify('Astra: Осторожно, загрузка!', `Скачивается: ${name.split('/').pop()}`);
  }
});
