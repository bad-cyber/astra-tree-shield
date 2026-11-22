/* options.js — Astra · Древо Щит · v0.7.0
   Входной модуль страницы настроек (навигация, общие параметры, статистика, бэкап — B45, агрегатор хэшей — B56).
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

  // --- 1. НАВИГАЦИЯ (с поддержкой прямого URL-хэша B45) ---
  const navLinks = document.querySelectorAll(".side nav a");
  const sections = document.querySelectorAll(".content section");

  function activateSection(rawId) {
    const cleanId = (rawId || "").replace(/^#/, "");
    const target = cleanId ? document.getElementById(cleanId) : null;
    const activeSec = target || (sections.length > 0 ? sections.item(0) : null);
    if (!activeSec) return;

    navLinks.forEach((l) => {
      const hrefId = (l.getAttribute("href") || "").replace(/^#/, "");
      l.classList.toggle("active", hrefId === activeSec.id);
    });
    sections.forEach((s) => s.classList.toggle("active-section", s.id === activeSec.id));
  }

  navLinks.forEach((link) => {
    link.addEventListener("click", (e) => {
      e.preventDefault();
      const targetId = (link.getAttribute("href") || "").replace(/^#/, "");
      activateSection(targetId);
      if (targetId) {
        try { history.replaceState(null, "", "#" + targetId); } catch {}
      }
    });
  });

  activateSection(location.hash);
  window.addEventListener("hashchange", () => activateSection(location.hash));
  // --- 2. НАСТРОЙКИ ---
  function syncFormFromConfig(currentCfg) {
    if ($("#enabled")) $("#enabled").checked = !!currentCfg.enabled;
    if ($("#theme")) $("#theme").value = currentCfg.theme;
    document.documentElement.setAttribute("data-theme", currentCfg.theme);

    document.querySelectorAll("input[data-mod]").forEach((el) => {
      el.checked = !!currentCfg.modules[el.dataset.mod];
    });

    if ($("#loadMonitorEnabled")) {
      $("#loadMonitorEnabled").checked = currentCfg.loadMonitor?.enabled !== false;
    }
    if ($("#loadMonitorWarnMB")) {
      $("#loadMonitorWarnMB").value = currentCfg.loadMonitor?.warnMB || 5;
    }
    if ($("#hashFeedUrlInput")) {
      $("#hashFeedUrlInput").value = currentCfg.hashFeedUrl || "";
    }
  }

  syncFormFromConfig(cfg);

  document.querySelectorAll("input[data-mod]").forEach((el) => {
    el.addEventListener("change", async () => {
      await saveConfig({ modules: { [el.dataset.mod]: el.checked } });
    });
  });

  const lmEnabled = $("#loadMonitorEnabled");
  const lmWarn = $("#loadMonitorWarnMB");
  if (lmEnabled) {
    lmEnabled.addEventListener("change", async (e) => {
      const cur = await loadConfig();
      await saveConfig({ loadMonitor: { ...cur.loadMonitor, enabled: e.target.checked } });
    });
  }
  if (lmWarn) {
    lmWarn.addEventListener("change", async (e) => {
      const v = Math.max(1, Math.min(50, parseInt(e.target.value, 10) || 5));
      e.target.value = v;
      const cur = await loadConfig();
      await saveConfig({ loadMonitor: { ...cur.loadMonitor, warnMB: v } });
    });
  }

  $("#saveHashFeedBtn")?.addEventListener("click", async () => {
    const input = $("#hashFeedUrlInput");
    const statusEl = $("#hashFeedStatus");
    if (!input) return;
    const raw = input.value.trim();
    if (raw) {
      try {
        const parsed = new URL(raw);
        if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
          throw new Error("URL должен начинаться с https://");
        }
      } catch (err) {
        if (statusEl) {
          statusEl.style.color = "var(--danger)";
          statusEl.textContent = "Ошибка: укажите корректный URL (https://...)";
        }
        return;
      }
    }
    await saveConfig({ hashFeedUrl: raw });
    if (statusEl) {
      statusEl.style.color = "var(--ok)";
      statusEl.textContent = raw ? "URL сохранён. Идёт синхронизация хэшей..." : "URL очищен. Используются встроенные эталонные хэши.";
    }
    await chrome.runtime.sendMessage({ type: "FORCE_UPDATE_DB" }).catch(() => {});
    await loadDbStats();
  });

  $("#enabled").addEventListener("change", (e) => saveConfig({ enabled: e.target.checked }));
  $("#theme").addEventListener("change", async (e) => {
    await saveConfig({ theme: e.target.value });
    document.documentElement.setAttribute("data-theme", e.target.value);
  });

  chrome.storage.onChanged.addListener(async (changes, area) => {
    if (area === "sync" && changes.config) {
      const nextCfg = await loadConfig();
      syncFormFromConfig(nextCfg);
    }
    if (area === "local" && (changes.adblockCount || changes.threatFeed || changes.trafficStats || changes.lastAdblockUpdate || changes.maliciousHashesCount)) {
      loadDbStats();
    }
  });
  // --- 3. СТАТИСТИКА БАЗ И ЭКОНОМИИ ТРАФИКА ---
  async function loadDbStats() {
    const storage = await chrome.storage.local.get([
      "lastAdblockUpdate", "adblockCount", "adblockStatus", "adblockError",
      "threatFeed", "trafficStats", "maliciousHashesCount", "maliciousHashesStatus", "maliciousHashesError"
    ]);

    $("#adblockCount").textContent = storage.adblockCount || 0;
    if ($("#threatFeedCount")) {
      $("#threatFeedCount").textContent = (storage.threatFeed || []).length;
    }
    if ($("#hashFeedCount")) {
      $("#hashFeedCount").textContent = storage.maliciousHashesCount || 4;
    }

    const hashStatusEl = $("#hashFeedStatus");
    if (hashStatusEl && storage.maliciousHashesStatus === "error" && storage.maliciousHashesError) {
      hashStatusEl.style.color = "var(--danger)";
      hashStatusEl.textContent = `Ошибка синхронизации хэшей: ${storage.maliciousHashesError}`;
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
      btn.textContent = "✓ Базы обновлены";
      setTimeout(() => { btn.textContent = "Обновить базы сейчас"; }, 1800);
    } catch (err) {
      console.warn(err);
      btn.textContent = "Ошибка обновления";
      setTimeout(() => { btn.textContent = "Обновить базы сейчас"; }, 2000);
    } finally {
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
    document.body.appendChild(a);
    a.click();
    a.remove();
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
