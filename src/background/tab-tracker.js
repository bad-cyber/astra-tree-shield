/* tab-tracker.js — Astra · Древо Щит · v0.7.2
   Учёт состояния вкладок и блокировок в реальном времени (DNR + webRequest + DOM).
*/
import { Request } from '../../vendor/adblocker.bundle.js';
import {
  loadConfig, getHostname, WHITELIST_DOMAINS, isHostInList, resolveEffectiveModules
} from '../shared/config.js';
import { ESTIMATED_BYTES_BY_TYPE, bumpStats, recordTrafficSaved } from './stats.js';
import { getEngine, ID_RANGES } from './adblock-engine.js';

const tabState = new Map();
const tabAnalysis = new Map();
const seenRequestIds = new Set();

export function getTabState(tabId) {
  return tabState.get(tabId);
}

export function setTabState(tabId, state) {
  tabState.set(tabId, state);
}

export function clearTabData(tabId) {
  tabState.delete(tabId);
  tabAnalysis.delete(tabId);
  chrome.storage.session.remove(`metrics_${tabId}`).catch(() => {});
}

export function resetTabAnalysis(tabId) {
  tabAnalysis.delete(tabId);
}

export function getTabAnalysis(tabId) {
  return tabAnalysis.get(tabId) || { requests: [], domBlocks: [] };
}

export async function getEffectiveModulesForHost(cfg, host) {
  const { userWhitelist = [] } = await chrome.storage.local.get('userWhitelist');
  const isWhitelisted = isHostInList(host, userWhitelist) || isHostInList(host, WHITELIST_DOMAINS);
  return resolveEffectiveModules(cfg, host, isWhitelisted);
}

function recordBlockedRequest(tabId, url, type, filterLabel, requestId = '') {
  if (!tabId || tabId < 0 || !url) return;
  if (requestId) {
    const dedupKey = `${tabId}:${requestId}`;
    if (seenRequestIds.has(dedupKey)) return;
    seenRequestIds.add(dedupKey);
    if (seenRequestIds.size > 4000) {
      const firstKey = seenRequestIds.values().next().value;
      if (firstKey) seenRequestIds.delete(firstKey);
    }
  }

  const data = tabAnalysis.get(tabId) || { requests: [], domBlocks: [] };
  if (data.requests.some((r) => r.url === url)) return;

  data.requests.push({
    url,
    type: type || 'other',
    filter: filterLabel,
  });
  if (data.requests.length > 150) data.requests.shift();
  tabAnalysis.set(tabId, data);

  const estBytes = ESTIMATED_BYTES_BY_TYPE[type] || ESTIMATED_BYTES_BY_TYPE.other;
  recordTrafficSaved(estBytes, 1, 0);
  bumpStats(1, false);
}
export function recordDomBlocks(tabId, blocks = []) {
  if (!tabId || !Array.isArray(blocks) || blocks.length === 0) return;
  const data = tabAnalysis.get(tabId) || { requests: [], domBlocks: [] };
  let newlyAdded = 0;

  for (const b of blocks) {
    if (!b || !b.selector) continue;
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
}

function formatDnrRuleLabel(rule) {
  if (!rule) return 'DNR · Фильтр рекламы';
  if (rule.rulesetId && rule.rulesetId !== '_dynamic') {
    return `DNR · Встроенный фильтр #${rule.ruleId}`;
  }
  if (rule.ruleId >= ID_RANGES.URL_PATTERNS.min && rule.ruleId <= ID_RANGES.URL_PATTERNS.max) {
    return `DNR · Паттерн трекера #${rule.ruleId}`;
  }
  if (rule.ruleId >= ID_RANGES.HARDCODED.min && rule.ruleId <= ID_RANGES.HARDCODED.max) {
    return `DNR · Рекламная сеть #${rule.ruleId}`;
  }
  return `DNR · База фильтров #${rule.ruleId}`;
}

export function initTabRequestTracking() {
  try {
    chrome.declarativeNetRequest.setExtensionActionOptions?.({
      displayActionCountAsBadgeText: false,
    }).catch(() => {});
  } catch {}

  if (chrome.declarativeNetRequest.onRuleMatchedDebug) {
    chrome.declarativeNetRequest.onRuleMatchedDebug.addListener((info) => {
      const { request, rule } = info || {};
      if (!request || request.tabId < 0 || !rule) return;
      if (
        rule.rulesetId === '_dynamic' &&
        rule.ruleId >= ID_RANGES.USER_BLOCKLIST.min &&
        rule.ruleId <= ID_RANGES.USER_BLOCKLIST.max
      ) {
        return;
      }
      recordBlockedRequest(
        request.tabId,
        request.url,
        request.type,
        formatDnrRuleLabel(rule),
        request.requestId || ''
      );
    });
  }
  chrome.webRequest.onBeforeRequest.addListener(
    async (details) => {
      if (details.tabId < 0) return;
      try {
        const cfg = await loadConfig();
        const sourceHost = getHostname(details.initiator || details.documentUrl || '');
        const eff = await getEffectiveModulesForHost(cfg, sourceHost);
        if (!cfg.enabled || !eff.ads) return;

        const eng = await getEngine();
        const req = Request.fromRawDetails({
          type: details.type,
          url: details.url,
          sourceUrl: details.initiator || '',
        });

        const { match } = eng.match(req);
        if (match) {
          recordBlockedRequest(
            details.tabId,
            details.url,
            details.type,
            match.toString(),
            details.requestId || ''
          );
        }
      } catch {}
    },
    { urls: ['<all_urls>'] }
  );
}
