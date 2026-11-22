/* adblock-static.js — Astra · Древо Щит · v0.7.0
   Статическая DOM-блокировка рекламы: CSS-фильтры, обход обфускации Mail.ru/VK/4PDA, нативные пометки и рекламные iframe.
*/
(() => {
  'use strict';
  const A = (window.AstraShield = window.AstraShield || {});
  if (A.adblockStaticLoaded) return;
  A.adblockStaticLoaded = true;

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
    '[class^="advert-"]', '[class*=" advert-"]', '[class*="advertisement"]', '[class*="adsbygoogle"]',
    '[class*="google-ads"]', '[class^="sponsored-"]', '[class*=" sponsored-"]',
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
  function isRandomCustomTag(el) {
    if (!el || !el.tagName) return false;
    const t = el.tagName;
    if (t.includes('-')) return false;
    return t.length >= 8 && /^[A-Z0-9]+$/.test(t);
  }

  function cleanCssRuleList(ruleList) {
    let removed = 0;
    if (!ruleList) return 0;
    for (let i = ruleList.length - 1; i >= 0; i--) {
      const r = ruleList[i];
      if (r.cssRules) {
        removed += cleanCssRuleList(r.cssRules);
        continue;
      }
      const txt = r.cssText || '';
      const sel = (r.selectorText || '').trim();
      if (/^(?:html|body)\b/i.test(sel) && (/\/s\/[a-z0-9_-]{8,}\./i.test(txt) || /no-repeat\s*!important/i.test(txt))) {
        try {
          (r.parentRule || r.parentStyleSheet)?.deleteRule(i);
          removed++;
        } catch {}
      }
    }
    return removed;
  }

  let astra4pdaAdoptedSheet = null;

  function apply4pdaAdoptedOverride() {
    let removed = 0;
    try {
      const current = Array.isArray(document.adoptedStyleSheets) ? document.adoptedStyleSheets : [];
      for (const sheet of current) {
        if (sheet === astra4pdaAdoptedSheet) continue;
        try {
          removed += cleanCssRuleList(sheet.cssRules);
        } catch {}
      }
      if (!astra4pdaAdoptedSheet) {
        astra4pdaAdoptedSheet = new CSSStyleSheet();
        astra4pdaAdoptedSheet.replaceSync(
          ':root:root:root:root:root:root:root:root html, :root:root:root:root:root:root:root:root body { background: #141518 none !important; background-image: none !important; margin-top: 0 !important; padding-top: 0 !important; } ' +
          ':root:root:root:root:root:root:root:root html::before, :root:root:root:root:root:root:root:root html::after, :root:root:root:root:root:root:root:root body::before, :root:root:root:root:root:root:root:root body::after { content: none !important; display: none !important; background: none !important; }'
        );
      }
      const filtered = current.filter((s) => s !== astra4pdaAdoptedSheet);
      document.adoptedStyleSheets = [...filtered, astra4pdaAdoptedSheet];
    } catch {}
    return removed;
  }

  function hide4pdaFirstPartyAds() {
    const h = A.state.hostname;
    if (h !== '4pda.to' && !h.endsWith('.4pda.to') && h !== '4pda.ws' && !h.endsWith('.4pda.ws')) return 0;
    let hidden = apply4pdaAdoptedOverride();

    try {
      for (const sheet of Array.from(document.styleSheets || [])) {
        let rules;
        try { rules = sheet.cssRules; } catch { continue; }
        hidden += cleanCssRuleList(rules);
      }
    } catch {}

    document.getElementById('astra-4pda-fix')?.remove();
    const fix = document.createElement('style');
    fix.id = 'astra-4pda-fix';
    fix.textContent =
      ':root:root:root:root:root:root:root:root html, :root:root:root:root:root:root:root:root body { background: #141518 none !important; background-image: none !important; margin-top: 0 !important; padding-top: 0 !important; } ' +
      ':root:root:root:root:root:root:root:root html::before, :root:root:root:root:root:root:root:root html::after, :root:root:root:root:root:root:root:root body::before, :root:root:root:root:root:root:root:root body::after { content: none !important; display: none !important; background: none !important; }';
    (document.documentElement || document.head).appendChild(fix);

    document.querySelectorAll('body > *').forEach((el) => {
      if (A.PROTECTED_TAGS.has(el.tagName) || el.dataset?.astraHidden) return;
      if (el.id === 'lightboxoverlay' || el.id === 'lightbox' || el.classList?.contains('mistakes')) return;
      if (el.querySelector('article, main, nav, header, footer, form, input')) return;
      if ((el.textContent || '').trim().length === 0) {
        if (A.hideNode(el, '4pda-side-wallpaper')) hidden++;
      }
    });

    document.querySelectorAll('style').forEach((stEl) => {
      if (stEl.id === 'astra-4pda-fix') return;
      const css = stEl.textContent || '';
      if (/^[a-z0-9]{8,}_\d+$/i.test(stEl.id || '') || (/body\./i.test(css) && /\/s\/[a-z0-9_-]{8,}\./i.test(css)) || /margin-top\s*:\s*\d{2,3}px\s*!important/i.test(css)) {
        stEl.textContent = '';
        stEl.remove();
        hidden++;
      }
    });

    document.querySelectorAll('article.post, [itemtype*="schema.org/Article"]').forEach((art) => {
      if (art.dataset.astraHidden) return;
      const hasGifPixel = !!art.querySelector('img[src*="/s/"][src$=".gif"]');
      const hasMetaPanel = !!art.querySelector('.v-panel, [class*="date"], time');
      const hasPromoAttr = Array.from(art.querySelectorAll('div')).some((d) =>
        Array.from(d.attributes).some((attr) => /^data-[a-z0-9]{10,}$/i.test(attr.name))
      );

      if (hasGifPixel || (!hasMetaPanel && hasPromoAttr)) {
        let target = art;
        const p = art.parentElement;
        if (p && isRandomCustomTag(p) && p.querySelectorAll('article').length <= 1) {
          target = p;
        }
        if (A.hideNode(target, '4pda-promo-article')) hidden++;
      }
    });

    document.querySelectorAll('img[src*="/s/"], iframe[src*="/s/"]').forEach((media) => {
      if (media.dataset?.astraHidden || media.closest('[data-astra-hidden="1"]')) return;
      if (media.closest('article, [itemtype*="Article"], .post, header, nav, footer')) return;
      const src = media.getAttribute('src') || '';
      if (!/\/s\/[a-z0-9_-]{12,}\.(?:jpg|jpeg|png|gif|webp|html)/i.test(src)) return;

      let box = media;
      let cur = media.parentElement;
      for (let i = 0; i < 6 && cur && cur !== document.body; i++) {
        if (A.PROTECTED_TAGS.has(cur.tagName)) break;
        if (cur.querySelector('article, main, nav, header, footer, h1, h2')) break;
        if (cur.classList?.contains('holder-no-fudder')) break;
        if ((cur.textContent || '').trim().length > 80) break;
        box = cur;
        cur = cur.parentElement;
      }
      if (box && A.hideNode(box, '4pda-banner-slot')) hidden++;
    });

    return hidden;
  }

  if (/(?:^|\.)4pda\.(?:to|ws)$/i.test(location.hostname)) {
    const run4pda = () => {
      if (!A.state?.isWhitelisted && A.state?.runtimeCfg?.enabled && A.state?.runtimeCfg?.modules?.ads) {
        hide4pdaFirstPartyAds();
      }
    };
    document.addEventListener('DOMContentLoaded', run4pda, { once: true });
    window.addEventListener('load', run4pda, { once: true });
  }

  A.hideNativeAds = () => {
    const st = A.state;
    if (st.isWhitelisted || !st.runtimeCfg.enabled || !st.runtimeCfg.modules.ads) return 0;
    let hidden = hideObfuscatedMailruAds() + hide4pdaFirstPartyAds();

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

  function isCompactAdWrapper(parent) {
    if (!parent || A.PROTECTED_TAGS.has(parent.tagName)) return false;
    if (parent === document.body || parent === document.documentElement) return false;
    if (parent.querySelector('article, main, nav, header, footer')) return false;
    if (parent.children.length > 2) return false;
    if ((parent.textContent || '').trim().length > 150) return false;
    return true;
  }

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
        if (isCompactAdWrapper(fr.parentElement)) {
          A.hideNode(fr.parentElement, 'iframe-parent');
        }
      }
    });
    return hidden;
  };
})();
