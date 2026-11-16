// security.js — Astra · Древо Щит · v0.6.3
// Антифишинг-базы, проверка возраста домена (RDAP) и комплексная оценка URL.

import {
  getHostname, checkBrandSimilarity, isTestPhishingUrl,
  WHITELIST_DOMAINS, isHostInList
} from '../shared/config.js';
import { fetchThreatFeeds, checkThreatFeed } from '../shared/reputation.js';

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

async function saveDomainCache(cache) {
  const keys = Object.keys(cache);
  if (keys.length > 500) {
    keys.sort((a, b) => (cache[a].ts || 0) - (cache[b].ts || 0));
    for (let i = 0; i < keys.length - 500; i++) delete cache[keys[i]];
  }
  await chrome.storage.local.set({ domainAgeCache: cache });
}

export async function getDomainAge(hostname) {
  const tld = hostname.split('.').pop();
  if (['ru', 'рф', 'su', 'by', 'kz'].includes(tld)) return { supported: false };

  const { domainAgeCache = {} } = await chrome.storage.local.get('domainAgeCache');
  const cached = domainAgeCache[hostname];
  if (cached && Date.now() - cached.ts < 86400000) {
    return { supported: cached.supported, ageDays: cached.ageDays, registered: cached.registered };
  }
  try {
    const rdapUrl = `https://rdap.org/domain/{encodeURIComponent(hostname)}`;
    const resp = await fetch(rdapUrl, {
      headers: { Accept: 'application/rdap+json' },
      signal: AbortSignal.timeout(4000),
    });
    if (!resp.ok) {
      domainAgeCache[hostname] = { supported: false, ts: Date.now() };
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
    return { host, risk: 'danger', reasons: ['Тестовая фишинговая страница Google Safe Browsing'] };
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

  const age = await getDomainAge(host);
  if (age.supported && age.ageDays < 30) {
    if (risk === 'ok') risk = 'warn';
    reasons.push(`Домен зарегистрирован ${age.ageDays} дн. назад`);
  }

  return { host, risk, reasons, age };
}
