// adblock-engine.js — Astra · Древо Щит · v0.6.3
// Движок @ghostery/adblocker, загрузка списков фильтров и управление правилами DNR.

import { FiltersEngine } from '../../vendor/adblocker.bundle.js';
import { loadConfig } from '../shared/config.js';

const ENGINE_CACHE_KEY = 'astra_adblocker_engine_v2';
const CACHED_DOMAINS_KEY = 'cachedAdblockDomains';
const FETCH_TIMEOUT_MS = 25000;
const u = (s) => s.replace(/\s+/g, '');

export const ID_RANGES = {
  USER_BLOCKLIST: { min: 10000,   max: 19999   },
  ADBLOCK_LIST:   { min: 100000,  max: 599999  },
  HARDCODED:      { min: 200000,  max: 209999  },
  URL_PATTERNS:   { min: 300000,  max: 309999  },
};

const FILTER_MIRROR_GROUPS = [
  [
    u('https: / / easylist.to / easylist / easylist.txt'),
    u('https: / / cdn.jsdelivr.net / gh / easylist / easylist@master / easylist / easylist_adservers.txt'),
    u('https: / / fastly.jsdelivr.net / gh / easylist / easylist@master / easylist / easylist_adservers.txt'),
  ],
  [
    u('https: / / easylist-downloads.adblockplus.org / ruadlist+easylist.txt'),
    u('https: / / ://githubusercontent.com / Dimisa / ruadlist / master / ruadlist.txt'),
    u('https: / / cdn.jsdelivr.net / gh / Dimisa / ruadlist@master / ruadlist.txt'),
  ],
];

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

const HARDCODED_AD_RULES = [
  { url: '||yandex.ru/an',                types: ['script', 'sub_frame', 'xmlhttprequest', 'image'] },
  { url: '||an.yandex.ru^',               types: ['script', 'sub_frame', 'xmlhttprequest', 'image'] },
  { url: '||yabs.yandex.ru^',             types: ['script', 'xmlhttprequest', 'image'] },
  { url: '||awaps.yandex.ru^',            types: ['script', 'xmlhttprequest', 'image'] },
  { url: '||advertising.yandex.ru^',      types: ['script', 'xmlhttprequest', 'image', 'sub_frame'] },
  { url: '||://vk.com^',                 types: ['script', 'sub_frame', 'xmlhttprequest', 'image'] },
  { url: '||ads.vk.ru^',                  types: ['script', 'sub_frame', 'xmlhttprequest', 'image'] },
  { url: '||ad.mail.ru^',                 types: ['script', 'sub_frame', 'xmlhttprequest', 'image'] },
  { url: '||r.mail.ru^',                  types: ['script', 'xmlhttprequest', 'image', 'ping'] },
  { url: '||top-fwz1.mail.ru^',           types: ['script', 'xmlhttprequest', 'image', 'ping'] },
  { url: '||://googlesyndication.com^', types: ['script', 'sub_frame', 'xmlhttprequest', 'image'] },
  { url: '||googlesyndication.com^',      types: ['script', 'sub_frame', 'xmlhttprequest', 'image'] },
  { url: '||googleadservices.com^',       types: ['script', 'sub_frame', 'xmlhttprequest', 'image'] },
  { url: '||://google.com^',       types: ['script', 'sub_frame', 'xmlhttprequest'] },
  { url: '||adfox.ru^',                   types: ['script', 'sub_frame', 'xmlhttprequest', 'image'] },
  { url: '||adriver.ru^',                 types: ['script', 'sub_frame', 'xmlhttprequest', 'image'] },
  { url: '||doubleclick.net^',            types: ['script', 'sub_frame', 'xmlhttprequest', 'image'] },
  { url: '||criteo.com^',                 types: ['script', 'sub_frame', 'xmlhttprequest', 'image'] },
  { url: '||criteo.net^',                 types: ['script', 'sub_frame', 'xmlhttprequest', 'image'] },
  { url: '||taboola.com^',                types: ['script', 'sub_frame', 'xmlhttprequest', 'image'] },
  { url: '||outbrain.com^',               types: ['script', 'sub_frame', 'xmlhttprequest', 'image'] },
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

let engine = null;
let isUpdatingDb = false;

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

async function fetchFromMirrorGroup(mirrors, userAgent = 'Astra-Browser-Extension/0.6.3') {
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
      if (text && text.length >= 100 && !/^\s*<!doctype\s+html/i.test(text) && !/^\s*<html/i.test(text)) {
        return { text, url, error: null };
      }
      lastError = new Error('Некорректный или пустой ответ зеркала');
    } catch (e) {
      lastError = e;
      console.warn(`[Astra] Зеркало ${url} недоступно:`, e.message);
    }
  }
  return { text: null, url: null, error: lastError };
}

