/* adblock-smart.js — Astra · Древо Щит · v0.7.0
   Интеллектуальный DOM-сканер: скоринг баннеров, точечный Anti-Adblock Defuser, косметика Ghostery и наблюдатель DOM.
*/
(() => {
  'use strict';
  const A = (window.AstraShield = window.AstraShield || {});
  if (A.adblockSmartLoaded) return;
  A.adblockSmartLoaded = true;

  const AD_SIZE_PATTERNS = [
    new Array(300, 250), new Array(728, 90), new Array(160, 600),
    new Array(300, 600), new Array(320, 50), new Array(970, 90),
    new Array(970, 250), new Array(300, 50), new Array(336, 280),
    new Array(234, 60), new Array(250, 250), new Array(200, 200),
    new Array(468, 60), new Array(120, 600), new Array(160, 600),
  ];

  function scoreAdCandidate(el) {
    let score = 0;
    const cls = A.safeClassName(el);
    const id = el.id || '';
    const w = el.offsetWidth, h = el.offsetHeight;
    if (AD_SIZE_PATTERNS.some(([pw, ph]) => Math.abs(w - pw) < 5 && Math.abs(h - ph) < 5)) score += 30;
    if (/(?:^|[-_])(?:ad|adv|banner|promo|sponsor|native|teaser)(?:[-_]|$)/i.test(cls + ' ' + id)) score += 25;
    if (el.querySelector?.('iframe[src*="doubleclick"], iframe[src*="googlesyndication"], iframe[src*="yabs.yandex"], iframe[src*="adfox"], iframe[src*="adriver"], iframe[src*="smi2"], iframe[src*="mgid"], iframe[src*="nativeroll"]')) score += 25;
    if (el.tagName === 'IFRAME' && AD_SIZE_PATTERNS.some(([pw, ph]) => Math.abs(w - pw) < 5 && Math.abs(h - ph) < 5)) score += 20;
    if (el.matches?.('[data-erid],[data-ad],[data-ad-click],[data-banner-id],[data-ad_id],[data-adv],[data-adv-id],[data-rtb],[data-teaser]')) score += 35;
    if (el.querySelector?.('a[href*="erid"], a[href*="adriver"], a[href*="utm_source=ad"], a[href*="utm_medium=cpc"]')) score += 15;

    const text = A.norm((el.textContent || '').slice(0, 100));
    if (/\b(реклама|sponsored|advert|erid)\b/i.test(text)) score += 15;

    const st = getComputedStyle(el);
    if (st.position === 'fixed' && parseInt(st.zIndex || '0', 10) > 999) score += 10;
    return score;
  }

  A.smartScanAds = () => {
    const st = A.state;
    if (st.isWhitelisted || !st.runtimeCfg.enabled || !st.runtimeCfg.modules.ads) return 0;
    let hidden = 0;
    const candidates = new Set();
    document.querySelectorAll('div, aside, section, article, iframe, [data-testid], [class*="banner"], [class*="advert"], [class*="promo"], [class*="sponsor"], [class*="teaser"]').forEach((el) => {
      if (el.dataset.astraHidden || A.PROTECTED_TAGS.has(el.tagName)) return;
      if (el.offsetWidth < 100 || el.offsetHeight < 50) return;
      if (el.offsetWidth > 4000 || el.offsetHeight > 2500) return;
      if (el.textContent && el.textContent.length > 4000) return;
      candidates.add(el);
    });

    candidates.forEach((el) => {
      const score = scoreAdCandidate(el);
      if (score >= 60 && A.hideNode(el, `smart-score:${score}`)) hidden++;
    });

    document.querySelectorAll('div:empty, aside:empty, section:empty').forEach((el) => {
      if (el.dataset.astraHidden || A.PROTECTED_TAGS.has(el.tagName)) return;
      const w = el.offsetWidth, h = el.offsetHeight;
      if (w > 100 && h > 50) {
        const cls = A.safeClassName(el).toLowerCase();
        if (/ad|banner|promo|sponsor|teaser|native/i.test(cls) || AD_SIZE_PATTERNS.some(([pw, ph]) => Math.abs(w - pw) < 5 && Math.abs(h - ph) < 5)) {
          if (A.hideNode(el, 'empty-ad-container')) hidden++;
        }
      }
    });
    return hidden;
  };

  // ============================================================
  // 🛡️ ANTI-ADBLOCK DEFUSER (B53d — точечное скрытие модалки без зацепа обёртки страницы)
  // ============================================================
  const ANTI_ADBLOCK_PHRASE_RE = /(?:disable|turn\s+off|pause|whitelist|allow\s+ads)\s+(?:your\s+)?(?:ad\s*-?\s*block(?:er)?|content\s+block(?:er)?)|you\s+(?:are\s+using|use)\s+an?\s+ad\s*-?\s*block(?:er)?|отключите\s+блокировщик(?:\s+рекламы)?|вы\s+используете\s+блокировщик\s+рекламы|добавьте\s+(?:наш\s+)?сайт\s+в\s+исключения/i;
  const PAGE_ROOT_ID_RE = /^(?:page|page-container|main-content|main|app|root|__next|wrapper|content|site)$/i;

  function isPageLayoutContainer(el) {
    if (!el || el === document.body || el === document.documentElement) return true;
    if (PAGE_ROOT_ID_RE.test(el.id || '')) return true;
    if (el.querySelector?.('main, article, nav, header, footer, h1')) return true;
    if (el.querySelectorAll?.('section').length > 1) return true;
    return false;
  }


    A.defuseAntiAdblockOverlays = () => {
    const st = A.state;
    if (st.isWhitelisted || !st.runtimeCfg.enabled || !st.runtimeCfg.modules.ads) return 0;
    let defused = 0;

    const matches = [];
    document.querySelectorAll('*').forEach((el) => {
      if (el.dataset?.astraHidden || A.PROTECTED_TAGS.has(el.tagName)) return;
      if (el.id === 'astra-phishing-shield' || el.closest?.('#astra-phishing-shield')) return;
      if (el.querySelector?.('form, input[type="password"]')) return;
      if (isPageLayoutContainer(el)) return;

      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') return;

      const rect = el.getBoundingClientRect();
      if (rect.width < 220 || rect.height < 80) return;

      const rawText = el.shadowRoot ? el.shadowRoot.textContent : el.textContent;
      const text = (rawText || '').replace(/\s+/g, ' ').trim();
      if (!text || text.length > 900 || !ANTI_ADBLOCK_PHRASE_RE.test(text)) return;

      const innerBoxes = el.querySelectorAll('div, section, aside').length;
      if (innerBoxes > 16) return;

      matches.push({ el, area: rect.width * rect.height });
    });

    matches.sort((a, b) => a.area - b.area);
    for (const { el } of matches) {
      if (el.dataset?.astraHidden || el.closest?.('[data-astra-hidden="1"]')) continue;
      if (A.hideNode(el, 'anti-adblock-defuser')) {
        defused++;
      }
    }

    if (defused > 0) {
      [document.documentElement, document.body].forEach((root) => {
        if (!root) return;
        const cs = getComputedStyle(root);
        if (cs.overflow === 'hidden' || cs.overflowY === 'hidden') {
          root.style.setProperty('overflow', 'auto', 'important');
          root.style.setProperty('overflow-y', 'auto', 'important');
        }
        if (cs.position === 'fixed') {
          root.style.setProperty('position', 'static', 'important');
        }
      });
    }
    return defused;
  };

  // ============================================================
  // 🕵️‍♂️ GHOSTERY BLOCKER + ANALYZER
  // ============================================================
  function collectPageFeatures() {
    const ids = new Set();
    const classes = new Set();
    const hrefs = new Set();

    const allEls = document.getElementsByTagName('*');
    const limit = Math.min(allEls.length, 3500);
    for (let i = 0; i < limit; i++) {
      const el = allEls[i];
      if (el.id) ids.add(el.id);
      if (el.classList && el.classList.length > 0) {
        el.classList.forEach(c => classes.add(c));
      }
    }

    document.querySelectorAll('a[href]').forEach(a => {
      const h = a.getAttribute('href');
      if (h && !h.startsWith('#') && !h.startsWith('javascript:')) {
        hrefs.add(a.href || h);
      }
    });

    return {
      ids: Array.from(ids),
      classes: Array.from(classes),
      hrefs: Array.from(hrefs).slice(0, 500),
    };
  }

  function splitCssSelectors(selectorGroup) {
    const result = [];
    let depthParen = 0;
    let depthBracket = 0;
    let current = '';

    for (let i = 0; i < selectorGroup.length; i++) {
      const ch = selectorGroup[i];
      if (ch === '(') depthParen++;
      else if (ch === ')') depthParen = Math.max(0, depthParen - 1);
      else if (ch === '[') depthBracket++;
      else if (ch === ']') depthBracket = Math.max(0, depthBracket - 1);

      if (ch === ',' && depthParen === 0 && depthBracket === 0) {
        const trimmed = current.trim();
        if (trimmed) result.push(trimmed);
        current = '';
      } else {
        current += ch;
      }
    }
    const last = current.trim();
    if (last) result.push(last);
    return result;
  }

  function parseGhosterySelectors(cssText) {
    const selectors = new Set();
    const rules = cssText.split('}');
    for (const rule of rules) {
      const braceIdx = rule.indexOf('{');
      if (braceIdx === -1) continue;
      const body = rule.slice(braceIdx + 1).toLowerCase().replace(/\s+/g, '');
      if (!body.includes('display:none') && !body.includes('visibility:hidden')) continue;

      const header = rule.slice(0, braceIdx).trim();
      if (!header || header.startsWith('@')) continue;

      for (const sel of splitCssSelectors(header)) {
        if (!sel.includes('::')) selectors.add(sel);
      }
    }
    return Array.from(selectors);
  }

  A.analyzeDomAds = A.debounce(async () => {
    const st = A.state;
    if (st.isWhitelisted || !st.runtimeCfg.enabled || !st.runtimeCfg.modules.ads) return;
    if (!A.isContextValid()) return;

    const { ids, classes, hrefs } = collectPageFeatures();
    if (ids.length === 0 && classes.length === 0 && hrefs.length === 0) return;

    try {
      const resp = await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({ type: 'GET_COSMETIC_FILTERS', url: location.href, ids, classes, hrefs }, (response) => {
          if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
          else resolve(response);
        });
      });

      if (!resp || !resp.styles) return;

      const selectors = parseGhosterySelectors(resp.styles);
      for (const selector of selectors) {
        try {
          document.querySelectorAll(selector).forEach(el => {
            A.hideNode(el, 'ghostery', selector);
          });
        } catch {}
      }
    } catch (e) {
      if (e.message && e.message.includes('Extension context invalidated')) return;
    }
  }, 2500);

  let observerStarted = false;
  A.startAdObserver = () => {
    if (A.state.isWhitelisted || observerStarted) return;
    observerStarted = true;
    const run = A.debounce(() => {
      const cfg = A.state.runtimeCfg;
      if (!cfg.enabled || !cfg.modules.ads || A.state.isWhitelisted) return;
      A.scanStaticCssHiddenAds();
      A.hideNativeAds();
      A.hideAdIframes();
      A.smartScanAds();
      A.defuseAntiAdblockOverlays();
    }, 350);
    new MutationObserver(run).observe(document.documentElement, { childList: true, subtree: true });
    new Array(400, 1200, 2500, 6000).forEach((ms) => setTimeout(run, ms));
  };
})();
