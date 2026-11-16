/* service-worker.js — Astra · Древо Щит · v0.6.3
   Модульный роутер фоновых событий (stats.js, security.js, adblock-engine.js).
*/
import { Request } from '../../vendor/adblocker.bundle.js';
import { loadConfig, getHostname, WHITELIST_DOMAINS, isHostInList } from '../shared/config.js';
import {
  ESTIMATED_BYTES_BY_TYPE, getStatsSnapshot, resetDailyStatsIfNeeded,
  bumpStats, recordTrafficSaved, resetTrafficStats
} from './stats.js';
import { updateThreatFeeds, evaluateUrlSecurity } from './security.js';
import {
  getEngine, clearAdblockDnrRules, updateAdblockRules,
  applyUserBlocklist, syncStaticRulesetState
} from './adblock-engine.js';

const tabState = new Map();
const tabAnalysis = new Map();
const NOTIFY_ICON = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

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

chrome.webRequest.onBeforeRequest.addListener(
  async (details) => {
    if (details.tabId < 0) return;
    try {
      const cfg = await loadConfig();
      if (!cfg.enabled || !cfg.modules.ads) return;

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
          bumpStats(1, false);
        }
      }
    } catch {}
  },
  { urls: ['<all_urls>'] }
);
chrome.tabs.onRemoved.addListener((id) => {
  tabState.delete(id);
  tabAnalysis.delete(id);
  chrome.storage.session.remove(`metrics_${id}`).catch(() => {});
});

chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== 'sync' || !changes.config) return;
  const nextCfg = await loadConfig();
  await syncStaticRulesetState(nextCfg);
  if (nextCfg.enabled && nextCfg.modules.ads) {
    updateAdblockRules();
  } else {
    await clearAdblockDnrRules();
  }
});

chrome.runtime.onInstalled.addListener(async () => {
  const cfg = await loadConfig();
  await chrome.storage.sync.set({ config: cfg });
  await resetDailyStatsIfNeeded();
  await syncStaticRulesetState(cfg);
  chrome.alarms.create('updateFilters', { periodInMinutes: 1440 });
  chrome.alarms.create('updateThreats', { periodInMinutes: 360 });
  updateAdblockRules();
  updateThreatFeeds();
  applyUserBlocklist();
  getEngine();
});

