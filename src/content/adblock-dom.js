/* adblock-dom.js — Astra · Древо Щит · v0.6.3
   DOM-блокировка рекламы: CSS-фильтры, эвристика баннеров, обход обфускации Mail.ru/VK и Ghostery.
*/
(() => {
  'use strict';
  const A = (window.AstraShield = window.AstraShield || {});
  if (A.adblockDomLoaded) return;
  A.adblockDomLoaded = true;

  A.injectAdblockCSS = () => {
    const st = A.state;
    if (st.isWhitelisted || !st.runtimeCfg.enabled || !st.runtimeCfg.modules.ads) return;
    if (document.getElementById('astra-adblock-style')) return;
    try {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.id = 'astra-adblock-style';
      link.href = chrome.runtime.getURL('src/content/adblock.css');
      (document.head || document.documentElement).appendChild(link);
    } catch (e) {
      console.warn('[Astra] injectAdblockCSS failed:', e);
    }
  };

  A.removeAdblockStyles = () => {
    document.getElementById('astra-adblock-style')?.remove();
    document.getElementById('astra-ghostery-style')?.remove();
  };

  const STATIC_ADBLOCK_SELECTORS = [
    '[data-erid]', '[data-ad]', '[data-ad-click]', '[data-ad-slot]', '[data-ad_id]',
    '[data-adv]', '[data-adv-id]', '[data-banner]', '[data-banner-id]', '[data-rtb]', '[data-teaser]',
    '[data-testid="ad"]', '[data-testid*="advert"]', '[data-testid*="promo"]', '[data-testid="advert"]', '[data-testid="ads"]',
    'a[href*="erid="]', 'a[href*="/erid/"]', 'a[href*="utm_source=ad"]', 'a[href*="utm_medium=cpc"]', 'a[href*="utm_campaign=promo"]',
    '.advert', '[id^="yandex_rtb"]', '[id*="yandex_rtb"]', '[class*="yandex-rtb"]',
    '[id^="adfox"]', '[id^="AdFox"]', '[class*="adfox"]',
    '[class*="serp-adv"]', '[class*="AdvProductGallery"]', '[class*="AdsBlock"]', '[class*="ad-banner"]',
    '[class^="direct-"]', '[class*=" direct-"]', '[class*="yandex-direct"]', '#direct', '.yandex-ads',
    '[data-bem*="adv"]', '[data-bem*="yandex_rtb"]', '[data-zen-ad]', '[class*="zen-ad"]',
    '[class*="mailru-morda-desktop--advert"]', '[class*="mailru-morda-desktop--banner"]',
    '[class*="mailru-morda-desktop--native"]', '[class*="mailru-morda-desktop--promo"]', '[class*="mailru-morda-desktop--adv"]',
    '[class*="morda-desktop--native"]', '[class*="morda-desktop__advert"]', '[class*="morda-desktop__banner"]', '[class*="morda-desktop__promo"]',
    '[class*="feed-mailru"][class*="ad"]', '[class*="feed-mailru"][class*="promo"]', '[class*="feed-mailru__ad"]',
    '[class*="native-ad"]', '[class*="nativeAd"]', '[class*="tgb-wrapper"]',
    '[class*="vk-ads"]', '[class*="ads_ads"]', '[class*="ads_ads_"]', '[class*="ads-banner"]',
    '[class*="ads-promo"]', '[class*="promo-banner"]', '[class*="promoted"]',
    '[id^="trg_"]', '[data-trg]', '[class*="mytarget"]', '[class*="rb-banner"]', '[class*="rb_body"]',
    '[id^="M"][id*="ScriptRoot"]', '[id*="MarketGid"]', '[id*="MGID"]',
    '[id^="smi2"]', '[class*="smi2"]', '[id*="lentainform"]', '[class*="lentainform"]',
    '[class*="directadvert"]', '[class*="teaser-block"]', '[class*="teaser_block"]', '[class*="teasers-widget"]', '[class*="feed-ad"]',
    '[id*="nativeroll"]', '[class*="nativeroll"]', '[id*="videonow"]', '[class*="videonow"]',
    '[class*="seedr-"]', '[class*="outstream-ad"]', '[class*="sticky-ad"]', '[class*="floating-banner"]',
    '[class*="advert"]', '[class*="advertisement"]', '[class*="adsbygoogle"]',
    '[class*="google-ads"]', '[class*="sponsored"]',
  ];

  A.scanStaticCssHiddenAds = () => {
    const st = A.state;
    if (st.isWhitelisted || !st.runtimeCfg.enabled || !st.runtimeCfg.modules.ads) return;
    for (const sel of STATIC_ADBLOCK_SELECTORS) {
      try {
        document.querySelectorAll(sel).forEach((el) => {
          if (A.PROTECTED_TAGS.has(el.tagName)) return;
          if (el.dataset.astraHidden) return;
          if (el.closest?.('.astra-toast-stack') || el.closest?.('#astra-picker-hint') || el.closest?.('#astra-phishing-shield')) return;
          if (getComputedStyle(el).display === 'none') {
            el.dataset.astraHidden = '1';
            el.dataset.astraReason = 'adblock-css';
            A.recordHiddenBlock(el, `[CSS] ${sel}`, { x: 0, y: 0, width: 0, height: 0 });
          }
        });
      } catch {}
    }
  };
  const AD_LABEL_MAX = 48;
  const AD_SIZE_PATTERNS = [
    new Array(300, 250), new Array(728, 90), new Array(160, 600),
    new Array(300, 600), new Array(320, 50), new Array(970, 90),
    new Array(970, 250), new Array(300, 50), new Array(336, 280),
    new Array(234, 60), new Array(250, 250), new Array(200, 200),
    new Array(468, 60), new Array(120, 600), new Array(160, 600),
  ];

  const AD_HOST_PATTERNS = [
    'doubleclick' + '.net', 'googlesyndication' + '.com',
    'googleadservices' + '.com', 'adservice.google' + '.com',
    'yabs.yandex' + '.ru', 'an.yandex' + '.ru',
    'awaps.yandex' + '.ru', 'advertising.yandex' + '.ru',
    'adfox' + '.ru', 'adriver' + '.ru',
    'ad.mail' + '.ru', 'ads.vk' + '.com', 'ads.vk' + '.ru',
    'criteo' + '.com', 'criteo' + '.net',
    'taboola' + '.com', 'outbrain' + '.com', 'mytarget' + '.ru',
    'smi2' + '.ru', 'smi2' + '.net', 'lentainform' + '.com',
    'marketgid' + '.com', 'mgid' + '.com', 'directadvert' + '.ru',
    'nativeroll' + '.tv', 'videonow' + '.ru', 'seedr' + '.ru',
  ];
  const CARD_HINT_RE = /(?:^|[-_])(?:card|teaser|feed|item|tile|article|banner|advert|promo|native|snippet|adv)(?:[-_]|$)/i;

  function looksLikeAdLabel(text) {
    const t = A.norm(text);
    if (!t || t.length > AD_LABEL_MAX) return false;
    if (/^реклам/.test(t) && t.length <= 20) return true;
    if (/^erid/.test(t) && t.length <= 60) return true;
    if (/^(ad|ads|advert|advertisement|sponsored|adchoices)$/.test(t)) return true;
    return false;
  }

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

  function findCard(el, maxDepth = 8) {
    let node = el;
    for (let i = 0; i < maxDepth && node && node !== document.body; i++) {
      if (A.PROTECTED_TAGS.has(node.tagName) || node.tagName === 'ASIDE') break;
      if (node.querySelectorAll?.('img').length > 2) break;
      const cls = A.safeClassName(node);
      if (node.matches?.('[data-testid*="card"],[data-testid*="teaser"],[data-ad],[data-banner],[data-erid],[data-ad-click],[data-ad_id],[data-adv],[data-adv-id],[data-rtb],[data-teaser]') || (cls && CARD_HINT_RE.test(cls) && node.querySelector('a, article'))) return node;
      node = node.parentElement;
    }
    node = el.parentElement;
    for (let i = 0; i < maxDepth && node && node !== document.body; i++) {
      if (A.PROTECTED_TAGS.has(node.tagName) || node.tagName === 'ASIDE') break;
      if (node.querySelectorAll?.('img').length > 2) break;
      const textLen = (node.textContent || '').length;
      if (node.querySelector('a') && textLen > 10 && textLen < 450) return node;
      node = node.parentElement;
    }
    return null;
  }
  function hideObfuscatedMailruAds() {
    const h = A.state.hostname;
    if (h !== 'mail.ru' && !h.endsWith('.mail.ru')) return 0;
    let hidden = 0;

    const isSafeWidget = (el) => {
      if (!el) return true;
      if (el.querySelector?.('[data-testid="mailbox"], [class*="mailbox-container"], [class*="news"], [class*="tabs_container"], footer')) return true;
      const txt = (el.textContent || '').slice(0, 300);
      if (/Создать почту|Гороскоп|Рассчитайте отпуск|Помощь/i.test(txt)) return true;
      return false;
    };

    const climbAdRoot = (startEl) => {
      let box = startEl;
      let steps = 0;
      while (box.parentElement && box.parentElement !== document.body && steps < 60) {
        const p = box.parentElement;
        if (A.PROTECTED_TAGS.has(p.tagName) || isSafeWidget(p)) break;
        const pCls = A.safeClassName(p);
        if (pCls.includes('grid') && !pCls.includes('widget_container')) break;
        box = p;
        steps++;
      }
      return box;
    };

    document.querySelectorAll('[class*="tgb-wrapper"]').forEach((el) => {
      if (A.hideNode(el, 'mailru-tgb-wrapper')) hidden++;
    });

    document.querySelectorAll('[data-bem], [data-mnemo]').forEach((el) => {
      if (el.dataset.astraHidden) return;
      const bem = el.getAttribute('data-bem') || '';
      const mnemo = el.getAttribute('data-mnemo') || '';
      if (!A.isObfuscatedHash(bem) && !A.isObfuscatedHash(mnemo)) return;

      const root = climbAdRoot(el);
      if (root && !isSafeWidget(root) && A.hideNode(root, 'mailru-vk-adtech')) {
        hidden++;
      }
    });

    document.querySelectorAll('div, span').forEach((el) => {
      if (el.dataset.astraHidden || el.children.length < 2 || el.children.length > 8) return;
      const raw = (el.textContent || '').replace(/\s+/g, '').toLowerCase();
      const rev = raw.split('').reverse().join('');
      if (raw !== 'реклама' && raw !== 'промо' && rev !== 'реклама' && rev !== 'промо') return;

      const root = climbAdRoot(el);
      if (root && root !== el && !isSafeWidget(root) && A.hideNode(root, 'mailru-split-ad-label')) {
        hidden++;
      }
    });

    return hidden;
  }

  A.hideNativeAds = () => {
    const st = A.state;
    if (st.isWhitelisted || !st.runtimeCfg.enabled || !st.runtimeCfg.modules.ads) return 0;
    let hidden = hideObfuscatedMailruAds();

    document.querySelectorAll('[id^="yandex_rtb"], [id*="yandex_rtb"], [class*="yandex-rtb"], [id^="adfox"], [id^="AdFox"], [id*="MarketGid"], [id*="MGID"], [id^="smi2"], [data-erid], [data-rtb]').forEach(el => {
      if (A.hideNode(el, 'yandex-direct-ad')) hidden++;
    });

    const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT, {
      acceptNode(n) {
        if (!n.nodeValue) return NodeFilter.FILTER_REJECT;
        const parent = n.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        if (/^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|CODE|PRE)$/.test(parent.tagName)) return NodeFilter.FILTER_REJECT;
        const t = n.nodeValue.trim();
        if (!t || t.length > AD_LABEL_MAX) return NodeFilter.FILTER_REJECT;
        return looksLikeAdLabel(t) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      },
    });

    let tn;
    while ((tn = walker.nextNode())) {
      const host = tn.parentElement;
      if (!host) continue;
      const card = findCard(host);
      if (card && A.hideNode(card, 'label:' + A.norm(tn.nodeValue).slice(0, 10))) hidden++;
    }

    document.querySelectorAll('a[href*="erid"], a[href*="utm_source=ad"], a[href*="utm_medium=cpc"], a[href*="adriver"]').forEach((a) => {
      const card = findCard(a);
      if (card && A.hideNode(card, 'erid-link')) hidden++;
    });

    document.querySelectorAll('[data-erid],[data-ad],[data-ad-click],[data-banner],[data-banner-id],[data-ad_id],[data-adv],[data-adv-id],[data-ad-slot],[data-rtb],[data-teaser]').forEach((el) => {
      if (A.hideNode(el, 'data-attr')) hidden++;
    });
    return hidden;
  };
  A.hideAdIframes = () => {
    const st = A.state;
    if (st.isWhitelisted || !st.runtimeCfg.enabled || !st.runtimeCfg.modules.ads) return 0;
    let hidden = 0;
    document.querySelectorAll('iframe').forEach((fr) => {
      if (fr.dataset.astraHidden) return;
      let src = '';
      try { src = fr.src || fr.getAttribute('src') || ''; } catch {}
      if (!src) return;
      const lower = src.toLowerCase();
      if (AD_HOST_PATTERNS.some((h) => lower.includes(h))) {
        if (A.hideNode(fr, 'ad-iframe')) hidden++;
        if (fr.parentElement && !A.PROTECTED_TAGS.has(fr.parentElement.tagName)) {
          A.hideNode(fr.parentElement, 'iframe-parent');
        }
      }
    });
    return hidden;
  };

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
  // 🕵️‍♂️ GHOSTERY BLOCKER + ANALYZER
  // ============================================================
  function collectPageFeatures() {
    const ids = new Set();
    const classes = new Set();
    const hrefs = new Set();

    document.querySelectorAll('*').forEach(el => {
      if (el.id) ids.add(el.id);
      el.classList.forEach(c => classes.add(c));
    });

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

      let styleEl = document.getElementById('astra-ghostery-style');
      if (!styleEl) {
        styleEl = document.createElement('style');
        styleEl.id = 'astra-ghostery-style';
        (document.head || document.documentElement).appendChild(styleEl);
      }
      styleEl.textContent = resp.styles;
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
      if (!cfg.enabled || !cfg.modules.ads) return;
      A.scanStaticCssHiddenAds();
      A.hideNativeAds();
      A.hideAdIframes();
      A.smartScanAds();
    }, 350);
    new MutationObserver(run).observe(document.documentElement, { childList: true, subtree: true });
    new Array(400, 1200, 2500, 6000).forEach((ms) => setTimeout(run, ms));
  };
})();
