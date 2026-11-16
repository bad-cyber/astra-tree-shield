/* options.js — Astra · Древо Щит · v0.6.0
   Добавлено: статистика экономии трафика и экспорт/импорт пользовательских правил.
*/
import { loadConfig, saveConfig, DEFAULTS } from "../shared/config.js";

const $ = (s) => document.querySelector(s);

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatRuleDate(ts) {
  if (!ts || typeof ts !== "number") return "";
  try {
    return new Date(ts).toLocaleString("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
  } catch {
    return "";
  }
}

function formatBytes(bytes) {
  const b = Number(bytes) || 0;
  if (b < 1024) return `${b} Б`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} КБ`;
  if (b < 1024 * 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(2)} МБ`;
  return `${(b / (1024 * 1024 * 1024)).toFixed(2)} ГБ`;
}

function normalizeHostInput(raw) {
  let val = String(raw || "").trim().toLowerCase();
  if (!val || val === "*") return val;
  val = val.replace(/^[a-z]+:\/\//, "").split("/").split(":").replace(/^www\./, "");
  return /^[a-z0-9а-яё.-]+\.[a-zа-яё]{2,}$/i.test(val) ? val : "";
}

function isValidCssSelector(sel) {
  const clean = String(sel || "").trim();
  if (!clean) return false;
  try {
    document.createDocumentFragment().querySelector(clean);
    return true;
  } catch {
    return false;
  }
}

async function init() {
  const cfg = await loadConfig();
  document.documentElement.setAttribute("data-theme", cfg.theme);

  const version = "v" + chrome.runtime.getManifest().version;
  const versionDisplay = $("#versionDisplay");
  const versionDisplayAbout = $("#versionDisplayAbout");
  if (versionDisplay) versionDisplay.textContent = version;
  if (versionDisplayAbout) versionDisplayAbout.textContent = version;
  // --- 1. НАВИГАЦИЯ ---
  const navLinks = document.querySelectorAll(".side nav a");
  const sections = document.querySelectorAll(".content section");
  navLinks.forEach(link => {
    link.addEventListener("click", (e) => {
      e.preventDefault();
      navLinks.forEach(l => l.classList.remove("active"));
      sections.forEach(s => s.classList.remove("active-section"));
      link.classList.add("active");
      const targetId = link.getAttribute("href").substring(1);
      const target = document.getElementById(targetId);
      if (target) target.classList.add("active-section");
    });
  });
  if (sections.length > 0) sections.item(0).classList.add("active-section");

  // --- 2. НАСТРОЙКИ ---
  $("#enabled").checked = cfg.enabled;
  $("#theme").value = cfg.theme;

  document.querySelectorAll("input[data-mod]").forEach(el => {
    el.checked = !!cfg.modules[el.dataset.mod];
    el.addEventListener("change", async () => {
      await saveConfig({ modules: { [el.dataset.mod]: el.checked } });
    });
  });

  const lmEnabled = $("#loadMonitorEnabled");
  const lmWarn = $("#loadMonitorWarnMB");
  if (lmEnabled) {
    lmEnabled.checked = cfg.loadMonitor?.enabled !== false;
    lmEnabled.addEventListener("change", async (e) => {
      const cur = await loadConfig();
      await saveConfig({ loadMonitor: { ...cur.loadMonitor, enabled: e.target.checked } });
    });
  }
  if (lmWarn) {
    lmWarn.value = cfg.loadMonitor?.warnMB || 5;
    lmWarn.addEventListener("change", async (e) => {
      const v = Math.max(1, Math.min(50, parseInt(e.target.value, 10) || 5));
      e.target.value = v;
      const cur = await loadConfig();
      await saveConfig({ loadMonitor: { ...cur.loadMonitor, warnMB: v } });
    });
  }

  $("#enabled").addEventListener("change", e => saveConfig({ enabled: e.target.checked }));
  $("#theme").addEventListener("change", async e => {
    await saveConfig({ theme: e.target.value });
    document.documentElement.setAttribute("data-theme", e.target.value);
  });

  // --- 3. СТАТИСТИКА БАЗ И ЭКОНОМИИ ТРАФИКА ---
  async function loadDbStats() {
    const storage = await chrome.storage.local.get([
      "lastAdblockUpdate", "adblockCount", "adblockStatus", "adblockError", "threatFeed", "trafficStats"
    ]);
    
    $("#adblockCount").textContent = storage.adblockCount || 0;
    if ($("#threatFeedCount")) {
      $("#threatFeedCount").textContent = (storage.threatFeed || []).length;
    }

    const dateEl = $("#adblockDate");
    let dateStr = "Никогда";
    if (storage.lastAdblockUpdate) {
      dateStr = new Date(storage.lastAdblockUpdate).toLocaleString("ru-RU");
    }

    if (storage.adblockStatus === "error" && storage.adblockError) {
      if (storage.adblockCount > 0) {
        dateEl.innerHTML = `${dateStr}<br><span style="color:var(--danger);font-size:11px;" title="${escapeHtml(storage.adblockError)}">Сбой обновления</span>`;
      } else {
        dateEl.innerHTML = `<span style="color:var(--danger)">Ошибка: ${escapeHtml(storage.adblockError)}</span>`;
      }
    } else {
      dateEl.textContent = dateStr;
    }

    const ts = storage.trafficStats || { savedBytes: 0, blockedRequests: 0, blockedDom: 0, since: Date.now() };
    if ($("#trafficSavedValue")) $("#trafficSavedValue").textContent = formatBytes(ts.savedBytes);
    if ($("#trafficBlockedReqs")) $("#trafficBlockedReqs").textContent = (ts.blockedRequests || 0).toLocaleString("ru-RU");
    if ($("#trafficBlockedDom")) $("#trafficBlockedDom").textContent = (ts.blockedDom || 0).toLocaleString("ru-RU");
    if ($("#trafficSinceText") && ts.since) {
      $("#trafficSinceText").textContent = `Учёт ведётся с ${formatRuleDate(ts.since)}`;
    }
  }
  loadDbStats();
  $("#updateDbBtn").addEventListener("click", async (e) => {
    const btn = e.target;
    btn.textContent = "Загрузка...";
    btn.disabled = true;
    try {
      await chrome.runtime.sendMessage({ type: "FORCE_UPDATE_DB" });
      await loadDbStats();
    } catch (err) {
      console.warn(err);
    } finally {
      btn.textContent = "Обновить базы сейчас";
      btn.disabled = false;
    }
  });

  $("#resetTrafficBtn")?.addEventListener("click", async () => {
    if (!confirm("Сбросить накопительную статистику экономии трафика?")) return;
    await chrome.runtime.sendMessage({ type: "RESET_TRAFFIC_STATS" }).catch(() => {});
    await loadDbStats();
  });

  // --- 4. ПОЛЬЗОВАТЕЛЬСКИЕ ПРАВИЛА ---
  let editingAdIndex = -1;

  async function notifyTabsBaseUpdated() {
    try {
      const tabs = await chrome.tabs.query({});
      for (const t of tabs) {
        if (t.id) chrome.tabs.sendMessage(t.id, { type: "USER_BASE_UPDATED" }).catch(() => {});
      }
    } catch {}
  }

  function showRuleFeedback(msg, isError = false) {
    const el = $("#addRuleFeedback");
    if (!el) return;
    el.style.color = isError ? "var(--danger, #e53935)" : "var(--success, #43a047)";
    el.textContent = msg;
    if (msg) {
      setTimeout(() => {
        if (el.textContent === msg) el.textContent = "";
      }, 3500);
    }
  }

  const newRuleType = $("#newRuleType");
  const newRuleHost = $("#newRuleHost");
  const newRuleSelector = $("#newRuleSelector");
  const addRuleBtn = $("#addRuleBtn");

  function syncRuleFormFields() {
    if (!newRuleType || !newRuleSelector || !newRuleHost) return;
    const isAd = newRuleType.value === "ad";
    newRuleSelector.style.display = isAd ? "" : "none";
    newRuleHost.placeholder = isAd
      ? "Домен (напр. example.com или * для всех)"
      : "Домен (напр. example.com)";
  }
  newRuleType?.addEventListener("change", syncRuleFormFields);
  syncRuleFormFields();

  addRuleBtn?.addEventListener("click", async () => {
    const type = newRuleType?.value || "ad";
    const rawHost = newRuleHost?.value || "";
    const rawSel = (newRuleSelector?.value || "").trim();

    if (type === "ad") {
      if (!isValidCssSelector(rawSel)) {
        showRuleFeedback("Введите корректный CSS-селектор (например: .ad-banner или #promo).", true);
        return;
      }
      const host = rawHost.trim() === "" ? "*" : normalizeHostInput(rawHost);
      if (!host) {
        showRuleFeedback("Некорректный домен. Укажите домен (example.com) или * для всех сайтов.", true);
        return;
      }
      const { astraUserAdBase = [] } = await chrome.storage.local.get("astraUserAdBase");
      if (astraUserAdBase.some(r => r.host === host && r.selector === rawSel)) {
        showRuleFeedback("Такое правило уже существует в списке.", true);
        return;
      }
      astraUserAdBase.push({
        id: "ua_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6),
        host,
        selector: rawSel,
        tag: "MANUAL",
        classes: "",
        size: "",
        ts: Date.now(),
        isDNA: host === "*"
      });
      await chrome.storage.local.set({ astraUserAdBase });
      await notifyTabsBaseUpdated();
      newRuleSelector.value = "";
      newRuleHost.value = "";
      showRuleFeedback("Правило блокировки рекламы добавлено.");
      renderUserRules();
      return;
    }
    const host = normalizeHostInput(rawHost);
    if (!host || host === "*") {
      showRuleFeedback("Введите корректный домен (например: example.com).", true);
      return;
    }

    if (type === "whitelist") {
      const { userWhitelist = [] } = await chrome.storage.local.get("userWhitelist");
      if (userWhitelist.includes(host)) {
        showRuleFeedback("Этот сайт уже в белом списке.", true);
        return;
      }
      await chrome.runtime.sendMessage({ type: "TOGGLE_WHITELIST", host });
      newRuleHost.value = "";
      showRuleFeedback(`Сайт ${host} добавлен в белый список.`);
      renderUserRules();
    } else if (type === "blocklist") {
      const { userBlocklist = [] } = await chrome.storage.local.get("userBlocklist");
      if (userBlocklist.includes(host)) {
        showRuleFeedback("Этот сайт уже в чёрном списке.", true);
        return;
      }
      await chrome.runtime.sendMessage({ type: "TOGGLE_BLOCK_SITE", host });
      newRuleHost.value = "";
      showRuleFeedback(`Сайт ${host} добавлен в чёрный список.`);
      renderUserRules();
    }
  });

  async function renderUserRules() {
    const {
      astraUserAdBase = [],
      userWhitelist = [],
      userBlocklist = []
    } = await chrome.storage.local.get(["astraUserAdBase", "userWhitelist", "userBlocklist"]);

    // 4.1. Ручные блокировки рекламы
    const userAdList = $("#userAdList");
    const userAdCount = $("#userAdCount");
    if (userAdCount) userAdCount.textContent = astraUserAdBase.length;
    if (userAdList) {
      userAdList.innerHTML = "";
      if (astraUserAdBase.length === 0) {
        userAdList.innerHTML = `<li style="color:var(--text-soft);font-size:13px;">Ручных правил пока нет. Используйте «Зафиксировать рекламу» в меню расширения или форму выше.</li>`;
      } else {
        astraUserAdBase.forEach((rule, idx) => {
          const li = document.createElement("li");
          li.style.cssText = "display:flex;justify-content:space-between;align-items:center;gap:12px;padding:8px 12px;border-radius:8px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);font-size:13px;";

          if (editingAdIndex === idx) {
            li.innerHTML = `
              <div style="display:flex;flex-wrap:wrap;gap:8px;flex:1;min-width:0;">
                <input type="text" data-edit-sel="${idx}" class="dropdown" value="${escapeHtml(rule.selector)}" style="flex:2;min-width:160px;font-family:monospace;padding:4px 8px;font-size:12px;">
                <input type="text" data-edit-host="${idx}" class="dropdown" value="${escapeHtml(rule.host)}" placeholder="* или example.com" style="flex:1;min-width:120px;padding:4px 8px;font-size:12px;">
              </div>
              <div style="display:flex;gap:6px;flex-shrink:0;">
                <button data-save-ad="${idx}" class="btn primary" style="padding:4px 10px;font-size:12px;">Сохранить</button>
                <button data-cancel-ad="${idx}" class="btn" style="padding:4px 10px;font-size:12px;">Отмена</button>
              </div>
            `;
          } else {
            const scope = rule.host === "*" ? "Все сайты (DNA)" : escapeHtml(rule.host);
            const sizeInfo = rule.size ? ` · ${escapeHtml(rule.size)}` : "";
            const dateStr = formatRuleDate(rule.ts);
            const dateInfo = dateStr ? ` · ${escapeHtml(dateStr)}` : "";
            li.innerHTML = `
              <div style="min-width:0;flex:1;">
                <div style="font-family:monospace;word-break:break-all;color:var(--text);">${escapeHtml(rule.selector)}</div>
                <div style="font-size:11px;color:var(--text-soft);margin-top:2px;">${scope}${sizeInfo}${dateInfo}</div>
              </div>
              <div style="display:flex;gap:6px;flex-shrink:0;">
                <button data-edit-ad="${idx}" class="btn" style="padding:4px 10px;font-size:12px;">Изменить</button>
                <button data-del-ad="${idx}" class="btn danger" style="padding:4px 10px;font-size:12px;">Удалить</button>
              </div>
            `;
          }
          userAdList.appendChild(li);
        });
        userAdList.querySelectorAll("button[data-edit-ad]").forEach(btn => {
          btn.addEventListener("click", () => {
            editingAdIndex = parseInt(btn.dataset.editAd, 10);
            renderUserRules();
          });
        });

        userAdList.querySelectorAll("button[data-cancel-ad]").forEach(btn => {
          btn.addEventListener("click", () => {
            editingAdIndex = -1;
            renderUserRules();
          });
        });

        userAdList.querySelectorAll("button[data-save-ad]").forEach(btn => {
          btn.addEventListener("click", async () => {
            const idx = parseInt(btn.dataset.saveAd, 10);
            const selInput = userAdList.querySelector(`input[data-edit-sel="${idx}"]`);
            const hostInput = userAdList.querySelector(`input[data-edit-host="${idx}"]`);
            const nextSel = (selInput?.value || "").trim();
            const rawHost = (hostInput?.value || "").trim();
            const nextHost = rawHost === "" ? "*" : normalizeHostInput(rawHost);

            if (!isValidCssSelector(nextSel)) {
              showRuleFeedback("Некорректный CSS-селектор при редактировании.", true);
              return;
            }
            if (!nextHost) {
              showRuleFeedback("Некорректный домен. Укажите домен (example.com) или *.", true);
              return;
            }

            const updated = [...astraUserAdBase];
            updated[idx] = {
              ...updated[idx],
              selector: nextSel,
              host: nextHost,
              ts: Date.now(),
              isDNA: nextHost === "*"
            };
            editingAdIndex = -1;
            await chrome.storage.local.set({ astraUserAdBase: updated });
            await notifyTabsBaseUpdated();
            showRuleFeedback("Правило обновлено.");
            renderUserRules();
          });
        });

        userAdList.querySelectorAll("button[data-del-ad]").forEach(btn => {
          btn.addEventListener("click", async () => {
            const idx = parseInt(btn.dataset.delAd, 10);
            if (editingAdIndex === idx) editingAdIndex = -1;
            const updated = astraUserAdBase.filter((_, i) => i !== idx);
            await chrome.storage.local.set({ astraUserAdBase: updated });
            await notifyTabsBaseUpdated();
            renderUserRules();
          });
        });
      }
    }

    // 4.2. Белый список
    const wlList = $("#whitelistList");
    const wlCount = $("#whitelistCount");
    if (wlCount) wlCount.textContent = userWhitelist.length;
    if (wlList) {
      wlList.innerHTML = "";
      if (userWhitelist.length === 0) {
        wlList.innerHTML = `<li style="color:var(--text-soft);font-size:13px;">Белый список пуст.</li>`;
      } else {
        userWhitelist.forEach(host => {
          const li = document.createElement("li");
          li.style.cssText = "display:flex;justify-content:space-between;align-items:center;padding:8px 12px;border-radius:8px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);font-size:13px;";
          li.innerHTML = `
            <span>${escapeHtml(host)}</span>
            <button data-del-wl="${escapeHtml(host)}" class="btn" style="padding:4px 10px;font-size:12px;">Убрать</button>
          `;
          wlList.appendChild(li);
        });
        wlList.querySelectorAll("button[data-del-wl]").forEach(btn => {
          btn.addEventListener("click", async () => {
            const target = btn.dataset.delWl;
            const updated = userWhitelist.filter(h => h !== target);
            await chrome.storage.local.set({ userWhitelist: updated });
            renderUserRules();
          });
        });
      }
    }

    // 4.3. Чёрный список
    const blList = $("#blocklistList");
    const blCount = $("#blocklistCount");
    if (blCount) blCount.textContent = userBlocklist.length;
    if (blList) {
      blList.innerHTML = "";
      if (userBlocklist.length === 0) {
        blList.innerHTML = `<li style="color:var(--text-soft);font-size:13px;">Чёрный список пуст.</li>`;
      } else {
        userBlocklist.forEach(host => {
          const li = document.createElement("li");
          li.style.cssText = "display:flex;justify-content:space-between;align-items:center;padding:8px 12px;border-radius:8px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);font-size:13px;";
          li.innerHTML = `
            <span>${escapeHtml(host)}</span>
            <button data-del-bl="${escapeHtml(host)}" class="btn danger" style="padding:4px 10px;font-size:12px;">Разблокировать</button>
          `;
          blList.appendChild(li);
        });

        blList.querySelectorAll("button[data-del-bl]").forEach(btn => {
          btn.addEventListener("click", async () => {
            const target = btn.dataset.delBl;
            await chrome.runtime.sendMessage({ type: "TOGGLE_BLOCK_SITE", host: target });
            renderUserRules();
          });
        });
      }
    }
  }

  $("#clearUserAdsBtn")?.addEventListener("click", async () => {
    if (!confirm("Удалить все ручные блокировки рекламы?")) return;
    editingAdIndex = -1;
    await chrome.storage.local.set({ astraUserAdBase: [] });
    await notifyTabsBaseUpdated();
    renderUserRules();
  });

  renderUserRules();

  // --- 4.4. ЭКСПОРТ И ИМПОРТ ПОЛЬЗОВАТЕЛЬСКИХ ПРАВИЛ ---
  async function mergeImportedUserRules(payload) {
    const cur = await chrome.storage.local.get(["astraUserAdBase", "userWhitelist", "userBlocklist"]);
    const nextAdBase = [...(cur.astraUserAdBase || [])];
    const nextWL = new Set(cur.userWhitelist || []);
    const nextBL = new Set(cur.userBlocklist || []);
    let addedCount = 0;

    if (Array.isArray(payload.astraUserAdBase)) {
      for (const r of payload.astraUserAdBase) {
        if (!r || typeof r.selector !== "string" || !isValidCssSelector(r.selector)) continue;
        const host = r.host === "*" ? "*" : normalizeHostInput(r.host);
        if (!host) continue;
        if (!nextAdBase.some(ex => ex.host === host && ex.selector === r.selector)) {
          nextAdBase.push({
            id: r.id || ("ua_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6)),
            host,
            selector: r.selector.trim(),
            tag: r.tag || "IMPORT",
            classes: String(r.classes || "").slice(0, 300),
            size: String(r.size || ""),
            ts: typeof r.ts === "number" ? r.ts : Date.now(),
            isDNA: host === "*"
          });
          addedCount++;
        }
      }
    }

    if (Array.isArray(payload.userWhitelist)) {
      for (const h of payload.userWhitelist) {
        const clean = normalizeHostInput(h);
        if (clean && clean !== "*" && !nextWL.has(clean)) {
          nextWL.add(clean);
          nextBL.delete(clean);
          addedCount++;
        }
      }
    }

    if (Array.isArray(payload.userBlocklist)) {
      for (const h of payload.userBlocklist) {
        const clean = normalizeHostInput(h);
        if (clean && clean !== "*" && !nextBL.has(clean)) {
          nextBL.add(clean);
          nextWL.delete(clean);
          addedCount++;
        }
      }
    }

    await chrome.storage.local.set({
      astraUserAdBase: nextAdBase,
      userWhitelist: Array.from(nextWL),
      userBlocklist: Array.from(nextBL),
    });
    await chrome.runtime.sendMessage({ type: "APPLY_USER_BLOCKLIST" }).catch(() => {});
    await notifyTabsBaseUpdated();
    return addedCount;
  }

  $("#exportRulesBtn")?.addEventListener("click", async () => {
    const rulesData = await chrome.storage.local.get(["astraUserAdBase", "userWhitelist", "userBlocklist"]);
    const bundle = {
      type: "astra-user-rules",
      version: chrome.runtime.getManifest().version,
      exportedAt: new Date().toISOString(),
      astraUserAdBase: rulesData.astraUserAdBase || [],
      userWhitelist: rulesData.userWhitelist || [],
      userBlocklist: rulesData.userBlocklist || [],
    };
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `astra-rules-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });

  $("#importRulesBtn")?.addEventListener("click", () => $("#importRulesFile")?.click());
  $("#importRulesFile")?.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const added = await mergeImportedUserRules(data);
      renderUserRules();
      showRuleFeedback(`Импорт завершён: добавлено новых правил — ${added}.`);
    } catch (err) {
      showRuleFeedback("Ошибка импорта правил: " + err.message, true);
    } finally {
      e.target.value = "";
    }
  });

  // --- 5. ЭКСПОРТ / ИМПОРТ / СБРОС ---
  $("#exportBtn").addEventListener("click", async () => {
    const cur = await loadConfig();
    const rulesData = await chrome.storage.local.get(["astraUserAdBase", "userWhitelist", "userBlocklist"]);
    const fullBackup = {
      type: "astra-full-backup",
      version: chrome.runtime.getManifest().version,
      exportedAt: new Date().toISOString(),
      config: cur,
      astraUserAdBase: rulesData.astraUserAdBase || [],
      userWhitelist: rulesData.userWhitelist || [],
      userBlocklist: rulesData.userBlocklist || [],
    };
    const blob = new Blob([JSON.stringify(fullBackup, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `astra-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });

  $("#importBtn").addEventListener("click", () => $("#importFile").click());
  $("#importFile").addEventListener("change", async e => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (data.config && typeof data.config === "object") {
        await saveConfig(data.config);
      } else if (typeof data.enabled === "boolean") {
        await saveConfig(data);
      }
      await mergeImportedUserRules(data);
      location.reload();
    } catch (err) {
      alert("Не удалось загрузить настройки: " + err.message);
    }
  });

  $("#resetBtn").addEventListener("click", async () => {
    if (!confirm("Сбросить все настройки Astra?")) return;
    await chrome.storage.sync.set({ config: DEFAULTS });
    location.reload();
  });

  // --- 6. QR ---
  const qrImgOptions = $("#sberQrImgOptions");
  const qrFallbackOptions = $("#sberQrFallbackOptions");
  if (qrImgOptions && qrFallbackOptions) {
    qrImgOptions.addEventListener("error", () => {
      qrImgOptions.style.display = "none";
      qrFallbackOptions.style.display = "flex";
    });
    qrImgOptions.src = chrome.runtime.getURL("icons/sber-qr.jpg");
  }
}

init();
