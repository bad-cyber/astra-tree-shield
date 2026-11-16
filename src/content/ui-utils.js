/* ui-utils.js — Astra · Древо Щит · v0.6.3
   Общее состояние контент-скриптов, тосты, реестр скрытых DOM-блоков и утилиты.
*/
(() => {
  'use strict';
  const A = (window.AstraShield = window.AstraShield || {});
  if (A.uiUtilsLoaded) return;
  A.uiUtilsLoaded = true;

  const LOCAL_WHITELIST = [
    'gosuslugi.ru', 'nalog.gov.ru', 'sberbank.ru', 'tinkoff.ru', 'tbank.ru',
    'alfabank.ru', 'vtb.ru', 'gazprombank.ru', 'yoomoney.ru',
    'github.com', 'google.com', 'youtube.com', 'wikipedia.org',
  ];

  const hostname = location.hostname.replace(/^www\./, '');
  A.state = {
    hostname,
    isWhitelisted: LOCAL_WHITELIST.some((d) => hostname === d || hostname.endsWith('.' + d)),
    phishingOverlayShown: false,
    runtimeCfg: {
      enabled: true,
      modules: {
        phishing: true,
        ads: true,
        miners: true,
        downloads: true,
        clickjacking: true,
      },
    },
  };

  A.PROTECTED_TAGS = new Set(['BODY', 'HTML', 'MAIN', 'HEADER', 'NAV', 'FOOTER']);

  A.isContextValid = () => {
    try { return !!chrome.runtime && !!chrome.runtime.id; }
    catch { return false; }
  };

  A.syncRuntimeCfg = async () => {
    if (!A.isContextValid()) return A.state.runtimeCfg;
    try {
      const { config } = await chrome.storage.sync.get('config');
      if (config) {
        A.state.runtimeCfg = {
          enabled: config.enabled !== false,
          modules: { ...A.state.runtimeCfg.modules, ...(config.modules || {}) },
        };
      }
      window.postMessage({
        __astraCtrl: 'SET_MINERS',
        enabled: !!(A.state.runtimeCfg.enabled && A.state.runtimeCfg.modules.miners),
      }, '*');
    } catch {}
    return A.state.runtimeCfg;
  };

  A.norm = (s) =>
    (s || '').replace(/[\u200B-\u200D\uFEFF]/g, '').replace(/[ёЁ]/g, 'е')
      .replace(/\s+/g, ' ').trim().toLowerCase();

  A.debounce = (fn, ms) => {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  };
  A.safeClassName = (node) => {
    if (!node) return '';
    const c = node.className;
    return typeof c === 'string' ? c : (c && c.baseVal ? c.baseVal : '');
  };

  A.isObfuscatedHash = (val) => {
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

  const flushDomBlocks = A.debounce(() => {
    if (!accumulatedBlocks.length || !A.isContextValid()) return;
    try {
      chrome.runtime.sendMessage({
        type: 'REPORT_DOM_BLOCKS',
        blocks: accumulatedBlocks.slice(0, 100),
      }).catch(() => {});
    } catch {}
  }, 600);

  A.buildShortSelector = (el) => {
    if (!el || !el.tagName) return 'unknown';
    const tag = el.tagName.toLowerCase();
    if (el.id && !A.isObfuscatedHash(el.id)) return `${tag}#${el.id}`;
    const cls = A.safeClassName(el).trim().split(/\s+/).filter((c) => c && !A.isObfuscatedHash(c)).slice(0, 2);
    if (cls.length) return `${tag}.${cls.join('.')}`;
    for (const attr of ['data-erid', 'data-ad', 'data-ad-slot', 'data-testid', 'data-adv', 'data-rtb']) {
      if (el.hasAttribute?.(attr)) return `${tag}[${attr}]`;
    }
    return tag;
  };

  A.buildPath = (el) => {
    const parts = [];
    let node = el, depth = 0;
    while (node && node !== document.body && depth < 6) {
      let seg = node.tagName.toLowerCase();
      if (node.id && !/astra/i.test(node.id) && !A.isObfuscatedHash(node.id)) {
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
  };
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

  A.recordHiddenBlock = (el, selector, preRect = null) => {
    if (!el || !selector) return;
    const key = `${selector}|${el.id || ''}|${A.safeClassName(el).slice(0, 60)}`;
    if (reportedBlockKeys.has(key)) return;
    reportedBlockKeys.add(key);

    const struct = extractBlockStructure(el, selector, preRect);
    accumulatedBlocks.push(struct);
    flushDomBlocks();
  };

  A.isProtectedSearchOrBanner = (node) => {
    if (!node || node.nodeType !== 1) return false;
    if (node.matches?.('[role="banner"], [role="search"], input[name="text"]')) return true;
    if (node.closest?.('[role="banner"], [role="search"]')) return true;
    if (node.querySelector?.('[role="banner"], [role="search"], input[name="text"]')) return true;
    return false;
  };

  A.hideNode = (node, reason, customSelector = null) => {
    if (!node || A.PROTECTED_TAGS.has(node.tagName)) return false;
    if (A.isProtectedSearchOrBanner(node)) return false;
    if (node.dataset.astraHidden) return false;
    if (node.closest?.('.astra-toast-stack')) return false;
    if (node.closest?.('#astra-picker-hint')) return false;
    if (node.closest?.('#astra-phishing-shield')) return false;

    const rect = node.getBoundingClientRect();
    node.dataset.astraHidden = '1';
    node.dataset.astraReason = reason || 'native-ad';
    node.style.setProperty('display', 'none', 'important');

    const label = customSelector || `[${reason || 'filter'}] ${A.buildShortSelector(node)}`;
    A.recordHiddenBlock(node, label, rect);
    return true;
  };

  // ============================================================
  // 🔔 СИСТЕМА ТОСТОВ
  // ============================================================
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

  A.showToast = ({ title, message, kind = 'info', ttl = 6000 }) => {
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
  };
})();
