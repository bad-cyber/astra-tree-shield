// content-script.js — Astra · Древо Щит · v0.6.0-dev
(() => {
  'use strict';
  if (window.__astraShieldLoaded) return;
  window.__astraShieldLoaded = true;

  const LOCAL_WHITELIST = [
    'gosuslugi.ru', 'nalog.gov.ru', 'sberbank.ru', 'tinkoff.ru',
    'alfabank.ru', 'vtb.ru', 'gazprombank.ru', 'yoomoney.ru',
    'github.com', 'google.com', 'youtube.com', 'wikipedia.org',
  ];
  const hostname = location.hostname;
  let isWhitelisted = LOCAL_WHITELIST.some(
    (d) => hostname === d || hostname.endsWith('.' + d)
  );

  // Проверка валидности контекста
  const isContextValid = () => {
    try { return !!chrome.runtime && !!chrome.runtime.id; }
    catch { return false; }
  };

  const norm = (s) =>
    (s || '').replace(/[\u200B-\u200D\uFEFF]/g, '').replace(/[ёЁ]/g, 'е')
      .replace(/\s+/g, ' ').trim().toLowerCase();

  const debounce = (fn, ms) => {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  };
  const safeClassName = (node) => {
    if (!node) return '';
    const c = node.className;
    return typeof c === 'string' ? c : (c && c.baseVal ? c.baseVal : '');
  };

  // Проверка одноразовых обфусцированных хэш-ID/классов (напр. Ijf3kr2, JT5v360, siQtO9Y)
  const isObfuscatedHash = (val) => {
    if (!val || typeof val !== 'string') return false;
    if (val.length < 6 || val.length > 14) return false;
    if (/[-_]/.test(val)) return false;
    return /\d/.test(val) && /[a-zA-Z]/.test(val);
  };

  // ============================================================
  // 📊 ЕДИНЫЙ РЕЕСТР ЗАБЛОКИРОВАННЫХ DOM-БЛОКОВ (B15 / B16)
  // ============================================================
  const reportedBlockKeys = new Set();
  const accumulatedBlocks = [];

  const flushDomBlocks = debounce(() => {
    if (!accumulatedBlocks.length || !isContextValid()) return;
    try {
      chrome.runtime.sendMessage({
        type: 'REPORT_DOM_BLOCKS',
        blocks: accumulatedBlocks.slice(0, 100),
      }).catch(() => {});
    } catch {}
  }, 600);
  function buildShortSelector(el) {
    if (!el || !el.tagName) return 'unknown';
    const tag = el.tagName.toLowerCase();
    if (el.id && !isObfuscatedHash(el.id)) return `${tag}#${el.id}`;
    const cls = safeClassName(el).trim().split(/\s+/).filter((c) => c && !isObfuscatedHash(c)).slice(0, 2);
    if (cls.length) return `${tag}.${cls.join('.')}`;
    for (const attr of ['data-erid', 'data-ad', 'data-ad-slot', 'data-testid', 'data-adv', 'data-rtb']) {
      if (el.hasAttribute?.(attr)) return `${tag}[${attr}]`;
    }
    return tag;
  }

  function extractBlockStructure(el, selector, preRect = null) {
    const rect = preRect || el.getBoundingClientRect();
    const links = Array.from(el.querySelectorAll('a[href]')).map(a => a.href).filter(Boolean);
    const images = Array.from(el.querySelectorAll('img[src]')).map(img => img.src).filter(Boolean);
    const iframes = Array.from(el.querySelectorAll('iframe[src]')).map(f => f.src).filter(Boolean);
    const clone = el.cloneNode(true);
    clone.querySelectorAll?.('style, script, noscript').forEach(n => n.remove());
    const text = (clone.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 500);
    return {
      selector,
      tag: el.tagName.toLowerCase(),
      rect: {
        x: Math.round(rect.x || 0),
        y: Math.round(rect.y || 0),
        width: Math.round(rect.width || 0),
        height: Math.round(rect.height || 0),
      },
      links,
      images,
      iframes,
      text,
    };
  }

  function recordHiddenBlock(el, selector, preRect = null) {
    if (!el || !selector) return;
    const key = `${selector}|${el.id || ''}|${safeClassName(el).slice(0, 60)}`;
    if (reportedBlockKeys.has(key)) return;
    reportedBlockKeys.add(key);

    const struct = extractBlockStructure(el, selector, preRect);
    accumulatedBlocks.push(struct);
    flushDomBlocks();
  }

  // ТОСТЫ
  const TOAST_CSS = `
    .astra-toast-stack{position:fixed;top:16px;right:16px;z-index:2147483647;
      display:flex;flex-direction:column;gap:8px;pointer-events:none;
      font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
    .astra-toast{position:relative;pointer-events:auto;min-width:260px;max-width:380px;
      background:rgba(20,24,32,.96);color:#e9eef5;border-radius:12px;
      padding:12px 14px;box-shadow:0 8px 24px rgba(0,0,0,.35);
      border:1px solid rgba(255,255,255,.08);font-size:13px;line-height:1.45;
      animation:astra-in .22s ease-out}
    .astra-toast--warn{border-color:rgba(255,176,32,.55)}
    .astra-toast--danger{border-color:rgba(239,68,68,.6)}
    .astra-toast__title{font-weight:600;margin-bottom:4px;font-size:13px}
    .astra-toast__close{position:absolute;top:6px;right:8px;cursor:pointer;
      opacity:.6;font-size:16px;line-height:1}
    .astra-toast__close:hover{opacity:1}
    @keyframes astra-in{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:none}}
  `;
  let toastStack = null, toastStyleInjected = false;
  const toastCooldown = new Map();
  function ensureToastStack() {
    if (toastStack && document.body && document.body.contains(toastStack)) return toastStack;
    if (!toastStyleInjected) {
      const s = document.createElement('style');
      s.id = 'astra-toast-style';
      s.textContent = TOAST_CSS;
      (document.head || document.documentElement).appendChild(s);
      toastStyleInjected = true;
    }
    toastStack = document.createElement('div');
    toastStack.className = 'astra-toast-stack';
    (document.body || document.documentElement).appendChild(toastStack);
    return toastStack;
  }

  function showToast({ title, message, kind = 'info', ttl = 6000 }) {
    const key = title + '|' + (message || '');
    const now = Date.now();
    if (now - (toastCooldown.get(key) || 0) < 15000) return;
    toastCooldown.set(key, now);

    const stack = ensureToastStack();
    const t = document.createElement('div');
    t.className = `astra-toast astra-toast--${kind}`;

    const close = document.createElement('span');
    close.className = 'astra-toast__close';
    close.textContent = '×';
    close.addEventListener('click', () => t.remove());
    t.append(close);

    const h = document.createElement('div');
    h.className = 'astra-toast__title';
    h.textContent = title;
    t.append(h);
    if (message) {
      const p = document.createElement('div');
      p.textContent = message;
      t.append(p);
    }
    stack.append(t);
    if (ttl > 0) setTimeout(() => t.remove(), ttl);
  }

  // CSS
  function injectAdblockCSS() {
    if (isWhitelisted) return;
    if (document.getElementById('astra-adblock-style')) return;
    try {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.id = 'astra-adblock-style';
      link.href = chrome.runtime.getURL('src/content/adblock.css');
      (document.head || document.documentElement).appendChild(link);
    } catch (e) { console.warn('[Astra] injectAdblockCSS failed:', e); }
  }

  // Сканирование элементов, уже скрытых статическим adblock.css (B16 + B25/B26)
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
  function scanStaticCssHiddenAds() {
    if (isWhitelisted) return;
    for (const sel of STATIC_ADBLOCK_SELECTORS) {
      try {
        document.querySelectorAll(sel).forEach((el) => {
          if (PROTECTED_TAGS.has(el.tagName)) return;
          if (el.dataset.astraHidden) return;
          if (el.closest?.('.astra-toast-stack') || el.closest?.('#astra-picker-hint')) return;
          if (getComputedStyle(el).display === 'none') {
            el.dataset.astraHidden = '1';
            el.dataset.astraReason = 'adblock-css';
            recordHiddenBlock(el, `[CSS] ${sel}`, { x: 0, y: 0, width: 0, height: 0 });
          }
        });
      } catch {}
    }
  }

  async function applyUserAdBase() {
    try {
      if (!isContextValid()) return;
      const { astraUserAdBase = [] } = await chrome.storage.local.get('astraUserAdBase');
      const selectors = astraUserAdBase
        .filter((r) => r.host === location.hostname || r.host === '*')
        .map((r) => r.selector).filter(Boolean);
      if (!selectors.length) {
        document.getElementById('astra-user-style')?.remove();
        return;
      }
      let styleEl = document.getElementById('astra-user-style');
      if (!styleEl) {
        styleEl = document.createElement('style');
        styleEl.id = 'astra-user-style';
        (document.head || document.documentElement).appendChild(styleEl);
      }
      styleEl.textContent = selectors.map((s) => `${s}{display:none !important}`).join('\n');

      for (const sel of selectors) {
        try {
          document.querySelectorAll(sel).forEach((el) => {
            if (!el.dataset.astraHidden) {
              el.dataset.astraHidden = '1';
              el.dataset.astraReason = 'user-dna';
              recordHiddenBlock(el, `[DNA] ${sel}`, { x: 0, y: 0, width: 0, height: 0 });
            }
          });
        } catch {}
      }
    } catch (e) { console.warn('[Astra] applyUserAdBase:', e); }
  }

  function extractAdDNA(el) {
    const rules = new Set();
    const tag = el.tagName.toLowerCase();
    const classes = safeClassName(el).split(/\s+/).filter(Boolean);
    const attrs = ['data-ad', 'data-erid', 'data-ad-slot', 'data-ad-click', 'data-adv', 'data-adv-id', 'data-rtb', 'data-teaser', 'data-testid'];

    for (const attr of attrs) {
      if (el.hasAttribute(attr)) {
        rules.add(`[${attr}]`);
        const val = el.getAttribute(attr);
        if (val && !/^\d+$/.test(val) && !isObfuscatedHash(val) && val.length < 30) {
          rules.add(`[${attr}="${CSS.escape(val)}"]`);
        }
      }
    }

    for (const c of classes) {
      if (isObfuscatedHash(c)) continue;
      const lower = c.toLowerCase();
      if (/(?:^|[-_])(ad|ads|adv|banner|promo|sponsor|teaser|native)(?:[-_]|$)/i.test(lower)) {
        rules.add(`.${CSS.escape(c)}`);
        const parts = lower.split(/[-_]/);
        const prefix = parts.at(0);
        if (parts.length > 1 && prefix && /^(ad|ads|adv|banner|promo|sponsor|teaser|native|rtb|direct)$/i.test(prefix)) {
          rules.add(`[class^="${CSS.escape(prefix)}-"]`);
        }
      }
    }
    if (tag === 'iframe') {
      const src = (el.getAttribute('src') || '').toLowerCase();
      if (src.includes('ads') || src.includes('banner') || src.includes('doubleclick')) {
        const w = el.offsetWidth;
        const h = el.offsetHeight;
        if (w > 100 && h > 50) {
          rules.add(`iframe[width="${w}"][height="${h}"]`);
        }
      }
    }

    if (rules.size === 0) {
      rules.add(buildPath(el));
    }
    return Array.from(rules);
  }

  function saveUserAdRule(selector, el) {
    if (!isContextValid()) return;
    const dnaRules = extractAdDNA(el);
    chrome.storage.local.get('astraUserAdBase').then(({ astraUserAdBase = [] }) => {
      let added = false;
      for (const dna of dnaRules) {
        const isExact = dna.startsWith('#') || dna.includes('nth-child');
        const rule = {
          id: 'ua_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
          host: isExact ? location.hostname : '*',
          selector: dna,
          tag: el.tagName,
          classes: safeClassName(el).slice(0, 300),
          size: el.offsetWidth + 'x' + el.offsetHeight,
          ts: Date.now(),
          isDNA: !isExact
        };
        if (!astraUserAdBase.some(r => r.selector === rule.selector && r.host === rule.host)) {
          astraUserAdBase.push(rule);
          added = true;
        }
      }
      if (added) {
        chrome.storage.local.set({ astraUserAdBase }).then(() => {
          applyUserAdBase();
          showToast({
            title: 'Astra: Ad DNA применено',
            message: `Создано универсальных правил: ${dnaRules.length}`,
            kind: 'info',
          });
        });
      }
    });
    return selector;
  }

  // ELEMENT PICKER
  const PICKER_CSS = `
    .astra-pick-hover{outline:3px solid #ff3b30 !important;outline-offset:-3px !important;
      background:rgba(255,59,48,.08) !important;cursor:crosshair !important}
    #astra-picker-hint{position:fixed;bottom:20px;left:50%;transform:translateX(-50%);
      background:#141820;color:#e9eef5;padding:12px 20px;border-radius:12px;
      font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
      font-size:13px;font-weight:600;box-shadow:0 8px 24px rgba(0,0,0,.4);
      border:1px solid rgba(255,255,255,.1);z-index:2147483647;pointer-events:none;
      max-width:90vw;text-align:center}
    #astra-picker-hint b{color:#ff8a80}
  `;
  const pickState = { active: false, lastHover: null };
  function injectPickerStyles() {
    if (document.getElementById('astra-picker-style')) return;
    const s = document.createElement('style');
    s.id = 'astra-picker-style';
    s.textContent = PICKER_CSS;
    (document.head || document.documentElement).appendChild(s);
  }
  function showPickerHint() {
    const h = document.createElement('div');
    h.id = 'astra-picker-hint';
    h.innerHTML = '🎯 Astra: наведите на рекламу и кликните. <b>Esc</b> — отмена.';
    (document.body || document.documentElement).appendChild(h);
  }
  function hidePickerHint() {
    const h = document.getElementById('astra-picker-hint');
    if (h) h.remove();
  }
  function startPickMode() {
    if (pickState.active || isWhitelisted) return;
    pickState.active = true;
    injectPickerStyles();
    showPickerHint();
    document.documentElement.style.cursor = 'crosshair';
    document.addEventListener('mousemove', onPickMove, true);
    document.addEventListener('click', onPickClick, true);
    document.addEventListener('keydown', onPickKey, true);
  }
  function stopPickMode() {
    pickState.active = false;
    if (pickState.lastHover) pickState.lastHover.classList.remove('astra-pick-hover');
    pickState.lastHover = null;
    hidePickerHint();
    document.documentElement.style.cursor = '';
    document.removeEventListener('mousemove', onPickMove, true);
    document.removeEventListener('click', onPickClick, true);
    document.removeEventListener('keydown', onPickKey, true);
  }
  function onPickMove(e) {
    if (!pickState.active) return;
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el || el === pickState.lastHover) return;
    if (pickState.lastHover) pickState.lastHover.classList.remove('astra-pick-hover');
    el.classList.add('astra-pick-hover');
    pickState.lastHover = el;
  }
  function onPickClick(e) {
    if (!pickState.active) return;
    e.preventDefault();
    e.stopPropagation();
    const el = e.target;
    if (!el || el.closest('#astra-picker-hint')) return;

    if (pickState.lastHover) pickState.lastHover.classList.remove('astra-pick-hover');
    el.classList.remove('astra-pick-hover');
    saveUserAdRule(null, el);
    hideNode(el, 'user-pick');
    stopPickMode();
  }
  function onPickKey(e) {
    if (e.key === 'Escape') {
      stopPickMode();
      showToast({ title: 'Astra', message: 'Режим выбора отменён', kind: 'info', ttl: 3000 });
    }
  }

  function buildPath(el) {
    const parts = [];
    let node = el, depth = 0;
    while (node && node !== document.body && depth < 6) {
      let seg = node.tagName.toLowerCase();
      if (node.id && !/astra/i.test(node.id) && !isObfuscatedHash(node.id)) {
        parts.unshift(seg + '#' + CSS.escape(node.id));
        break;
      }
      const parent = node.parentElement;
      if (parent) {
        const idx = Array.from(parent.children).indexOf(node) + 1;
        seg += `:nth-child(${idx})`;
      }
      parts.unshift(seg);
      node = parent;
      depth++;
    }
    return parts.join(' > ');
  }
  // WASM HOOKS
  let wasmCount = 0, wasmFirstTs = 0, wasmWarned = false;
  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data || e.data.__astra !== true) return;
    const hook = e.data.hook;
    if (hook === 'wasm-instantiate') {
      const now = Date.now();
      if (!wasmFirstTs || now - wasmFirstTs > 10000) {
        wasmCount = 1; wasmFirstTs = now; wasmWarned = false;
      } else wasmCount++;
      if (wasmCount >= 5 && !wasmWarned) {
        wasmWarned = true;
        showToast({ title: 'Astra: массовый WASM', message: `Страница запустила ${wasmCount} WASM-модулей за 10 сек.`, kind: 'warn' });
      }
    }
    if (hook === 'worker-spawn') {
      showToast({ title: 'Astra: майнер?', message: 'Запущен Worker с признаками майнера.', kind: 'danger' });
      if (isContextValid()) {
        try { chrome.runtime.sendMessage({ type: 'REPORT_THREAT', kind: 'miner' }).catch(() => {}); } catch {}
      }
    }
  });

  // CLICKJACKING
  function guardClickjacking() {
    if (window.top !== window.self) return;
    const scan = () => {
      const iframes = document.querySelectorAll('iframe:not([data-astra-hidden])');
      for (const fr of iframes) {
        const st = getComputedStyle(fr);
        const op = parseFloat(st.opacity);
        const z = parseInt(st.zIndex, 10) || 0;
        if (op < 0.1 && z > 999 && fr.offsetWidth > 200 && fr.offsetHeight > 100) {
          fr.dataset.astraHidden = '1';
          fr.style.setProperty('display', 'none', 'important');
          showToast({ title: 'Astra: кликджекинг', message: 'Скрыт прозрачный iframe-оверлей.', kind: 'danger' });
        }
      }
    };
    scan();
    new MutationObserver(debounce(scan, 500)).observe(document.documentElement, { childList: true, subtree: true });
  }

  // HTTP
  function checkHttpDowngrade() {
    if (window.top !== window.self) return;
    if (location.protocol === 'https:') {
      const mixed = document.querySelectorAll('img[src^="http://"], script[src^="http://"], link[href^="http://"], iframe[src^="http://"]');
      if (mixed.length) showToast({ title: 'Astra: смешанный контент', message: `На HTTPS-странице найдено ${mixed.length} HTTP-ресурсов.`, kind: 'warn' });
    } else {
      showToast({ title: 'Astra: небезопасное соединение', message: 'Сайт открыт по HTTP. Данные могут быть перехвачены.', kind: 'warn', ttl: 9000 });
    }
  }

  // AD SCORING
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
  const PROTECTED_TAGS = new Set(['BODY', 'HTML', 'MAIN', 'HEADER', 'NAV', 'FOOTER']);
  function looksLikeAdLabel(text) {
    const t = norm(text);
    if (!t || t.length > AD_LABEL_MAX) return false;
    if (/^реклам/.test(t) && t.length <= 20) return true;
    if (/^erid/.test(t) && t.length <= 60) return true;
    if (/^(ad|ads|advert|advertisement|sponsored|adchoices)$/.test(t)) return true;
    return false;
  }

  function scoreAdCandidate(el) {
    let score = 0;
    const cls = safeClassName(el);
    const id = el.id || '';
    const w = el.offsetWidth, h = el.offsetHeight;

    if (AD_SIZE_PATTERNS.some(([pw, ph]) => Math.abs(w - pw) < 5 && Math.abs(h - ph) < 5)) score += 30;
    if (/(?:^|[-_])(?:ad|adv|banner|promo|sponsor|native|teaser)(?:[-_]|$)/i.test(cls + ' ' + id)) score += 25;
    if (el.querySelector?.('iframe[src*="doubleclick"], iframe[src*="googlesyndication"], iframe[src*="yabs.yandex"], iframe[src*="adfox"], iframe[src*="adriver"], iframe[src*="smi2"], iframe[src*="mgid"], iframe[src*="nativeroll"]')) score += 25;
    if (el.tagName === 'IFRAME' && AD_SIZE_PATTERNS.some(([pw, ph]) => Math.abs(w - pw) < 5 && Math.abs(h - ph) < 5)) score += 20;
    if (el.matches?.('[data-erid],[data-ad],[data-ad-click],[data-banner-id],[data-ad_id],[data-adv],[data-adv-id],[data-rtb],[data-teaser]')) score += 35;
    if (el.querySelector?.('a[href*="erid"], a[href*="adriver"], a[href*="utm_source=ad"], a[href*="utm_medium=cpc"]')) score += 15;

    const text = norm((el.textContent || '').slice(0, 100));
    if (/\b(реклама|sponsored|advert|erid)\b/i.test(text)) score += 15;

    const st = getComputedStyle(el);
    if (st.position === 'fixed' && parseInt(st.zIndex || '0') > 999) score += 10;
    return score;
  }

  function isProtectedSearchOrBanner(node) {
    if (!node || node.nodeType !== 1) return false;
    if (node.matches?.('[role="banner"], [role="search"], input[name="text"]')) return true;
    if (node.closest?.('[role="banner"], [role="search"]')) return true;
    if (node.querySelector?.('[role="banner"], [role="search"], input[name="text"]')) return true;
    return false;
  }

  function hideNode(node, reason, customSelector = null) {
    if (!node || PROTECTED_TAGS.has(node.tagName)) return false;
    if (isProtectedSearchOrBanner(node)) return false;
    if (node.dataset.astraHidden) return false;
    if (node.closest?.('.astra-toast-stack')) return false;
    if (node.closest?.('#astra-picker-hint')) return false;

    const rect = node.getBoundingClientRect();
    node.dataset.astraHidden = '1';
    node.dataset.astraReason = reason || 'native-ad';
    node.style.setProperty('display', 'none', 'important');

    const label = customSelector || `[${reason || 'filter'}] ${buildShortSelector(node)}`;
    recordHiddenBlock(node, label, rect);
    return true;
  }

  function hideObfuscatedMailruAds() {
    if (hostname !== 'mail.ru' && !hostname.endsWith('.mail.ru')) return 0;
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
        if (PROTECTED_TAGS.has(p.tagName) || isSafeWidget(p)) break;
        const pCls = safeClassName(p);
        if (pCls.includes('grid') && !pCls.includes('widget_container')) break;
        box = p;
        steps++;
      }
      return box;
    };
    // 1. Стабильный класс верхней рекламной перетяжки VK AdTech
    document.querySelectorAll('[class*="tgb-wrapper"]').forEach((el) => {
      if (hideNode(el, 'mailru-tgb-wrapper')) hidden++;
    });

    // 2. Поиск по обфусцированным data-bem / data-mnemo (ловушки VK AdTech)
    document.querySelectorAll('[data-bem], [data-mnemo]').forEach((el) => {
      if (el.dataset.astraHidden) return;
      const bem = el.getAttribute('data-bem') || '';
      const mnemo = el.getAttribute('data-mnemo') || '';
      if (!isObfuscatedHash(bem) && !isObfuscatedHash(mnemo)) return;

      const root = climbAdRoot(el);
      if (root && !isSafeWidget(root) && hideNode(root, 'mailru-vk-adtech')) {
        hidden++;
      }
    });

    // 3. Поиск по разбитой или перевёрнутой метке «Реклама» («амекалкер» / «реклама»)
    document.querySelectorAll('div, span').forEach((el) => {
      if (el.dataset.astraHidden || el.children.length < 2 || el.children.length > 8) return;
      const raw = (el.textContent || '').replace(/\s+/g, '').toLowerCase();
      const rev = raw.split('').reverse().join('');
      if (raw !== 'реклама' && raw !== 'промо' && rev !== 'реклама' && rev !== 'промо') return;

      const root = climbAdRoot(el);
      if (root && root !== el && !isSafeWidget(root) && hideNode(root, 'mailru-split-ad-label')) {
        hidden++;
      }
    });

    return hidden;
  }

  function hideNativeAds() {
    if (isWhitelisted) return 0;
    let hidden = hideObfuscatedMailruAds();

    // ЖЕСТКИЕ ПРАВИЛА ДЛЯ ЯНДЕКСА И ТИЗЕРНЫХ СЕТЕЙ
    document.querySelectorAll('[id^="yandex_rtb"], [id*="yandex_rtb"], [class*="yandex-rtb"], [id^="adfox"], [id^="AdFox"], [id*="MarketGid"], [id*="MGID"], [id^="smi2"], [data-erid], [data-rtb]').forEach(el => {
      if (hideNode(el, 'yandex-direct-ad')) hidden++;
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
      if (card && hideNode(card, 'label:' + norm(tn.nodeValue).slice(0, 10))) hidden++;
    }

    document.querySelectorAll('a[href*="erid"], a[href*="utm_source=ad"], a[href*="utm_medium=cpc"], a[href*="adriver"]').forEach((a) => {
      const card = findCard(a);
      if (card && hideNode(card, 'erid-link')) hidden++;
    });

    document.querySelectorAll('[data-erid],[data-ad],[data-ad-click],[data-banner],[data-banner-id],[data-ad_id],[data-adv],[data-adv-id],[data-ad-slot],[data-rtb],[data-teaser]').forEach((el) => {
      if (hideNode(el, 'data-attr')) hidden++;
    });
    return hidden;
  }
  function hideAdIframes() {
    if (isWhitelisted) return 0;
    let hidden = 0;
    document.querySelectorAll('iframe').forEach((fr) => {
      if (fr.dataset.astraHidden) return;
      let src = '';
      try { src = fr.src || fr.getAttribute('src') || ''; } catch {}
      if (!src) return;
      const lower = src.toLowerCase();
      if (AD_HOST_PATTERNS.some((h) => lower.includes(h))) {
        if (hideNode(fr, 'ad-iframe')) hidden++;
        if (fr.parentElement && !PROTECTED_TAGS.has(fr.parentElement.tagName)) {
          hideNode(fr.parentElement, 'iframe-parent');
        }
      }
    });
    return hidden;
  }

  function smartScanAds() {
    if (isWhitelisted) return 0;
    let hidden = 0;
    const candidates = new Set();
    document.querySelectorAll('div, aside, section, article, iframe, [data-testid], [class*="banner"], [class*="advert"], [class*="promo"], [class*="sponsor"], [class*="teaser"]').forEach((el) => {
      if (el.dataset.astraHidden || PROTECTED_TAGS.has(el.tagName)) return;
      if (el.offsetWidth < 100 || el.offsetHeight < 50) return;
      if (el.offsetWidth > 4000 || el.offsetHeight > 2500) return;
      if (el.textContent && el.textContent.length > 4000) return;
      candidates.add(el);
    });

    candidates.forEach((el) => {
      const score = scoreAdCandidate(el);
      if (score >= 60 && hideNode(el, `smart-score:${score}`)) hidden++;
    });

    document.querySelectorAll('div:empty, aside:empty, section:empty').forEach((el) => {
      if (el.dataset.astraHidden || PROTECTED_TAGS.has(el.tagName)) return;
      const w = el.offsetWidth, h = el.offsetHeight;
      if (w > 100 && h > 50) {
        const cls = safeClassName(el).toLowerCase();
        if (/ad|banner|promo|sponsor|teaser|native/i.test(cls) || AD_SIZE_PATTERNS.some(([pw, ph]) => Math.abs(w - pw) < 5 && Math.abs(h - ph) < 5)) {
          if (hideNode(el, 'empty-ad-container')) hidden++;
        }
      }
    });
    return hidden;
  }

  function findCard(el, maxDepth = 8) {
    let node = el;
    for (let i = 0; i < maxDepth && node && node !== document.body; i++) {
      if (PROTECTED_TAGS.has(node.tagName) || node.tagName === 'ASIDE') break;
      if (node.querySelectorAll?.('img').length > 2) break;
      const cls = safeClassName(node);
      if (node.matches?.('[data-testid*="card"],[data-testid*="teaser"],[data-ad],[data-banner],[data-erid],[data-ad-click],[data-ad_id],[data-adv],[data-adv-id],[data-rtb],[data-teaser]') || (cls && CARD_HINT_RE.test(cls) && node.querySelector('a, article'))) return node;
      node = node.parentElement;
    }
    node = el.parentElement;
    for (let i = 0; i < maxDepth && node && node !== document.body; i++) {
      if (PROTECTED_TAGS.has(node.tagName) || node.tagName === 'ASIDE') break;
      if (node.querySelectorAll?.('img').length > 2) break;
      const textLen = (node.textContent || '').length;
      if (node.querySelector('a') && textLen > 10 && textLen < 450) return node;
      node = node.parentElement;
    }
    return null;
  }

  let observerStarted = false;
  function startAdObserver() {
    if (isWhitelisted || observerStarted) return;
    observerStarted = true;
    const run = debounce(() => {
      scanStaticCssHiddenAds();
      hideNativeAds();
      hideAdIframes();
      smartScanAds();
    }, 350);
    new MutationObserver(run).observe(document.documentElement, { childList: true, subtree: true });
    new Array(400, 1200, 2500, 6000).forEach((ms) => setTimeout(run, ms));
  }
  // LOAD MONITOR
  const TRACKER_HOSTS = [
    'doubleclick' + '.net', 'googlesyndication' + '.com', 'googleadservices' + '.com',
    'yabs.yandex', 'an.yandex', 'awaps.yandex', 'advertising.yandex',
    'adfox', 'adriver', 'ad.mail', 'ads.vk', 'criteo', 'taboola', 'outbrain',
    'mytarget', 'mc.yandex', 'top-fwz1', 'r.mail', 'rtrg',
    'smi2', 'lentainform', 'marketgid', 'mgid', 'directadvert', 'nativeroll', 'videonow', 'seedr',
    'facebook' + '.com/tr', 'google-analytics',
  ];

  function isTrackerUrl(url) {
    const u = url.toLowerCase();
    return TRACKER_HOSTS.some((h) => u.includes(h));
  }

  function sendPageMetrics() {
    if (window.top !== window.self) return;
    if (!isContextValid()) return;

    try {
      const resources = performance.getEntriesByType('resource') || [];
      const byType = { script: { bytes: 0, count: 0 }, image: { bytes: 0, count: 0 }, stylesheet: { bytes: 0, count: 0 }, xmlhttprequest: { bytes: 0, count: 0 }, fetch: { bytes: 0, count: 0 }, font: { bytes: 0, count: 0 }, media: { bytes: 0, count: 0 }, other: { bytes: 0, count: 0 } };
      let totalBytes = 0, adBytes = 0;
      const top = [];

      for (const r of resources) {
        const size = r.transferSize || r.decodedBodySize || 0;
        let type = 'other';
        const init = r.initiatorType || '';
        if (init === 'script') type = 'script';
        else if (init === 'img' || init === 'image') type = 'image';
        else if (init === 'link' || init === 'css') type = 'stylesheet';
        else if (init === 'xmlhttprequest') type = 'xmlhttprequest';
        else if (init === 'fetch') type = 'fetch';
        else if (init === 'font') type = 'font';
        else if (init === 'media' || init === 'video' || init === 'audio') type = 'media';

        byType[type].bytes += size;
        byType[type].count += 1;
        totalBytes += size;
        if (isTrackerUrl(r.name)) adBytes += size;

        if (size > 0) top.push({ url: r.name, size, type, duration: Math.round(r.duration || 0), domain: (() => { try { return new URL(r.name).hostname; } catch { return ''; } })(), tracker: isTrackerUrl(r.name) });
      }
      top.sort((a, b) => b.size - a.size);

      const timing = performance.timing || {};
      const domContentLoaded = timing.domContentLoadedEventEnd && timing.navigationStart ? Math.round(timing.domContentLoadedEventEnd - timing.navigationStart) : 0;
      const loadComplete = timing.loadEventEnd && timing.navigationStart ? Math.round(timing.loadEventEnd - timing.navigationStart) : 0;

      const metrics = { url: location.href, host: location.hostname, totalBytes, adBytes, totalCount: resources.length, byType, top: top.slice(0, 15), domContentLoaded, loadComplete, ts: Date.now() };
      try { chrome.runtime.sendMessage({ type: 'PAGE_METRICS', metrics }).catch(() => {}); } catch {}
    } catch (e) { console.warn('[Astra] sendPageMetrics:', e); }
  }

  function scheduleMetrics() {
    if (window.top !== window.self) return;
    if (document.readyState === 'complete') { setTimeout(sendPageMetrics, 1500); setTimeout(sendPageMetrics, 6000); }
    else window.addEventListener('load', () => { setTimeout(sendPageMetrics, 1500); setTimeout(sendPageMetrics, 6000); }, { once: true });
  }
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
        if (!sel.includes('::')) {
          selectors.add(sel);
        }
      }
    }
    return Array.from(selectors);
  }

  const analyzeDomAds = debounce(async () => {
    if (isWhitelisted) return;
    if (!isContextValid()) return;

    const { ids, classes, hrefs } = collectPageFeatures();
    if (ids.length === 0 && classes.length === 0 && hrefs.length === 0) return;

    try {
      const resp = await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({ type: 'GET_COSMETIC_FILTERS', url: location.href, ids, classes, hrefs }, (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve(response);
          }
        });
      });

      if (!resp || !resp.styles) return;

      const selectors = parseGhosterySelectors(resp.styles);
      for (const selector of selectors) {
        try {
          document.querySelectorAll(selector).forEach(el => {
            hideNode(el, 'ghostery', selector);
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
      console.warn('[Astra] Ошибка анализа DOM:', e);
    }
  }, 2500);

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'START_PICK') startPickMode();
    if (msg.type === 'USER_BASE_UPDATED') applyUserAdBase();
    return false;
  });

  async function init() {
    try {
      if (!isContextValid()) return;
      const { userWhitelist = [] } = await chrome.storage.local.get('userWhitelist');
      const inUser = userWhitelist.some((d) => hostname === d || hostname.endsWith('.' + d));
      isWhitelisted = isWhitelisted || inUser;
    } catch {}

    injectAdblockCSS();
    await applyUserAdBase();
    if (isWhitelisted) return;

    if (window.top === window.self) {
      guardClickjacking();
      checkHttpDowngrade();
      scheduleMetrics();
    }

    scanStaticCssHiddenAds();
    hideNativeAds();
    hideAdIframes();
    smartScanAds();
    startAdObserver();

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', analyzeDomAds);
    else analyzeDomAds();

    new MutationObserver(analyzeDomAds).observe(document.documentElement, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
