/* content-script.js — Astra · Древо Щит · v0.6.3
   Компактный входной оркестратор модулей (ui-utils, security-guards, ad-picker, adblock-dom, metrics).
*/
(() => {
  'use strict';
  const A = (window.AstraShield = window.AstraShield || {});
  if (A.orchestratorLoaded) return;
  A.orchestratorLoaded = true;

  const st = A.state;

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'START_PICK') A.startPickMode();
    if (msg.type === 'USER_BASE_UPDATED') A.applyUserAdBase();
    if (msg.type === 'SHOW_PHISHING_WARNING') {
      A.renderPhishingOverlay(msg.host || st.hostname, msg.reasons || []);
    }
    return false;
  });

  if (A.isContextValid() && chrome.storage?.onChanged) {
    chrome.storage.onChanged.addListener(async (changes, area) => {
      if (area !== 'sync' || !changes.config) return;
      const cfg = await A.syncRuntimeCfg();
      if (!cfg.enabled || !cfg.modules.ads) {
        A.removeAdblockStyles();
      } else if (!st.isWhitelisted) {
        A.injectAdblockCSS();
        A.scanStaticCssHiddenAds();
        A.hideNativeAds();
        A.hideAdIframes();
        A.smartScanAds();
        A.analyzeDomAds();
      }
      if (!cfg.enabled || !cfg.modules.phishing) {
        A.hidePhishingOverlay();
      }
    });
  }

  async function init() {
    const cfg = await A.syncRuntimeCfg();
    try {
      if (A.isContextValid()) {
        const { userWhitelist = [] } = await chrome.storage.local.get('userWhitelist');
        const inUser = userWhitelist.some((d) => st.hostname === d || st.hostname.endsWith('.' + d));
        st.isWhitelisted = st.isWhitelisted || inUser;
      }
    } catch {}

    if (!st.isWhitelisted && cfg.enabled && cfg.modules.phishing && A.isContextValid()) {
      chrome.runtime.sendMessage({ type: 'GET_CURRENT_TAB_SECURITY', url: location.href })
        .then((res) => {
          if (res?.risk === 'danger') {
            A.renderPhishingOverlay(res.host || st.hostname, res.reasons || []);
          }
        })
        .catch(() => {});
    }

    if (!cfg.enabled) return;

    A.injectAdblockCSS();
    await A.applyUserAdBase();
    if (st.isWhitelisted) return;

    if (window.top === window.self) {
      A.guardClickjacking();
      A.checkHttpDowngrade();
      A.scheduleMetrics();
    }

    A.scanStaticCssHiddenAds();
    A.hideNativeAds();
    A.hideAdIframes();
    A.smartScanAds();
    A.startAdObserver();
    A.scanPagePhishingHeuristics();

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        A.analyzeDomAds();
        A.scanPagePhishingHeuristics();
      }, { once: true });
    } else {
      A.analyzeDomAds();
    }

    new MutationObserver(A.analyzeDomAds).observe(document.documentElement, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