chrome.runtime.onStartup.addListener(async () => {
  const cfg = await loadConfig();
  await syncStaticRulesetState(cfg);
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

chrome.webNavigation.onCommitted.addListener(async (details) => {
  if (details.frameId !== 0 || !details.tabId) return;
  tabAnalysis.delete(details.tabId);
  const cfg = await loadConfig();
  if (!cfg.enabled) {
    safeSetBadge(details.tabId, 'OFF', '#64748b');
    return;
  }

  let evalRes = { host: getHostname(details.url), risk: 'ok', reasons: [], age: null };
  if (cfg.modules.phishing) {
    evalRes = await evaluateUrlSecurity(details.url);
  }
  try {
    await chrome.scripting.executeScript({
      target: { tabId: details.tabId },
      world: 'MAIN',
      files: ['src/content/main-world-hooks.js'],
    });
  } catch {}

  const next = {
    host: evalRes.host,
    risk: evalRes.risk,
    reasons: evalRes.reasons,
    age: evalRes.age,
  };
  tabState.set(details.tabId, next);

  const colors = { ok: '#2e7d32', warn: '#c9b07b', danger: '#d32f2f' };
  const texts  = { ok: 'OK', warn: '!', danger: 'X' };
  safeSetBadge(details.tabId, texts[next.risk], colors[next.risk]);

  if (next.risk === 'danger' && cfg.modules.phishing) {
    await bumpStats(1, true);
    safeNotify('Astra: Опасный сайт!', `Угроза на ${evalRes.host}. ${evalRes.reasons.join('; ') || ''}`);
    chrome.tabs.sendMessage(details.tabId, {
      type: 'SHOW_PHISHING_WARNING',
      host: evalRes.host,
      reasons: evalRes.reasons,
    }).catch(() => {});
  }
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete' || !tab.url?.startsWith('http')) return;
  const cfg = await loadConfig();
  if (!cfg.enabled) {
    safeSetBadge(tabId, 'OFF', '#64748b');
    return;
  }

  const currentHost = getHostname(tab.url);
  let st = tabState.get(tabId);
  if ((!st || st.host !== currentHost) && cfg.modules.phishing) {
    const evalRes = await evaluateUrlSecurity(tab.url);
    st = {
      host: evalRes.host,
      risk: evalRes.risk,
      reasons: evalRes.reasons,
      age: evalRes.age,
    };
    tabState.set(tabId, st);
  }

  if (st) {
    const colors = { ok: '#2e7d32', warn: '#c9b07b', danger: '#d32f2f' };
    const texts  = { ok: 'OK', warn: '!', danger: 'X' };
    safeSetBadge(tabId, texts[st.risk] || 'OK', colors[st.risk] || '#2e7d32');
  }

  if (st?.risk === 'danger' && cfg.modules.phishing) {
    safeSetBadge(tabId, 'X', '#d32f2f');
    chrome.tabs.sendMessage(tabId, {
      type: 'SHOW_PHISHING_WARNING',
      host: st.host,
      reasons: st.reasons || [],
    }).catch(() => {});
  }
});
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    if (msg.type === 'GET_TAB_STATUS') {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const tab = tabs.at(0);
      if (!tab || !tab.id) return sendResponse({ error: 'no tab' });
      const st = tabState.get(tab.id) || { host: getHostname(tab.url), risk: 'ok', reasons: [] };
      const currentStats = await resetDailyStatsIfNeeded();
      const storage = await chrome.storage.local.get([
        'lastAdblockUpdate', 'adblockCount', 'userBlocklist', 'userWhitelist', 'trafficStats',
      ]);
      return sendResponse({ status: st, stats: currentStats, adblock: storage });
    }

    if (msg.type === 'GET_CURRENT_TAB_SECURITY') {
      const tabId = sender.tab?.id;
      const url = sender.tab?.url || msg.url || '';
      const cfg = await loadConfig();
      if (!cfg.enabled || !cfg.modules.phishing) {
        return sendResponse({ risk: 'ok', reasons: [] });
      }
      if (tabId && tabState.has(tabId)) {
        const cached = tabState.get(tabId);
        if (cached.risk === 'danger' || cached.risk === 'warn') {
          return sendResponse({ risk: cached.risk, host: cached.host, reasons: cached.reasons || [] });
        }
      }
      const res = await evaluateUrlSecurity(url);
      if (tabId) tabState.set(tabId, res);
      return sendResponse(res);
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
      await resetTrafficStats();
      return sendResponse({ ok: true });
    }

    if (msg.type === 'TOGGLE_BLOCK_SITE') {
      const { userBlocklist = [], userWhitelist = [] } = await chrome.storage.local.get([
        'userBlocklist', 'userWhitelist',
      ]);
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
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const tab = tabs.at(0);
      if (isBlockedNow && tab?.id) chrome.tabs.reload(tab.id);
      return sendResponse({ blocked: isBlockedNow });
    }

    if (msg.type === 'TOGGLE_WHITELIST') {
      const { userWhitelist = [], userBlocklist = [] } = await chrome.storage.local.get([
        'userWhitelist', 'userBlocklist',
      ]);
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
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const tab = tabs.at(0);
      if (tab?.id) chrome.tabs.reload(tab.id);
      return sendResponse({ whitelisted: isWLNow });
    }

    if (msg.type === 'CHECK_URL') {
      const res = await evaluateUrlSecurity(msg.url);
      if (res.reasons.length === 0) res.reasons.push('Явных угроз не обнаружено.');
      const isSafe = res.risk === 'ok' && isHostInList(res.host, WHITELIST_DOMAINS);
      return sendResponse({ risk: isSafe ? 'safe' : res.risk, host: res.host, reasons: res.reasons });
    }

    if (msg.type === 'REPORT_THREAT') {
      const tabId = sender.tab?.id;
      if (tabId && msg.reason) {
        const prev = tabState.get(tabId) || { host: getHostname(sender.tab?.url || ''), risk: 'ok', reasons: [] };
        const reasons = Array.from(new Set([...(prev.reasons || []), msg.reason]));
        tabState.set(tabId, { ...prev, risk: 'danger', reasons });
        safeSetBadge(tabId, 'X', '#d32f2f');
      }
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
      } catch {}

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
        bumpStats(newlyAdded, false);
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
    } catch {
      safeNotify('Astra: Не удалось заблокировать', `${name.split('/').pop()}`);
    }
  } else if (cfg.modules.downloads) {
    safeNotify('Astra: Осторожно, загрузка!', `Скачивается: ${name.split('/').pop()}`);
  }
});
