/* options-rules.js — Astra · Древо Щит · v0.7.2
   Управление пользовательскими правилами (siteOverrides, Ad DNA, белый и чёрный списки, импорт/экспорт).
*/
import { DEFAULTS, loadConfig, saveConfig } from "../shared/config.js";
import {
  $,
  formatRuleDate,
  normalizeHostInput,
  isValidCssSelector,
  notifyTabsBaseUpdated
} from "./options-utils.js";

const MODULE_LABELS = {
  phishing: "Антифишинг",
  ads: "Реклама",
  miners: "Майнеры",
  downloads: "Проверка загрузок",
  clickjacking: "Кликджекинг",
  popunder: "Pop-Under",
  antiFingerprint: "Anti-Fingerprint",
  visibilitySpoof: "Анти-пауза видео",
  webrtcShield: "WebRTC IP",
  blockDownloads: "Блок загрузок",
};

let editingAdIndex = -1;

export function showRuleFeedback(msg, isError = false) {
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

function sanitizeOverridesMap(rawMap) {
  if (!rawMap || typeof rawMap !== "object" || Array.isArray(rawMap)) return {};
  const allowedKeys = Object.keys(DEFAULTS.modules);
  const cleanMap = {};
  for (const [rawHost, mods] of Object.entries(rawMap)) {
    const host = normalizeHostInput(rawHost);
    if (!host || host === "*" || !mods || typeof mods !== "object" || Array.isArray(mods)) continue;
    const entry = {};
    for (const k of allowedKeys) {
      if (typeof mods[k] === "boolean") {
        entry[k] = mods[k];
      }
    }
    if (Object.keys(entry).length > 0) {
      cleanMap[host] = entry;
    }
  }
  return cleanMap;
}

export async function mergeImportedUserRules(payload) {
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

  const importedOverrides = sanitizeOverridesMap(payload.siteOverrides);
  const overrideHosts = Object.keys(importedOverrides);
  if (overrideHosts.length > 0) {
    const cfg = await loadConfig();
    const patchOverrides = {};
    for (const host of overrideHosts) {
      const existing = cfg.siteOverrides?.[host] || {};
      const merged = { ...existing, ...importedOverrides[host] };
      if (JSON.stringify(existing) !== JSON.stringify(merged)) {
        patchOverrides[host] = merged;
        addedCount++;
      }
    }
    if (Object.keys(patchOverrides).length > 0) {
      await saveConfig({ siteOverrides: patchOverrides });
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

function appendOverrideBadges(container, mods) {
  if (!mods || typeof mods !== "object") return;
  for (const [key, val] of Object.entries(mods)) {
    if (typeof val !== "boolean") continue;
    const label = MODULE_LABELS[key] || key;
    const stateText = val ? "Вкл" : "Выкл";
    const bg = val ? "rgba(67, 160, 71, 0.16)" : "rgba(229, 57, 53, 0.16)";
    const color = val ? "var(--ok, #43a047)" : "var(--danger, #e53935)";
    const badge = document.createElement("span");
    badge.style.cssText = `display:inline-block;padding:2px 7px;border-radius:6px;font-size:11px;background:${bg};color:${color};margin:2px 4px 0 0;`;
    badge.textContent = `${label}: ${stateText}`;
    container.appendChild(badge);
  }
}

export async function renderUserRules() {
  const [localData, cfg] = await Promise.all([
    chrome.storage.local.get(["astraUserAdBase", "userWhitelist", "userBlocklist"]),
    loadConfig()
  ]);
  const astraUserAdBase = localData.astraUserAdBase || [];
  const userWhitelist = localData.userWhitelist || [];
  const userBlocklist = localData.userBlocklist || [];
  const siteOverrides = cfg.siteOverrides || {};
  // 0. Индивидуальные настройки сайтов (siteOverrides)
  const overridesList = $("#siteOverridesList");
  const overridesCount = $("#siteOverridesCount");
  const overrideHosts = Object.keys(siteOverrides).sort();
  if (overridesCount) overridesCount.textContent = overrideHosts.length;
  if (overridesList) {
    overridesList.replaceChildren();
    if (overrideHosts.length === 0) {
      const emptyLi = document.createElement("li");
      emptyLi.style.cssText = "color:var(--text-soft);font-size:13px;";
      emptyLi.textContent = "Индивидуальных настроек для отдельных сайтов пока нет. Откройте попап Astra на нужном сайте и переключите любой модуль.";
      overridesList.appendChild(emptyLi);
    } else {
      overrideHosts.forEach((host) => {
        const li = document.createElement("li");
        li.style.cssText = "display:flex;justify-content:space-between;align-items:center;gap:12px;padding:8px 12px;border-radius:8px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);font-size:13px;";

        const infoDiv = document.createElement("div");
        infoDiv.style.cssText = "min-width:0;flex:1;";

        const hostDiv = document.createElement("div");
        hostDiv.style.cssText = "font-weight:600;color:var(--text);";
        hostDiv.textContent = host;

        const badgesDiv = document.createElement("div");
        badgesDiv.style.marginTop = "4px";
        appendOverrideBadges(badgesDiv, siteOverrides[host]);

        infoDiv.append(hostDiv, badgesDiv);

        const resetBtn = document.createElement("button");
        resetBtn.type = "button";
        resetBtn.className = "btn";
        resetBtn.style.cssText = "padding:4px 10px;font-size:12px;flex-shrink:0;";
        resetBtn.textContent = "Сбросить";
        resetBtn.addEventListener("click", async () => {
          await saveConfig({ siteOverrides: { [host]: null } });
          await notifyTabsBaseUpdated();
          showRuleFeedback(`Индивидуальные настройки для ${host} сброшены.`);
          renderUserRules();
        });

        li.append(infoDiv, resetBtn);
        overridesList.appendChild(li);
      });
    }
  }

  // 1. Ручные блокировки рекламы
  const userAdList = $("#userAdList");
  const userAdCount = $("#userAdCount");
  if (userAdCount) userAdCount.textContent = astraUserAdBase.length;
  if (userAdList) {
    userAdList.replaceChildren();
    if (astraUserAdBase.length === 0) {
      const emptyLi = document.createElement("li");
      emptyLi.style.cssText = "color:var(--text-soft);font-size:13px;";
      emptyLi.textContent = "Ручных правил пока нет. Используйте «Зафиксировать рекламу» в меню расширения или форму выше.";
      userAdList.appendChild(emptyLi);
    } else {
      astraUserAdBase.forEach((rule, idx) => {
        const li = document.createElement("li");
        li.style.cssText = "display:flex;justify-content:space-between;align-items:center;gap:12px;padding:8px 12px;border-radius:8px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);font-size:13px;";

        if (editingAdIndex === idx) {
          const inputsWrap = document.createElement("div");
          inputsWrap.style.cssText = "display:flex;flex-wrap:wrap;gap:8px;flex:1;min-width:0;";

          const selInput = document.createElement("input");
          selInput.type = "text";
          selInput.className = "dropdown";
          selInput.value = rule.selector;
          selInput.style.cssText = "flex:2;min-width:160px;font-family:monospace;padding:4px 8px;font-size:12px;";

          const hostInput = document.createElement("input");
          hostInput.type = "text";
          hostInput.className = "dropdown";
          hostInput.value = rule.host;
          hostInput.placeholder = "* или example.com";
          hostInput.style.cssText = "flex:1;min-width:120px;padding:4px 8px;font-size:12px;";

          inputsWrap.append(selInput, hostInput);
          const actionsWrap = document.createElement("div");
          actionsWrap.style.cssText = "display:flex;gap:6px;flex-shrink:0;";

          const saveBtn = document.createElement("button");
          saveBtn.type = "button";
          saveBtn.className = "btn primary";
          saveBtn.style.cssText = "padding:4px 10px;font-size:12px;";
          saveBtn.textContent = "Сохранить";
          saveBtn.addEventListener("click", async () => {
            const nextSel = (selInput.value || "").trim();
            const rawHost = (hostInput.value || "").trim();
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

          const cancelBtn = document.createElement("button");
          cancelBtn.type = "button";
          cancelBtn.className = "btn";
          cancelBtn.style.cssText = "padding:4px 10px;font-size:12px;";
          cancelBtn.textContent = "Отмена";
          cancelBtn.addEventListener("click", () => {
            editingAdIndex = -1;
            renderUserRules();
          });

          actionsWrap.append(saveBtn, cancelBtn);
          li.append(inputsWrap, actionsWrap);
        } else {
          const scope = rule.host === "*" ? "Все сайты (DNA)" : rule.host;
          const sizeInfo = rule.size ? ` · ${rule.size}` : "";
          const dateStr = formatRuleDate(rule.ts);
          const dateInfo = dateStr ? ` · ${dateStr}` : "";

          const infoWrap = document.createElement("div");
          infoWrap.style.cssText = "min-width:0;flex:1;";

          const selDiv = document.createElement("div");
          selDiv.style.cssText = "font-family:monospace;word-break:break-all;color:var(--text);";
          selDiv.textContent = rule.selector;

          const metaDiv = document.createElement("div");
          metaDiv.style.cssText = "font-size:11px;color:var(--text-soft);margin-top:2px;";
          metaDiv.textContent = `${scope}${sizeInfo}${dateInfo}`;

          infoWrap.append(selDiv, metaDiv);

          const actionsWrap = document.createElement("div");
          actionsWrap.style.cssText = "display:flex;gap:6px;flex-shrink:0;";

          const editBtn = document.createElement("button");
          editBtn.type = "button";
          editBtn.className = "btn";
          editBtn.style.cssText = "padding:4px 10px;font-size:12px;";
          editBtn.textContent = "Изменить";
          editBtn.addEventListener("click", () => {
            editingAdIndex = idx;
            renderUserRules();
          });

          const delBtn = document.createElement("button");
          delBtn.type = "button";
          delBtn.className = "btn danger";
          delBtn.style.cssText = "padding:4px 10px;font-size:12px;";
          delBtn.textContent = "Удалить";
          delBtn.addEventListener("click", async () => {
            if (editingAdIndex === idx) editingAdIndex = -1;
            const updated = astraUserAdBase.filter((_, i) => i !== idx);
            await chrome.storage.local.set({ astraUserAdBase: updated });
            await notifyTabsBaseUpdated();
            renderUserRules();
          });

          actionsWrap.append(editBtn, delBtn);
          li.append(infoWrap, actionsWrap);
        }
        userAdList.appendChild(li);
      });
    }
  }
  // 2. Белый список
  const wlList = $("#whitelistList");
  const wlCount = $("#whitelistCount");
  if (wlCount) wlCount.textContent = userWhitelist.length;
  if (wlList) {
    wlList.replaceChildren();
    if (userWhitelist.length === 0) {
      const emptyLi = document.createElement("li");
      emptyLi.style.cssText = "color:var(--text-soft);font-size:13px;";
      emptyLi.textContent = "Белый список пуст.";
      wlList.appendChild(emptyLi);
    } else {
      userWhitelist.forEach((host) => {
        const li = document.createElement("li");
        li.style.cssText = "display:flex;justify-content:space-between;align-items:center;padding:8px 12px;border-radius:8px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);font-size:13px;";

        const hostSpan = document.createElement("span");
        hostSpan.textContent = host;

        const delBtn = document.createElement("button");
        delBtn.type = "button";
        delBtn.className = "btn";
        delBtn.style.cssText = "padding:4px 10px;font-size:12px;";
        delBtn.textContent = "Убрать";
        delBtn.addEventListener("click", async () => {
          await chrome.runtime.sendMessage({ type: "TOGGLE_WHITELIST", host }).catch(() => {});
          renderUserRules();
        });

        li.append(hostSpan, delBtn);
        wlList.appendChild(li);
      });
    }
  }

  // 3. Чёрный список
  const blList = $("#blocklistList");
  const blCount = $("#blocklistCount");
  if (blCount) blCount.textContent = userBlocklist.length;
  if (blList) {
    blList.replaceChildren();
    if (userBlocklist.length === 0) {
      const emptyLi = document.createElement("li");
      emptyLi.style.cssText = "color:var(--text-soft);font-size:13px;";
      emptyLi.textContent = "Чёрный список пуст.";
      blList.appendChild(emptyLi);
    } else {
      userBlocklist.forEach((host) => {
        const li = document.createElement("li");
        li.style.cssText = "display:flex;justify-content:space-between;align-items:center;padding:8px 12px;border-radius:8px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);font-size:13px;";

        const hostSpan = document.createElement("span");
        hostSpan.textContent = host;

        const delBtn = document.createElement("button");
        delBtn.type = "button";
        delBtn.className = "btn danger";
        delBtn.style.cssText = "padding:4px 10px;font-size:12px;";
        delBtn.textContent = "Разблокировать";
        delBtn.addEventListener("click", async () => {
          await chrome.runtime.sendMessage({ type: "TOGGLE_BLOCK_SITE", host }).catch(() => {});
          renderUserRules();
        });

        li.append(hostSpan, delBtn);
        blList.appendChild(li);
      });
    }
  }
}

export function initRulesSection() {
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
      await chrome.runtime.sendMessage({ type: "TOGGLE_WHITELIST", host }).catch(() => {});
      newRuleHost.value = "";
      showRuleFeedback(`Сайт ${host} добавлен в белый список.`);
      renderUserRules();
    } else if (type === "blocklist") {
      const { userBlocklist = [] } = await chrome.storage.local.get("userBlocklist");
      if (userBlocklist.includes(host)) {
        showRuleFeedback("Этот сайт уже в чёрном списке.", true);
        return;
      }
      await chrome.runtime.sendMessage({ type: "TOGGLE_BLOCK_SITE", host }).catch(() => {});
      newRuleHost.value = "";
      showRuleFeedback(`Сайт ${host} добавлен в чёрный список.`);
      renderUserRules();
    }
  });

  $("#clearSiteOverridesBtn")?.addEventListener("click", async () => {
    const cfg = await loadConfig();
    if (!cfg.siteOverrides || Object.keys(cfg.siteOverrides).length === 0) return;
    if (!confirm("Сбросить все индивидуальные настройки сайтов?")) return;
    const cur = await loadConfig();
    await chrome.storage.sync.set({ config: { ...cur, siteOverrides: {} } });
    await notifyTabsBaseUpdated();
    showRuleFeedback("Все индивидуальные настройки сайтов сброшены.");
    renderUserRules();
  });

  $("#clearUserAdsBtn")?.addEventListener("click", async () => {
    if (!confirm("Удалить все ручные блокировки рекламы?")) return;
    editingAdIndex = -1;
    await chrome.storage.local.set({ astraUserAdBase: [] });
    await notifyTabsBaseUpdated();
    renderUserRules();
  });

  $("#exportRulesBtn")?.addEventListener("click", async () => {
    const [rulesData, cfg] = await Promise.all([
      chrome.storage.local.get(["astraUserAdBase", "userWhitelist", "userBlocklist"]),
      loadConfig()
    ]);
    const bundle = {
      type: "astra-user-rules",
      version: chrome.runtime.getManifest().version,
      exportedAt: new Date().toISOString(),
      siteOverrides: cfg.siteOverrides || {},
      astraUserAdBase: rulesData.astraUserAdBase || [],
      userWhitelist: rulesData.userWhitelist || [],
      userBlocklist: rulesData.userBlocklist || [],
    };
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `astra-rules-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  });

  $("#importRulesBtn")?.addEventListener("click", () => $("#importRulesFile")?.click());
  $("#importRulesFile")?.addEventListener("change", async (e) => {
    const file = e.target.files?.at(0);
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

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && (changes.astraUserAdBase || changes.userWhitelist || changes.userBlocklist)) {
      renderUserRules();
    }
    if (area === "sync" && changes.config) {
      renderUserRules();
    }
  });

  renderUserRules();
}
