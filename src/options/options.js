/* options.js — Astra · Древо Щит · v0.6.3
   Входной модуль страницы настроек (навигация, общие параметры, статистика, бэкап).
*/
import { loadConfig, saveConfig, DEFAULTS } from "../shared/config.js";
import { $, escapeHtml, formatRuleDate, formatBytes } from "./options-utils.js";
import { initRulesSection, mergeImportedUserRules } from "./options-rules.js";

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
  initRulesSection();

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
    const file = e.target.files?.at(0);
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
