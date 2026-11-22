/* popup.js — Astra · Древо Щит · v0.7.1
   Обновление v0.7.1:
   - B57: Per-Site Shields Overrides — индивидуальные переключатели модулей для текущего сайта с индикацией и сбросом.
*/
import {
  loadConfig, saveConfig, resolveEffectiveModules,
  WHITELIST_DOMAINS, isHostInList
} from '../shared/config.js';

const $ = (sel) => document.querySelector(sel);
let currentHost = '';

async function safeSend(msg) {
  try { return await chrome.runtime.sendMessage(msg); }
  catch (e) { console.warn('[Astra popup] SW unavailable:', e); return null; }
}

function formatMB(bytes) {
  if (!bytes) return '0 КБ';
  if (bytes < 1024) return bytes + ' Б';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' КБ';
  if (bytes < 1073741824) return (bytes / 1048576).toFixed(2) + ' МБ';
  return (bytes / 1073741824).toFixed(2) + ' ГБ';
}

function escapeHtml(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function extractCleanSelector(raw) {
  const s = String(raw || '').trim();
  return s.replace(/^\[[^\]]+\]\s*/, '').trim();
}

async function copyTextSafe(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

async function toggleUserRuleFromPopup(tabId, host, selector, sizeLabel) {
  const { astraUserAdBase = [] } = await chrome.storage.local.get('astraUserAdBase');
  const existingIdx = astraUserAdBase.findIndex(
    (r) => r.selector === selector && (r.host === host || r.host === '*')
  );

  let savedNow = false;
  if (existingIdx !== -1) {
    astraUserAdBase.splice(existingIdx, 1);
  } else {
    astraUserAdBase.push({
      id: 'ua_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      host: host || '*',
      selector,
      tag: 'POPUP',
      classes: '',
      size: sizeLabel === 'скрыт CSS' ? '' : sizeLabel,
      ts: Date.now(),
      isDNA: !host
    });
    savedNow = true;
  }

  await chrome.storage.local.set({ astraUserAdBase });
  if (tabId) {
    chrome.tabs.sendMessage(tabId, { type: 'USER_BASE_UPDATED' }).catch(() => {});
  }
  return savedNow;
}
async function renderAnalysis() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs.at(0);
  if (!tab?.id) return;

  const data = await safeSend({ type: 'GET_TAB_ANALYSIS', tabId: tab.id });
  if (!data) return;

  const { astraUserAdBase = [], userWhitelist = [] } = await chrome.storage.local.get([
    'astraUserAdBase', 'userWhitelist'
  ]);
  const isSiteWhitelisted = currentHost && isHostInList(currentHost, userWhitelist);

  const reqCountEl = $('#reqCount');
  const domCountEl = $('#domCount');
  if (reqCountEl) reqCountEl.textContent = data.requests.length;
  if (domCountEl) domCountEl.textContent = data.domBlocks.length;

  const reqList = $('#reqList');
  if (reqList) {
    reqList.innerHTML = '';
    if (data.requests.length === 0) {
      reqList.innerHTML = '<li class="empty">Рекламные запросы не найдены</li>';
    } else {
      data.requests.slice(0, 30).forEach(r => {
        const li = document.createElement('li');
        li.innerHTML = `<div class="url" title="${escapeHtml(r.url)}">${escapeHtml(r.url.slice(0, 60))}${r.url.length > 60 ? '...' : ''}</div>
                        <div class="filter">${escapeHtml(r.filter)}</div>`;
        reqList.appendChild(li);
      });
    }
  }

  const domList = $('#domList');
  if (domList) {
    domList.innerHTML = '';
    if (data.domBlocks.length === 0) {
      domList.innerHTML = '<li class="empty">Рекламные DOM-блоки не найдены</li>';
    } else {
      data.domBlocks.slice(0, 30).forEach(b => {
        const li = document.createElement('li');
        const cleanSelector = extractCleanSelector(b.selector);
        const sizeLabel = (b.rect.width > 0 || b.rect.height > 0)
          ? `${b.rect.width}×${b.rect.height}`
          : 'скрыт CSS';

        const isSaved = astraUserAdBase.some(
          (r) => r.selector === cleanSelector && (r.host === currentHost || r.host === '*')
        );

        const badges = [];
        if (b.links?.length) badges.push(`🔗 ${b.links.length}`);
        if (b.images?.length) badges.push(`🖼️ ${b.images.length}`);
        if (b.iframes?.length) badges.push(`📦 iframe`);

        const badgesHtml = badges.length
          ? `<span class="block-badges">${badges.join(' · ')}</span>`
          : '';

        const rawText = (b.text || '').trim();
        const previewHtml = rawText
          ? `<div class="block-preview" title="${escapeHtml(rawText)}">«${escapeHtml(rawText.slice(0, 95))}${rawText.length > 95 ? '…' : ''}»</div>`
          : '';

        const wlBtnHtml = (currentHost && !isSiteWhitelisted)
          ? `<button type="button" class="block-act-btn" data-act="wl" title="Добавить ${escapeHtml(currentHost)} в исключения">🤍 Исключить сайт</button>`
          : '';
        li.innerHTML = `
          <div class="url" title="${escapeHtml(b.selector)}">${escapeHtml(b.selector)}</div>
          ${previewHtml}
          <div class="block-meta">Размер: ${sizeLabel}${badgesHtml}</div>
          <div class="block-actions">
            <button type="button" class="block-act-btn" data-act="copy" title="Скопировать CSS-селектор">📋 Копировать</button>
            <button type="button" class="block-act-btn ${isSaved ? 'saved' : ''}" data-act="rule" title="Сохранить или убрать из ручных правил">${isSaved ? '✓ В правилах' : '➕ В правила'}</button>
            ${wlBtnHtml}
          </div>
        `;
        li.querySelector('[data-act="copy"]')?.addEventListener('click', async (e) => {
          const btn = e.currentTarget;
          const ok = await copyTextSafe(cleanSelector);
          if (ok) {
            btn.textContent = '✓ Скопировано';
            setTimeout(() => { btn.textContent = '📋 Копировать'; }, 1400);
          }
        });

        li.querySelector('[data-act="rule"]')?.addEventListener('click', async (e) => {
          const btn = e.currentTarget;
          btn.disabled = true;
          const nowSaved = await toggleUserRuleFromPopup(tab.id, currentHost, cleanSelector, sizeLabel);
          btn.disabled = false;
          btn.classList.toggle('saved', nowSaved);
          btn.textContent = nowSaved ? '✓ В правилах' : '➕ В правила';
        });

        li.querySelector('[data-act="wl"]')?.addEventListener('click', async (e) => {
          const btn = e.currentTarget;
          btn.disabled = true;
          btn.textContent = 'Применение...';
          await safeSend({ type: 'TOGGLE_WHITELIST', host: currentHost });
          window.location.reload();
        });

        domList.appendChild(li);
      });
    }
  }
}

