/* options-rules.js — Astra · Древо Щит · v0.6.3
   Управление пользовательскими правилами (Ad DNA, белый и чёрный списки, импорт/экспорт).
*/
import {
  $,
  escapeHtml,
  formatRuleDate,
  normalizeHostInput,
  isValidCssSelector,
  notifyTabsBaseUpdated
} from "./options-utils.js";

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

  await chrome.storage.local.set({
    astraUserAdBase: nextAdBase,
    userWhitelist: Array.from(nextWL),
    userBlocklist: Array.from(nextBL),
  });
  await chrome.runtime.sendMessage({ type: "APPLY_USER_BLOCKLIST" }).catch(() => {});
  await notifyTabsBaseUpdated();
  return addedCount;
}
export async function renderUserRules() {
  const {
    astraUserAdBase = [],
    userWhitelist = [],
    userBlocklist = []
  } = await chrome.storage.local.get(["astraUserAdBase", "userWhitelist", "userBlocklist"]);

  // 1. Ручные блокировки рекламы
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
  // 2. Белый список
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

  // 3. Чёрный список
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

  $("#clearUserAdsBtn")?.addEventListener("click", async () => {
    if (!confirm("Удалить все ручные блокировки рекламы?")) return;
    editingAdIndex = -1;
    await chrome.storage.local.set({ astraUserAdBase: [] });
    await notifyTabsBaseUpdated();
    renderUserRules();
  });

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

  renderUserRules();
}
