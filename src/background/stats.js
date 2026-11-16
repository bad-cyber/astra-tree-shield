// stats.js — Astra · Древо Щит · v0.6.2
// Счётчики заблокированных элементов/угроз и накопительная экономия трафика.

export const ESTIMATED_BYTES_BY_TYPE = {
  sub_frame: 85000,
  script: 48000,
  image: 35000,
  stylesheet: 24000,
  xmlhttprequest: 12000,
  fetch: 12000,
  ping: 2048,
  other: 8192,
};

let stats = { blocked: 0, threatsToday: 0, lastReset: Date.now() };
let statsFlushTimer = null;
let trafficStatsCache = null;
let trafficFlushTimer = null;

export function getStatsSnapshot() {
  return { ...stats };
}

export async function resetDailyStatsIfNeeded() {
  const stored = (await chrome.storage.local.get('stats')).stats;
  if (stored) stats = { ...stats, ...stored };
  const now = Date.now();
  if (!stats.lastReset || now - stats.lastReset > 86400000) {
    stats.threatsToday = 0;
    stats.lastReset = now;
    await chrome.storage.local.set({ stats }).catch(() => {});
  }
  return getStatsSnapshot();
}

export async function bumpStats(blockedDelta = 0, threat = false) {
  if (!stats.lastReset) {
    const stored = (await chrome.storage.local.get('stats')).stats;
    if (stored) stats = { ...stats, ...stored };
    else stats.lastReset = Date.now();
  }
  stats.blocked += blockedDelta;
  if (threat) stats.threatsToday += 1;

  if (!statsFlushTimer) {
    statsFlushTimer = setTimeout(async () => {
      statsFlushTimer = null;
      await chrome.storage.local.set({ stats }).catch(() => {});
    }, 1000);
  }
}

export async function recordTrafficSaved(bytesDelta, reqDelta = 0, domDelta = 0) {
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
    }, 1500);
  }
}

export async function resetTrafficStats() {
  trafficStatsCache = {
    savedBytes: 0,
    blockedRequests: 0,
    blockedDom: 0,
    since: Date.now(),
  };
  await chrome.storage.local.set({ trafficStats: trafficStatsCache });
}