function initAnalysisUI() {
  const tabs = document.querySelectorAll('.tab-btn');
  const reqList = $('#reqList');
  const domList = $('#domList');

  tabs.forEach(btn => {
    btn.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      btn.classList.add('active');

      if (btn.dataset.tab === 'requests') {
        reqList.style.display = '';
        domList.style.display = 'none';
      } else {
        reqList.style.display = 'none';
        domList.style.display = '';
      }
    });
  });

  $('#refreshAnalysisBtn')?.addEventListener('click', renderAnalysis);
  renderAnalysis();
}

async function loadPageMetrics(warnMB) {
  const container = $('#loadMonitor');
  if (!container) return;

  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs.at(0);
  if (!tab?.id) return;

  let attempts = 0;
  const tryFetch = async () => {
    attempts++;
    const resp = await safeSend({ type: 'GET_PAGE_METRICS', tabId: tab.id });
    if (resp?.metrics) {
      renderMetrics(resp.metrics, warnMB);
      return;
    }
    if (attempts < 3) setTimeout(tryFetch, 1500);
  };
  tryFetch();
}
function renderMetrics(m, warnMB) {
  const container = $('#loadMonitor');
  if (!container || !m) return;
  container.style.display = '';

  const totalMB = m.totalBytes / 1048576;
  $('#loadTotal').textContent = formatMB(m.totalBytes);

  const pct = Math.min(100, (totalMB / (warnMB * 2)) * 100);
  const fill = $('#loadFill');
  fill.style.width = pct + '%';
  fill.classList.remove('warn', 'danger');
  if (totalMB >= warnMB * 1.5) fill.classList.add('danger');
  else if (totalMB >= warnMB)   fill.classList.add('warn');

  const bd = $('#loadBreakdown');
  const t = m.byType || {};
  const parts = [];
  const names = { script: 'Скрипты', image: 'Картинки', stylesheet: 'CSS', xmlhttprequest: 'XHR', fetch: 'Fetch', font: 'Шрифты', media: 'Медиа', other: 'Прочее' };
  const sortedTypes = Object.entries(t).filter(([, v]) => v && v.bytes > 0).sort((a, b) => b[1].bytes - a[1].bytes);
  for (const [k, v] of sortedTypes.slice(0, 4)) parts.push(`${names[k] || k}: ${formatMB(v.bytes)}`);

  let html = parts.join(' · ');
  if (m.adBytes > 0) {
    const adMB = m.adBytes / 1048576;
    if (adMB >= 0.01) html += `<br>📛 Реклама/трекеры: <b style="color:var(--danger)">${formatMB(m.adBytes)}</b>`;
  }
  bd.innerHTML = html;

  const topEl = $('#loadTop');
  topEl.innerHTML = '';
  const top = m.top || [];
  if (top.length === 0) {
    topEl.innerHTML = '<li style="color:var(--text-soft)">Нет данных о ресурсах</li>';
  } else {
    for (const r of top) {
      const li = document.createElement('li');
      const url = document.createElement('span');
      url.className = 'url' + (r.tracker ? ' tracker' : '');
      url.textContent = r.domain || r.url;
      url.title = r.url;
      const size = document.createElement('span');
      size.className = 'size';
      size.textContent = formatMB(r.size);
      li.append(url, size);
      topEl.appendChild(li);
    }
  }
}

