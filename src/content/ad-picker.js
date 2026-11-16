/* ad-picker.js — Astra · Древо Щит · v0.6.3
   Генератор Ad DNA, применение пользовательских правил и пипетка выбора элементов.
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

  function extractAdDNA(el) {
    const rules = new Set();
    const tag = el.tagName.toLowerCase();
    const classes = A.safeClassName(el).split(/\s+/).filter(Boolean);
    const attrs = ['data-ad', 'data-erid', 'data-ad-slot', 'data-ad-click', 'data-adv', 'data-adv-id', 'data-rtb', 'data-teaser', 'data-testid'];

    for (const attr of attrs) {
      if (el.hasAttribute(attr)) {
        rules.add(`[${attr}]`);
        const val = el.getAttribute(attr);
        if (val && !/^\d+$/.test(val) && !A.isObfuscatedHash(val) && val.length < 30) {
          rules.add(`[${attr}="${CSS.escape(val)}"]`);
        }
      }
    }
    for (const c of classes) {
      if (A.isObfuscatedHash(c)) continue;
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

    if (rules.size === 0) rules.add(A.buildPath(el));
    return Array.from(rules);
  }

  function saveUserAdRule(selector, el) {
    if (!A.isContextValid()) return;
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
          classes: A.safeClassName(el).slice(0, 300),
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
          A.applyUserAdBase();
          A.showToast({
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

  A.startPickMode = () => {
    if (pickState.active || A.state.isWhitelisted) return;
    pickState.active = true;
    injectPickerStyles();
    showPickerHint();
    document.documentElement.style.cursor = 'crosshair';
    document.addEventListener('mousemove', onPickMove, true);
    document.addEventListener('click', onPickClick, true);
    document.addEventListener('keydown', onPickKey, true);
  };

  A.stopPickMode = () => {
    pickState.active = false;
    if (pickState.lastHover) pickState.lastHover.classList.remove('astra-pick-hover');
    pickState.lastHover = null;
    hidePickerHint();
    document.documentElement.style.cursor = '';
    document.removeEventListener('mousemove', onPickMove, true);
    document.removeEventListener('click', onPickClick, true);
    document.removeEventListener('keydown', onPickKey, true);
  };

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
    A.hideNode(el, 'user-pick');
    A.stopPickMode();
  }

  function onPickKey(e) {
    if (e.key === 'Escape') {
      A.stopPickMode();
      A.showToast({ title: 'Astra', message: 'Режим выбора отменён', kind: 'info', ttl: 3000 });
    }
  }
})();