export async function getEngine() {
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
    const res = await fetchFromMirrorGroup(group, 'Astra-Browser-Extension/0.6.3');
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
function extractDomain(line) {
  if (!line || line.startsWith('!') || line.startsWith('[') || line.startsWith('#')) return null;
  if (line.includes('##') || line.includes('#@#')) return null;
  if (line.startsWith('@@')) return null;
  if (line.includes('$') || line.includes('/')) return null;

  const match = line.match(/^\|\|([a-zA-Z0-9.-]+)\^?$/);
  if (!match) return null;
  const d = match.at(1);
  if (!d || d.length < 3 || d.includes('..') || d.startsWith('.') || d.endsWith('.')) return null;
  return d;
}

export async function clearAdblockDnrRules() {
  try {
    const oldRules = await chrome.declarativeNetRequest.getDynamicRules();
    const toRemove = oldRules
      .filter((r) => !(r.id >= ID_RANGES.USER_BLOCKLIST.min && r.id <= ID_RANGES.USER_BLOCKLIST.max))
      .map((r) => r.id);
    if (toRemove.length > 0) {
      await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: toRemove, addRules: [] });
    }
  } catch (e) {
    console.warn('[Astra] clearAdblockDnrRules:', e.message);
  }
}

export async function updateAdblockRules() {
  const cfg = await loadConfig();
  if (!cfg.enabled || !cfg.modules.ads) {
    await clearAdblockDnrRules();
    return;
  }
  if (isUpdatingDb) return;
  isUpdatingDb = true;

  const domains = new Set(BASE_ADBLOCK_DOMAINS);
  let lastError = null;
  let succeededSources = 0;

  for (const group of FILTER_MIRROR_GROUPS) {
    if (domains.size >= 4450) break;
    const res = await fetchFromMirrorGroup(group, 'Astra-Browser-Extension/0.6.3');
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

  if (succeededSources > 0) {
    lastError = null;
    await chrome.storage.local.set({
      [CACHED_DOMAINS_KEY]: Array.from(domains),
    }).catch(() => {});
  } else {
    const stored = await chrome.storage.local.get(CACHED_DOMAINS_KEY);
    const cached = Array.isArray(stored[CACHED_DOMAINS_KEY]) ? stored[CACHED_DOMAINS_KEY] : [];
    if (cached.length > 0) {
      for (const d of cached) {
        if (domains.size >= 4450) break;
        domains.add(d);
      }
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

export async function applyUserBlocklist() {
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

export async function syncStaticRulesetState(cfg) {
  try {
    const enableStatic = !!(cfg.enabled && (cfg.modules.ads || cfg.modules.miners || cfg.modules.phishing));
    await chrome.declarativeNetRequest.updateEnabledRulesets({
      enableRulesetIds: enableStatic ? ['astra_blocklist'] : [],
      disableRulesetIds: enableStatic ? [] : ['astra_blocklist'],
    });
  } catch (e) {
    console.warn('[Astra] syncStaticRulesetState:', e.message);
  }
}
