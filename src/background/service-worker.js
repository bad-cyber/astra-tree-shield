/* service-worker.js — Astra · Древо Щит · v0.7.2
   Модульный роутер фоновых событий (stats.js, security.js, adblock-engine.js, tab-tracker.js, downloads-guard.js).
*/
import { Request } from '../../vendor/adblocker.bundle.js';
import { loadConfig, getHostname, WHITELIST_DOMAINS, isHostInList } from '../shared/config.js';
import { resetDailyStatsIfNeeded, bumpStats, resetTrafficStats } from './stats.js';
import { updateThreatFeeds, updateMaliciousHashes, evaluateUrlSecurity } from './security.js';
import {
  getEngine, clearAdblockDnrRules, updateAdblockRules,
  applyUserBlocklist, syncStaticRulesetState
} from './adblock-engine.js';
import {
  getTabState, setTabState, clearTabData, resetTabAnalysis,
  getTabAnalysis, getEffectiveModulesForHost, recordDomBlocks,
  initTabRequestTracking
} from './tab-tracker.js';
import { initDownloadsGuard } from './downloads-guard.js';

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

function registerContextMenus() {
  try {
    chrome.contextMenus.removeAll(() => {
      void chrome.runtime.lastError;
      chrome.contextMenus.create({
        id: 'astra-block-element',
        title: '🎯 Заблокировать элемент (Astra)',
        contexts: ['all'],
      }, () => {
        void chrome.runtime.lastError;
      });
    });
  } catch {}
}

chrome.contextMenus?.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== 'astra-block-element' || !tab?.id) return;
  chrome.tabs.sendMessage(tab.id, { type: 'START_PICK', fromContextMenu: true }).catch(() => {
    safeNotify('Astra', 'Обновите страницу, чтобы использовать блокировщик элементов.');
  });
});

initTabRequestTracking();
initDownloadsGuard(safeNotify);
chrome.tabs.onRemoved.addListener((id) => {
  clearTabData(id);
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
  const prevUrl = changes.config.oldValue?.hashFeedUrl || '';
  const nextUrl = nextCfg.hashFeedUrl || '';
  if (prevUrl !== nextUrl) {
    updateMaliciousHashes();
  }
});

chrome.runtime.onInstalled.addListener(async () => {
  registerContextMenus();
  const cfg = await loadConfig();
  await chrome.storage.sync.set({ config: cfg });
  await resetDailyStatsIfNeeded();
  await syncStaticRulesetState(cfg);
  chrome.alarms.create('updateFilters', { periodInMinutes: 1440 });
  chrome.alarms.create('updateThreats', { periodInMinutes: 360 });
  chrome.alarms.create('updateHashes', { periodInMinutes: 1440 });
  updateAdblockRules();
  updateThreatFeeds();
  updateMaliciousHashes();
  applyUserBlocklist();
  getEngine();
});

chrome.runtime.onStartup.addListener(async () => {
  registerContextMenus();
  const cfg = await loadConfig();
  await syncStaticRulesetState(cfg);
  applyUserBlocklist();
  updateAdblockRules();
  getEngine();
  chrome.storage.local.get(['threatFeedUpdated', 'maliciousHashesUpdated']).then(({ threatFeedUpdated = 0, maliciousHashesUpdated = 0 }) => {
    if (Date.now() - threatFeedUpdated > 12 * 3600 * 1000) updateThreatFeeds();
    if (Date.now() - maliciousHashesUpdated > 24 * 3600 * 1000) updateMaliciousHashes();
  });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'updateFilters') updateAdblockRules();
  if (alarm.name === 'updateThreats') updateThreatFeeds();
  if (alarm.name === 'updateHashes') updateMaliciousHashes();
});

