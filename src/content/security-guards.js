/* security-guards.js — Astra · Древо Щит · v0.6.3
   Экран антифишинга (B28), контентная эвристика форм, кликджекинг (B31), WASM/майнеры и HTTP.
*/
(() => {
  'use strict';
  const A = (window.AstraShield = window.AstraShield || {});
  if (A.securityGuardsLoaded) return;
  A.securityGuardsLoaded = true;

  // ============================================================
  // 🛡️ ПОЛНОЭКРАННЫЙ ЗАЩИТНЫЙ ЭКРАН АНТИФИШИНГА (B28)
  // ============================================================
  A.renderPhishingOverlay = (host, reasons = []) => {
    const st = A.state;
    if (window.top !== window.self) return;
    if (st.phishingOverlayShown || st.isWhitelisted) return;
    if (!st.runtimeCfg.enabled || !st.runtimeCfg.modules.phishing) return;
    st.phishingOverlayShown = true;

    const mount = () => {
      if (document.getElementById('astra-phishing-shield')) return;
      const overlay = document.createElement('div');
      overlay.id = 'astra-phishing-shield';
      overlay.style.cssText = [
        'position:fixed', 'inset:0', 'z-index:2147483647',
        'background:radial-gradient(circle at top, #1f1216 0%, #0d1017 75%)',
        'color:#f1f5f9', 'display:flex', 'align-items:center', 'justify-content:center',
        'padding:24px', 'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif'
      ].join(';');

      const card = document.createElement('div');
      card.style.cssText = [
        'max-width:520px', 'width:100%', 'background:#161b26',
        'border:1px solid rgba(239,68,68,.55)', 'border-radius:16px',
        'padding:28px 26px', 'box-shadow:0 24px 60px rgba(0,0,0,.65)'
      ].join(';');

      const title = document.createElement('div');
      title.style.cssText = 'font-size:20px;font-weight:700;color:#fca5a5;margin-bottom:8px;display:flex;align-items:center;gap:10px';
      title.textContent = '⛔ Astra — Обнаружена угроза фишинга';

      const sub = document.createElement('div');
      sub.style.cssText = 'font-size:14px;color:#cbd5e1;line-height:1.5;margin-bottom:14px';
      sub.textContent = `Переход на сайт «${host || st.hostname}» заблокирован модулем антифишинга.`;

      const ul = document.createElement('ul');
      ul.style.cssText = 'margin:0 0 18px 18px;padding:0;font-size:13px;color:#fecaca;line-height:1.55';
      const list = reasons.length ? reasons : ['Обнаружены признаки мошеннического ресурса'];
      for (const r of list) {
        const li = document.createElement('li');
        li.textContent = r;
        ul.appendChild(li);
      }

      const actions = document.createElement('div');
      actions.style.cssText = 'display:flex;flex-wrap:wrap;gap:10px;margin-top:6px';

      const leaveBtn = document.createElement('button');
      leaveBtn.type = 'button';
      leaveBtn.textContent = '🛡️ Покинуть опасный сайт';
      leaveBtn.style.cssText = 'flex:1;min-width:190px;padding:11px 16px;border:none;border-radius:10px;background:#ef4444;color:#fff;font-weight:600;font-size:13px;cursor:pointer';
      leaveBtn.addEventListener('click', () => {
        if (history.length > 1) history.back();
        else location.href = 'about:blank';
      });
      const trustBtn = document.createElement('button');
      trustBtn.type = 'button';
      trustBtn.textContent = 'Добавить в исключения и открыть';
      trustBtn.style.cssText = 'padding:11px 14px;border:1px solid rgba(255,255,255,.16);border-radius:10px;background:transparent;color:#94a3b8;font-size:12px;cursor:pointer';
      trustBtn.addEventListener('click', async () => {
        if (A.isContextValid()) {
          await chrome.runtime.sendMessage({ type: 'TOGGLE_WHITELIST', host: host || st.hostname }).catch(() => {});
        }
        overlay.remove();
        st.phishingOverlayShown = false;
      });

      actions.append(leaveBtn, trustBtn);
      card.append(title, sub, ul, actions);
      overlay.appendChild(card);
      (document.body || document.documentElement).appendChild(overlay);
    };

    if (document.body || document.documentElement) mount();
    else document.addEventListener('DOMContentLoaded', mount, { once: true });
  };

  A.hidePhishingOverlay = () => {
    document.getElementById('astra-phishing-shield')?.remove();
    A.state.phishingOverlayShown = false;
  };

  // Контентная эвристика фишинга (фейковые формы входа/банковских карт на не-белых доменах)
  A.scanPagePhishingHeuristics = () => {
    const st = A.state;
    if (window.top !== window.self) return;
    if (st.isWhitelisted || st.phishingOverlayShown) return;
    if (!st.runtimeCfg.enabled || !st.runtimeCfg.modules.phishing) return;

    const passInputs = document.querySelectorAll('input[type="password"]');
    const bodyText = A.norm((document.body?.innerText || '').slice(0, 3000));
    const hasBankLure = /(сбербанк|госуслуги|тинькофф|т-банк|втб|альфа-банк|росфинмониторинг|безопасный счет|подтвердите вход|введите код из смс)/i.test(bodyText);

    if (passInputs.length > 0 && hasBankLure) {
      const reason = 'Обнаружена форма ввода пароля с упоминанием банка или госсервиса на стороннем домене';
      A.renderPhishingOverlay(st.hostname, [reason]);
      if (A.isContextValid()) {
        try { chrome.runtime.sendMessage({ type: 'REPORT_THREAT', kind: 'phishing-dom', reason }).catch(() => {}); } catch {}
      }
    }
  };

  // WASM & MINER HOOKS
  let wasmCount = 0, wasmFirstTs = 0, wasmWarned = false;
  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data || e.data.__astra !== true) return;
    const cfg = A.state.runtimeCfg;
    if (!cfg.enabled || !cfg.modules.miners) return;
    const hook = e.data.hook;
    if (hook === 'wasm-instantiate') {
      const now = Date.now();
      if (!wasmFirstTs || now - wasmFirstTs > 10000) {
        wasmCount = 1; wasmFirstTs = now; wasmWarned = false;
      } else wasmCount++;
      if (wasmCount >= 5 && !wasmWarned) {
        wasmWarned = true;
        A.showToast({ title: 'Astra: массовый WASM', message: `Страница запустила ${wasmCount} WASM-модулей за 10 сек.`, kind: 'warn' });
      }
    }
    if (hook === 'worker-spawn') {
      const msgText = e.data.blocked
        ? 'Заблокирован скрипт криптомайнера в фоне.'
        : 'Обнаружен Worker с признаками майнера.';
      A.showToast({ title: 'Astra: защита от майнеров', message: msgText, kind: 'danger' });
      if (A.isContextValid()) {
        try {
          chrome.runtime.sendMessage({
            type: 'REPORT_THREAT',
            kind: 'miner',
            reason: 'Попытка запуска фонового криптомайнера',
          }).catch(() => {});
        } catch {}
      }
    }
  });
  // CLICKJACKING (B31)
  function isTransparentOverlay(st) {
    if (!st || st.display === 'none' || st.visibility === 'hidden') return false;
    if (st.pointerEvents === 'none') return false;
    const op = parseFloat(st.opacity);
    if (!Number.isNaN(op) && op < 0.15) return true;
    if (st.filter && /opacity\(\s*0(?:\.\d+)?\s*\)/i.test(st.filter)) return true;
    return false;
  }

  let clickjackObserverStarted = false;
  A.guardClickjacking = () => {
    if (window.top !== window.self || clickjackObserverStarted) return;
    clickjackObserverStarted = true;

    const scan = () => {
      const stState = A.state;
      if (!stState.runtimeCfg.enabled || !stState.runtimeCfg.modules.clickjacking || stState.isWhitelisted) return;
      const candidates = document.querySelectorAll('iframe, div, a, button');
      for (const el of candidates) {
        if (el.dataset.astraHidden || A.PROTECTED_TAGS.has(el.tagName)) continue;
        if (el.closest?.('.astra-toast-stack') || el.closest?.('#astra-phishing-shield')) continue;
        const st = getComputedStyle(el);
        const pos = st.position;
        if (pos !== 'fixed' && pos !== 'absolute') continue;
        const z = parseInt(st.zIndex, 10) || 0;
        const isBigIframe = el.tagName === 'IFRAME' && el.offsetWidth > 180 && el.offsetHeight > 80;
        const isCoverTrap = el.offsetWidth > 260 && el.offsetHeight > 140 && z >= 10;
        if ((isBigIframe || isCoverTrap) && isTransparentOverlay(st)) {
          el.dataset.astraHidden = '1';
          el.style.setProperty('display', 'none', 'important');
          A.showToast({ title: 'Astra: кликджекинг', message: 'Заблокирован невидимый оверлей-ловушка.', kind: 'danger' });
          if (A.isContextValid()) {
            try {
              chrome.runtime.sendMessage({
                type: 'REPORT_THREAT',
                kind: 'clickjacking',
                reason: 'Обнаружен и скрыт прозрачный кликджекинг-оверлей',
              }).catch(() => {});
            } catch {}
          }
        }
      }
    };
    scan();
    new MutationObserver(A.debounce(scan, 450)).observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['style', 'class'],
    });
  };

  // HTTP & MIXED CONTENT
  A.checkHttpDowngrade = () => {
    if (window.top !== window.self) return;
    const cfg = A.state.runtimeCfg;
    if (!cfg.enabled || !cfg.modules.phishing) return;
    if (location.protocol === 'https:') {
      const mixed = document.querySelectorAll('img[src^="http://"], script[src^="http://"], link[href^="http://"], iframe[src^="http://"]');
      if (mixed.length) {
        A.showToast({
          title: 'Astra: смешанный контент',
          message: `На HTTPS-странице найдено ${mixed.length} HTTP-ресурсов.`,
          kind: 'warn',
        });
      }
    } else if (location.protocol === 'http:') {
      A.showToast({
        title: 'Astra: небезопасное соединение',
        message: 'Сайт открыт по HTTP. Данные могут быть перехвачены.',
        kind: 'warn',
        ttl: 9000,
      });
    }
  };
})();
