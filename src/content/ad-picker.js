/* ad-picker.js — Astra · Древо Щит · v0.7.1
   Генератор Ad DNA, применение пользовательских правил и пипетка выбора элементов (B46 / B60).
*/
(() => {
  'use strict';
  const A = (window.AstraShield = window.AstraShield || {});
  if (A.adPickerLoaded) return;
  A.adPickerLoaded = true;

  A.applyUserAdBase = async () => {
    try {
      if (!A.isContextValid()) return;
      const { astraUserAdBase = [] } = await chrome.storage.local.get('astraUserAdBase');
      const selectors = astraUserAdBase
        .filter((r) => r.host === location.hostname || r.host === '*')
        .map((r) => r.selector)
        .filter(Boolean);
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
              A.recordHiddenBlock(el, `[DNA] ${sel}`, { x: 0, y: 0, width: 0, height: 0 });
            }
          });
        } catch {}
      }
    } catch (e) {
      console.warn('[Astra] applyUserAdBase:', e);
    }
  };

  const GLOBAL_SAFE_AD_ATTRS = new Set(['data-erid', 'data-ad-slot', 'data-ad-click', 'data-adv-id', 'data-rtb']);

  function extractAdDNA(el) {
    const rules = [];
    const seen = new Set();
    const addRule = (selector, isGlobal = false) => {
      if (!selector || seen.has(selector)) return;
      seen.add(selector);
      rules.push({ selector, isGlobal });
    };

    const tag = el.tagName.toLowerCase();
    const classes = A.safeClassName(el).split(/\s+/).filter(Boolean);
    const attrs = ['data-ad', 'data-erid', 'data-ad-slot', 'data-ad-click', 'data-adv', 'data-adv-id', 'data-rtb', 'data-teaser'];

    for (const attr of attrs) {
      if (el.hasAttribute(attr)) {
        const canGlobal = GLOBAL_SAFE_AD_ATTRS.has(attr);
        addRule(`[${attr}]`, canGlobal);
        const val = el.getAttribute(attr);
        if (val && !/^\d+$/.test(val) && !A.isObfuscatedHash(val) && val.length < 30) {
          addRule(`[${attr}="${CSS.escape(val)}"]`, false);
        }
      }
    }
    for (const c of classes) {
      if (A.isObfuscatedHash(c)) continue;
      const lower = c.toLowerCase();
      if (/(?:^|[-_])(ad|ads|adv|banner|promo|sponsor|teaser|native)(?:[-_]|$)/i.test(lower)) {
        addRule(`.${CSS.escape(c)}`, false);
        const parts = lower.split(/[-_]/);
        const prefix = parts.at(0);
        if (parts.length > 1 && prefix && /^(ad|ads|adv|banner|promo|sponsor|teaser|native|rtb|direct)$/i.test(prefix)) {
          addRule(`[class^="${CSS.escape(prefix)}-"]`, false);
        }
      }
    }

    if (tag === 'iframe') {
      const src = (el.getAttribute('src') || '').toLowerCase();
      if (src.includes('ads') || src.includes('banner') || src.includes('doubleclick')) {
        const w = el.offsetWidth;
        const h = el.offsetHeight;
        if (w > 100 && h > 50) {
          addRule(`iframe[width="${w}"][height="${h}"]`, false);
        }
      }
    }

    if (rules.length === 0) addRule(A.buildPath(el), false);
    return rules;
  }

  function saveUserAdRule(selector, el) {
    if (!A.isContextValid()) return;
    const dnaRules = extractAdDNA(el);
    chrome.storage.local.get('astraUserAdBase').then(({ astraUserAdBase = [] }) => {
      let added = false;
      for (const item of dnaRules) {
        const rule = {
          id: 'ua_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
          host: item.isGlobal ? '*' : location.hostname,
          selector: item.selector,
          tag: el.tagName,
          classes: A.safeClassName(el).slice(0, 300),
          size: el.offsetWidth + 'x' + el.offsetHeight,
          ts: Date.now(),
          isDNA: item.isGlobal
        };
        if (!astraUserAdBase.some((r) => r.selector === rule.selector && r.host === rule.host)) {
          astraUserAdBase.push(rule);
          added = true;
        }
      }
      if (added) {
        chrome.storage.local.set({ astraUserAdBase }).then(() => {
          A.applyUserAdBase();
          A.showToast({
            title: 'Astra: Ad DNA применено',
            message: `Создано правил: ${dnaRules.length}`,
            kind: 'info',
          });
        });
      }
    });
    return selector;
  }
  // ELEMENT PICKER (B46 / B60)
  const PICKER_CSS = `
    .astra-pick-hover{outline:3px solid #ff3b30 !important;outline-offset:-3px !important;
      background:rgba(255,59,48,.08) !important;cursor:crosshair !important}
    #astra-picker-hint{position:fixed;bottom:20px;left:50%;transform:translateX(-50%);
      background:#141820;color:#e9eef5;padding:12px 20px;border-radius:12px;
      font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
      font-size:13px;font-weight:600;box-shadow:0 8px 24px rgba(0,0,0,.4);
      border:1px solid rgba(255,255,255,.1);z-index:2147483647;pointer-events:none;
      max-width:92vw;text-align:center}
    #astra-picker-hint b{color:#ff8a80}
  `;
  const pickState = { active: false, lastHover: null, childHistory: [] };
  let lastContextTarget = null;
  let lastContextCoords = null;
  let lastContextTs = 0;
  document.addEventListener('contextmenu', (e) => {
    const raw = e.target;
    const el = raw && raw.nodeType === 1 ? raw : raw?.parentElement;
    if (el && el !== document.body && el !== document.documentElement) {
      lastContextTarget = el;
      lastContextCoords = { x: e.clientX, y: e.clientY };
      lastContextTs = Date.now();
    }
  }, true);

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
    h.innerHTML = '🎯 Astra: кликните по рекламе · <b>↑ / ↓</b> — шире/уже · <b>Esc</b> — отмена';
    (document.body || document.documentElement).appendChild(h);
  }

  function hidePickerHint() {
    const h = document.getElementById('astra-picker-hint');
    if (h) h.remove();
  }

  function highlightTarget(el) {
    if (!el || el === document.body || el === document.documentElement) return;
    if (el.closest('#astra-picker-hint') || el.closest('.astra-toast-stack')) return;
    if (pickState.lastHover) pickState.lastHover.classList.remove('astra-pick-hover');
    el.classList.add('astra-pick-hover');
    pickState.lastHover = el;
  }

  function swallowPointerEvent(e) {
    if (!pickState.active) return;
    e.preventDefault();
    e.stopPropagation();
  }

  A.startPickMode = (opts = {}) => {
    if (pickState.active) return;
    pickState.active = true;
    pickState.childHistory = [];
    injectPickerStyles();
    showPickerHint();
    document.documentElement.style.cursor = 'crosshair';
    document.addEventListener('mousemove', onPickMove, true);
    document.addEventListener('mousedown', swallowPointerEvent, true);
    document.addEventListener('mouseup', swallowPointerEvent, true);
    document.addEventListener('click', onPickClick, true);
    document.addEventListener('keydown', onPickKey, true);

    if (opts.fromContextMenu && (Date.now() - lastContextTs < 15000)) {
      const initialEl = (lastContextTarget && document.contains(lastContextTarget))
        ? lastContextTarget
        : (lastContextCoords ? document.elementFromPoint(lastContextCoords.x, lastContextCoords.y) : null);
      if (initialEl) highlightTarget(initialEl);
    }
  };

  A.stopPickMode = () => {
    pickState.active = false;
    pickState.childHistory = [];
    if (pickState.lastHover) pickState.lastHover.classList.remove('astra-pick-hover');
    pickState.lastHover = null;
    hidePickerHint();
    document.documentElement.style.cursor = '';
    document.removeEventListener('mousemove', onPickMove, true);
    document.removeEventListener('mousedown', swallowPointerEvent, true);
    document.removeEventListener('mouseup', swallowPointerEvent, true);
    document.removeEventListener('click', onPickClick, true);
    document.removeEventListener('keydown', onPickKey, true);
  };

  function onPickMove(e) {
    if (!pickState.active) return;
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el || el === pickState.lastHover) return;
    pickState.childHistory = [];
    highlightTarget(el);
  }

  function onPickClick(e) {
    if (!pickState.active) return;
    e.preventDefault();
    e.stopPropagation();
    const el = pickState.lastHover || e.target;
    if (!el || el.closest('#astra-picker-hint')) return;

    el.classList.remove('astra-pick-hover');
    saveUserAdRule(null, el);
    A.hideNode(el, 'user-pick');
    A.stopPickMode();
  }

  function onPickKey(e) {
    if (!pickState.active) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      A.stopPickMode();
      A.showToast({ title: 'Astra', message: 'Режим выбора отменён', kind: 'info', ttl: 3000 });
      return;
    }
    if ((e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') && pickState.lastHover) {
      const parent = pickState.lastHover.parentElement;
      if (parent && parent !== document.body && parent !== document.documentElement) {
        e.preventDefault();
        pickState.childHistory.push(pickState.lastHover);
        highlightTarget(parent);
      }
      return;
    }
    if ((e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') && pickState.childHistory.length > 0) {
      e.preventDefault();
      const prevChild = pickState.childHistory.pop();
      if (prevChild) highlightTarget(prevChild);
    }
  }
})();