chrome.webNavigation.onCommitted.addListener(async (details) => {
  if (details.frameId !== 0 || !details.tabId) return;
  resetTabAnalysis(details.tabId);
  const cfg = await loadConfig();
  if (!cfg.enabled) {
    safeSetBadge(details.tabId, 'OFF', '#64748b');
    return;
  }

  const navHost = getHostname(details.url);
  const eff = await getEffectiveModulesForHost(cfg, navHost);
  let evalRes = { host: navHost, risk: 'ok', reasons: [], age: null };
  if (eff.phishing) {
    evalRes = await evaluateUrlSecurity(details.url);
  }
  try {
    await chrome.scripting.executeScript({
      target: { tabId: details.tabId },
      world: 'MAIN',
      files: ['src/content/main-world-hooks.js', 'src/content/visibility-spoof.js'],
    });
  } catch {}
  const next = {
    host: evalRes.host,
    risk: evalRes.risk,
    reasons: evalRes.reasons,
    age: evalRes.age,
  };
  setTabState(details.tabId, next);
  const colors = { ok: '#2e7d32', warn: '#c9b07b', danger: '#d32f2f' };
  const texts  = { ok: 'OK', warn: '!', danger: 'X' };
  safeSetBadge(details.tabId, texts[next.risk], colors[next.risk]);

  if (next.risk === 'danger' && eff.phishing) {
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
  const eff = await getEffectiveModulesForHost(cfg, currentHost);
  let st = getTabState(tabId);
  if ((!st || st.host !== currentHost) && eff.phishing) {
    const evalRes = await evaluateUrlSecurity(tab.url);
    st = {
      host: evalRes.host,
      risk: evalRes.risk,
      reasons: evalRes.reasons,
      age: evalRes.age,
    };
    setTabState(tabId, st);
  }

  if (st) {
    const colors = { ok: '#2e7d32', warn: '#c9b07b', danger: '#d32f2f' };
    const texts  = { ok: 'OK', warn: '!', danger: 'X' };
    safeSetBadge(tabId, texts[st.risk] || 'OK', colors[st.risk] || '#2e7d32');
  }

  if (st?.risk === 'danger' && eff.phishing) {
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
      const st = getTabState(tab.id) || { host: getHostname(tab.url), risk: 'ok', reasons: [] };
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
      const host = getHostname(url);
      const isOfficialWhitelist = isHostInList(host, WHITELIST_DOMAINS);
      const eff = await getEffectiveModulesForHost(cfg, host);
      if (!cfg.enabled || !eff.phishing) {
        return sendResponse({ risk: 'ok', host, reasons: [], isOfficialWhitelist });
      }
      if (tabId && getTabState(tabId)) {
        const cached = getTabState(tabId);
        if (cached.risk === 'danger' || cached.risk === 'warn') {
          return sendResponse({
            risk: cached.risk,
            host: cached.host,
            reasons: cached.reasons || [],
            isOfficialWhitelist,
          });
        }
      }
      const res = await evaluateUrlSecurity(url);
      if (tabId) setTabState(tabId, res);
      return sendResponse({ ...res, isOfficialWhitelist });
    }

    if (msg.type === 'FORCE_UPDATE_DB') {
      await Promise.all([updateAdblockRules(), updateThreatFeeds(), updateMaliciousHashes()]);
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
      const isBlockedNow = !userBlocklist.includes(msg.host);
      const newList = isBlockedNow
        ? [...userBlocklist, msg.host]
        : userBlocklist.filter((h) => h !== msg.host);
      const newWL = isBlockedNow ? userWhitelist.filter((h) => h !== msg.host) : userWhitelist;
      await chrome.storage.local.set({ userBlocklist: newList, userWhitelist: newWL });
      await applyUserBlocklist();

      const allTabs = await chrome.tabs.query({});
      for (const t of allTabs) {
        if (!t.id || !t.url?.startsWith('http')) continue;
        const tabHost = getHostname(t.url);
        if (tabHost !== msg.host && !tabHost.endsWith('.' + msg.host)) continue;

        if (isBlockedNow) {
          const reasons = ['Заблокировано пользователем'];
          setTabState(t.id, { host: tabHost, risk: 'danger', reasons, age: null });
          safeSetBadge(t.id, 'X', '#d32f2f');
          chrome.tabs.sendMessage(t.id, { type: 'SHOW_PHISHING_WARNING', host: tabHost, reasons }).catch(() => {});
          chrome.tabs.reload(t.id).catch(() => {});
        } else {
          const fresh = await evaluateUrlSecurity(t.url);
          setTabState(t.id, fresh);
          const colors = { ok: '#2e7d32', warn: '#c9b07b', danger: '#d32f2f' };
          const texts  = { ok: 'OK', warn: '!', danger: 'X' };
          safeSetBadge(t.id, texts[fresh.risk] || 'OK', colors[fresh.risk] || '#2e7d32');
          if (fresh.risk !== 'danger') {
            chrome.tabs.sendMessage(t.id, { type: 'HIDE_PHISHING_WARNING' }).catch(() => {});
          }
        }
      }
      return sendResponse({ blocked: isBlockedNow });
    }

    if (msg.type === 'TOGGLE_WHITELIST') {
      const { userWhitelist = [], userBlocklist = [] } = await chrome.storage.local.get([
        'userWhitelist', 'userBlocklist',
      ]);
      const isWLNow = !userWhitelist.includes(msg.host);
      const newList = isWLNow
        ? [...userWhitelist, msg.host]
        : userWhitelist.filter((h) => h !== msg.host);
      const newBL = isWLNow ? userBlocklist.filter((h) => h !== msg.host) : userBlocklist;
      await chrome.storage.local.set({ userWhitelist: newList, userBlocklist: newBL });
      await applyUserBlocklist();

      const allTabs = await chrome.tabs.query({});
      for (const t of allTabs) {
        if (!t.id || !t.url?.startsWith('http')) continue;
        const tabHost = getHostname(t.url);
        if (tabHost === msg.host || tabHost.endsWith('.' + msg.host)) {
          chrome.tabs.reload(t.id).catch(() => {});
        }
      }
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
        const prev = getTabState(tabId) || { host: getHostname(sender.tab?.url || ''), risk: 'ok', reasons: [] };
        const reasons = Array.from(new Set([...(prev.reasons || []), msg.reason]));
        setTabState(tabId, { ...prev, risk: 'danger', reasons });
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
      if (!msg.tabId) return sendResponse({ metrics: null });
      const key = `metrics_${msg.tabId}`;
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
        url, hostname, domain,
        classes: new Set(classes),
        ids: new Set(ids),
        hrefs: hrefs || [],
        getBaseRules: true, getInjectionRules: false, getExtendedRules: false,
      });
      return sendResponse({ styles: cosmetic.styles || '' });
    }

    if (msg.type === 'REPORT_DOM_BLOCKS') {
      recordDomBlocks(sender.tab?.id, msg.blocks);
      return sendResponse({ ok: true });
    }

    if (msg.type === 'GET_TAB_ANALYSIS') {
      return sendResponse(getTabAnalysis(msg.tabId));
    }
  })();
  return true;
});