function applyStatusBanner(box, icon, title, hostEl, risk, host, reasons = []) {
  box.classList.remove('ok', 'warn', 'danger');
  box.classList.add(risk);
  icon.textContent = risk === 'danger' ? '⛔' : risk === 'warn' ? '⚠️' : '🛡️';
  title.textContent = risk === 'danger' ? 'Опасный сайт' : risk === 'warn' ? 'Подозрительный сайт' : 'Сайт безопасен';
  const firstReason = reasons.at(0);
  hostEl.textContent = firstReason && risk !== 'ok'
    ? `${host || '—'} · ${firstReason}`
    : (host || '—');
}

function updateBlockButtonUI(blockBtn, blocked) {
  blockBtn.textContent = blocked ? '✅ Разблокировать сайт' : '🚫 Заблокировать сайт';
  blockBtn.style.background = blocked ? 'var(--ok)' : 'var(--danger)';
  blockBtn.style.color = '#fff';
  blockBtn.style.display = '';
}

function syncModuleTogglesUI(cfg, host, isSiteWhitelisted) {
  const effective = resolveEffectiveModules(cfg, host, isSiteWhitelisted);
  const hostOverrides = (host && cfg.siteOverrides?.[host]) || {};
  const hasAnyOverride = host && Object.keys(hostOverrides).length > 0;

  const scopeEl = $('#siteScopeLabel');
  const resetBtn = $('#resetSiteOverridesBtn');
  if (scopeEl) {
    if (!host) {
      scopeEl.textContent = 'Глобальные настройки';
    } else if (hasAnyOverride) {
      scopeEl.textContent = `Настройки для ${host}`;
    } else if (isSiteWhitelisted) {
      scopeEl.textContent = `${host} (белый список)`;
    } else {
      scopeEl.textContent = `Щит для ${host}`;
    }
  }
  if (resetBtn) {
    resetBtn.style.display = hasAnyOverride ? '' : 'none';
  }

  document.querySelectorAll('input[data-mod]').forEach((el) => {
    const mod = el.dataset.mod;
    el.checked = !!effective[mod];
    el.disabled = !cfg.enabled;
    const row = el.closest('.switch-row');
    if (row) {
      row.classList.toggle('overridden', !!(host && typeof hostOverrides[mod] === 'boolean'));
    }
  });
}

