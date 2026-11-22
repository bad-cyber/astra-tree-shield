/* content-script.js — Astra · Древо Щит · v0.7.1
   Компактный входной оркестратор модулей (ui-utils, security-guards, ad-picker, adblock-static, adblock-smart, metrics).
*/
(() => {
  'use strict';
  const A = (window.AstraShield = window.AstraShield || {});
  if (A.orchestratorLoaded) return;
  A.orchestratorLoaded = true;

  const st = A.state;
  let adObserverStarted = false;

  function runAdblockPass() {
    A.injectAdblockCSS();
    A.scanStaticCssHiddenAds();
    A.hideNativeAds();
    A.hideAdIframes();
    A.smartScanAds();
    A.analyzeDomAds();
    if (!adObserverStarted) {
      A.startAdObserver();
      adObserverStarted = true;
    }
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'START_PICK') A.startPickMode({ fromContextMenu: !!msg.fromContextMenu });
    if (msg.type === 'USER_BASE_UPDATED') A.applyUserAdBase();
    if (msg.type === 'SHOW_PHISHING_WARNING') {
      A.renderPhishingOverlay(msg.host || st.hostname, msg.reasons || []);
    }
    if (msg.type === 'HIDE_PHISHING_WARNING') {
      A.hidePhishingOverlay();
    }
    return false;
  });

  if (A.isContextValid() && chrome.storage?.onChanged) {
    chrome.storage.onChanged.addListener(async (changes, area) => {
      if (area !== 'sync' || !changes.config) return;
      const cfg = await A.syncRuntimeCfg();
      if (!cfg.enabled || !cfg.modules.ads) {
        A.removeAdblockStyles();
      } else {
        runAdblockPass();
      }
      if (!cfg.enabled || !cfg.modules.phishing) {
        A.hidePhishingOverlay();
      }
    });
  }
  async function init() {
    try {
      if (A.isContextValid()) {
        const { userWhitelist = [] } = await chrome.storage.local.get('userWhitelist');
        const inUser = userWhitelist.some((d) => st.hostname === d || st.hostname.endsWith('.' + d));
        st.isWhitelisted = st.isWhitelisted || inUser;
      }
    } catch {}

    const cfg = await A.syncRuntimeCfg();

    if (cfg.enabled && cfg.modules.phishing && A.isContextValid()) {
      try {
        const res = await chrome.runtime.sendMessage({ type: 'GET_CURRENT_TAB_SECURITY', url: location.href });
        if (res?.isOfficialWhitelist) st.isOfficialWhitelist = true;
        if (res?.risk === 'danger') {
          A.renderPhishingOverlay(res.host || st.hostname, res.reasons || []);
        }
      } catch {}
    }

    if (!cfg.enabled) return;

    await A.applyUserAdBase();

    if (window.top === window.self) {
      if (cfg.modules.clickjacking) A.guardClickjacking();
      if (!st.isWhitelisted) A.checkHttpDowngrade();
      A.scheduleMetrics();
    }

    if (cfg.modules.ads) {
      runAdblockPass();
    }
    if (cfg.modules.phishing) {
      A.scanPagePhishingHeuristics();
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        if (A.state.runtimeCfg.modules.ads) A.analyzeDomAds();
        if (A.state.runtimeCfg.modules.phishing) A.scanPagePhishingHeuristics();
      }, { once: true });
    }

    const debouncedHeuristics = A.debounce(() => {
      if (A.state.runtimeCfg.modules.phishing) A.scanPagePhishingHeuristics();
    }, 500);
    new MutationObserver(() => {
      if (A.state.runtimeCfg.modules.ads) A.analyzeDomAds();
      debouncedHeuristics();
    }).observe(document.documentElement, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