async function init() {
  let cfg = await loadConfig();
  document.documentElement.setAttribute('data-theme', cfg.theme);

  const resp = await safeSend({ type: 'GET_TAB_STATUS' });
  const box = $('#statusBox');
  const icon = $('#statusIcon');
  const title = $('#statusTitle');
  const hostEl = $('#statusHost');
  const blockBtn = $('#toggleBlockBtn');
  const whitelistBtn = $('#toggleWhitelistBtn');
  const pickBtn = $('#pickAdBtn');
  let isSiteWhitelisted = false;

  if (!resp || !resp.status) {
    box.classList.add('warn');
    icon.textContent = '⚠️';
    title.textContent = 'Сервис недоступен';
    hostEl.textContent = 'Перезагрузите расширение';
    blockBtn.style.display = 'none';
    whitelistBtn.style.display = 'none';
  } else {
    const { risk, host, reasons = [] } = resp.status;
    currentHost = host;
    applyStatusBanner(box, icon, title, hostEl, risk, host, reasons);

    if (host) {
      const userBlocklist = resp.adblock?.userBlocklist || [];
      const userWhitelist = resp.adblock?.userWhitelist || [];
      let isBlocked = userBlocklist.includes(host);
      const isUserWhitelisted = isHostInList(host, userWhitelist);
      isSiteWhitelisted = isUserWhitelisted || isHostInList(host, WHITELIST_DOMAINS);

      updateBlockButtonUI(blockBtn, isBlocked);

      blockBtn.addEventListener('click', async () => {
        blockBtn.disabled = true;
        const result = await safeSend({ type: 'TOGGLE_BLOCK_SITE', host });
        isBlocked = result?.blocked !== undefined ? !!result.blocked : !isBlocked;
        updateBlockButtonUI(blockBtn, isBlocked);
        if (isBlocked) {
          applyStatusBanner(box, icon, title, hostEl, 'danger', host, ['Заблокировано пользователем']);
        } else {
          const fresh = await safeSend({ type: 'GET_TAB_STATUS' });
          const nextStatus = fresh?.status || { risk: 'ok', host, reasons: [] };
          applyStatusBanner(box, icon, title, hostEl, nextStatus.risk, host, nextStatus.reasons || []);
        }
        blockBtn.disabled = false;
      });

      whitelistBtn.textContent = isUserWhitelisted ? '🛡️ Включить защиту обратно' : '🤍 Отключить защиту на сайте';
      whitelistBtn.style.display = '';

      whitelistBtn.addEventListener('click', async () => {
        whitelistBtn.disabled = true;
        whitelistBtn.textContent = 'Применение...';
        await safeSend({ type: 'TOGGLE_WHITELIST', host });
        window.location.reload();
      });
    } else {
      blockBtn.style.display = 'none';
      whitelistBtn.style.display = 'none';
    }
  }

  syncModuleTogglesUI(cfg, currentHost, isSiteWhitelisted);

  $('#resetSiteOverridesBtn')?.addEventListener('click', async () => {
    if (!currentHost) return;
    cfg = await saveConfig({ siteOverrides: { [currentHost]: null } });
    syncModuleTogglesUI(cfg, currentHost, isSiteWhitelisted);
  });

  document.querySelectorAll('input[data-mod]').forEach((el) => {
    el.addEventListener('change', async () => {
      const mod = el.dataset.mod;
      if (!currentHost) {
        cfg = await saveConfig({ modules: { [mod]: el.checked } });
        syncModuleTogglesUI(cfg, currentHost, isSiteWhitelisted);
        return;
      }
      const defaultForSite = isSiteWhitelisted ? false : !!cfg.modules[mod];
      const nextHostMap = { ...(cfg.siteOverrides?.[currentHost] || {}) };
      if (el.checked === defaultForSite) {
        delete nextHostMap[mod];
      } else {
        nextHostMap[mod] = el.checked;
      }
      cfg = await saveConfig({
        siteOverrides: { [currentHost]: Object.keys(nextHostMap).length ? nextHostMap : null }
      });
      syncModuleTogglesUI(cfg, currentHost, isSiteWhitelisted);
    });
  });

  const tStats = resp?.adblock?.trafficStats || {};
  const savedBytes = tStats.savedBytes || 0;
  const totalAdElements = (tStats.blockedRequests || 0) + (tStats.blockedDom || 0);
  const blockedTotal = Math.max(resp?.stats?.blocked || 0, totalAdElements);

  if (resp && resp.stats) {
    $('#statBlocked').textContent = blockedTotal;
    $('#statThreats').textContent = resp.stats.threatsToday || 0;
  }

  const trafficEl = $('#statTrafficSaved');
  const adTotalEl = $('#statAdBlockedTotal');
  if (trafficEl) trafficEl.textContent = formatMB(savedBytes);
  if (adTotalEl) adTotalEl.textContent = totalAdElements;

  $('#openOptions').addEventListener('click', () => chrome.runtime.openOptionsPage());

  if (pickBtn) {
    pickBtn.addEventListener('click', async () => {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const tab = tabs.at(0);
      if (!tab?.id) return;
      try {
        await chrome.tabs.sendMessage(tab.id, { type: 'START_PICK' });
      } catch (e) {
        alert('Не удалось включить режим выбора. Обновите страницу и попробуйте снова.');
        return;
      }
      window.close();
    });
  }

  if (cfg.loadMonitor?.enabled !== false) {
    loadPageMetrics(cfg.loadMonitor?.warnMB || 5);
  }

  initAnalysisUI();

  const donateBtn = $('#openDonateBtn');
  const qrModal = $('#qrModal');
  const closeModalBtn = $('#closeModalBtn');
  if (donateBtn && qrModal) {
    donateBtn.addEventListener('click', () => qrModal.classList.add('show'));
    closeModalBtn?.addEventListener('click', () => qrModal.classList.remove('show'));
    qrModal.addEventListener('click', (e) => {
      if (e.target === qrModal) qrModal.classList.remove('show');
    });
  }

  const qrImg = $('#sberQrImg');
  const qrFallback = $('#sberQrFallback');
  if (qrImg && qrFallback) {
    qrImg.addEventListener('error', () => {
      qrImg.style.display = 'none';
      qrFallback.style.display = 'flex';
    });
    qrImg.src = chrome.runtime.getURL('icons/sber-qr.jpg');
  }
}

init();
