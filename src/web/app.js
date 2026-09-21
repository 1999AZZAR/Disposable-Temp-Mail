"use strict";

/* Disposable Temp Mail — inbox client (vanilla JS, no dependencies).
 * API contract: GET /api/config, GET /api/session, GET+POST /api/inboxes,
 * POST /api/inboxes/claim, POST /api/inboxes/:address/renew,
 * PATCH /api/inboxes/:address/retention, DELETE /api/inboxes/:address,
 * GET /api/inboxes/:address/messages.
 * Session is carried in the x-session-id header and localStorage.
 * Transfer codes link an inbox filed on another device to this session.
 */

const $ = (id) => document.getElementById(id);

const els = {
  appTitle: $("appTitle"),
  appSubtitle: $("appSubtitle"),
  sessionBadge: $("sessionBadge"),
  sessionStatus: $("sessionStatus"),
  inboxList: $("inboxList"),
  inboxCount: $("inboxCount"),
  composerForm: $("composerForm"),
  localPartInput: $("localPartInput"),
  domainSelect: $("domainSelect"),
  retentionSelect: $("retentionSelect"),
  planSelect: $("planSelect"),
  retentionLine: $("retentionLine"),
  renewBtn: $("renewBtn"),
  createBtn: $("createBtn"),
  claimForm: $("claimForm"),
  claimCodeInput: $("claimCodeInput"),
  claimBtn: $("claimBtn"),
  currentInbox: $("currentInbox"),
  messageCount: $("messageCount"),
  transferHint: $("transferHint"),
  messageList: $("messageList"),
  copyBtn: $("copyBtn"),
  copyCodeBtn: $("copyCodeBtn"),
  refreshBtn: $("refreshBtn"),
  deleteBtn: $("deleteBtn"),
  deleteDialog: $("deleteDialog"),
  deleteDialogText: $("deleteDialogText"),
  confirmDeleteBtn: $("confirmDeleteBtn"),
  toastContainer: $("toastContainer"),
  themeToggle: $("themeToggle"),
  themeToggleLabel: $("themeToggleLabel"),
};

const SESSION_KEY = "disposable_temp_mail_session_id";
const REFRESH_INTERVAL_MS = 30000;

const state = {
  config: { appName: "Disposable Temp Mail", mailDomain: "example.com", mailDomains: ["example.com"], retentionOptions: [7, 30, 90], defaultRetentionDays: 7 },
  sessionId: localStorage.getItem(SESSION_KEY) || "",
  inboxes: [],
  selected: "",
  messages: [],
  openMessage: "",
  loadingMessages: false,
};

const ICONS = {
  mail: '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>',
  inbox: '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>',
  alert: '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>',
};

function setSessionBadge(mode, text) {
  els.sessionBadge.classList.toggle("is-ready", mode === "ready");
  els.sessionBadge.classList.toggle("is-error", mode === "error");
  els.sessionStatus.textContent = text;
}

function showToast(text, variant) {
  const toast = document.createElement("div");
  toast.className = "toast" + (variant === "success" || variant === "error" ? ` is-${variant}` : "");
  toast.setAttribute("role", "status");
  toast.textContent = text;
  els.toastContainer.appendChild(toast);
  window.setTimeout(() => {
    toast.classList.add("is-leaving");
    window.setTimeout(() => toast.remove(), 220);
  }, 2400);
}

function flashButton(button, kind) {
  if (!button) return;
  button.classList.add(kind === "error" ? "is-error" : "is-success");
  window.setTimeout(() => button.classList.remove("is-success", "is-error"), 1200);
}

async function fetchJson(url, options = {}) {
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  if (state.sessionId) headers["x-session-id"] = state.sessionId;
  const response = await fetch(url, { ...options, headers });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

function setBusy(button, busy) {
  if (!button) return;
  button.classList.toggle("is-loading", busy);
  button.disabled = busy || button.dataset.locked === "true";
}

function lockReaderButtons(locked) {
  for (const button of [els.copyBtn, els.copyCodeBtn, els.refreshBtn, els.renewBtn, els.deleteBtn]) {
    button.dataset.locked = locked ? "true" : "false";
    button.disabled = locked;
  }
  els.planSelect.disabled = locked;
}

/* ---------- Retention (keep-for plans + renew) ---------- */

function retentionLabel(days) {
  if (days === null || days === undefined) return "Until I remove it";
  return `${days} days`;
}

function fillRetentionSelect(select, current) {
  select.innerHTML = "";
  for (const days of state.config.retentionOptions) {
    const option = document.createElement("option");
    option.value = String(days);
    option.textContent = `${days} days`;
    if (String(days) === String(current)) option.selected = true;
    select.appendChild(option);
  }
  const keep = document.createElement("option");
  keep.value = "keep";
  keep.textContent = "Until I remove it";
  if (current === "keep" || current === null) keep.selected = true;
  select.appendChild(keep);
}

function selectedInboxEntry() {
  return state.inboxes.find((entry) => entry.address === state.selected);
}

function expiryDate(inbox) {
  if (inbox.retention_days === null || inbox.retention_days === undefined) return null;
  const created = new Date(String(inbox.created_at).replace(" ", "T") + "Z");
  if (Number.isNaN(created.getTime())) return null;
  return new Date(created.getTime() + inbox.retention_days * 86400000);
}

function renderRetentionLine() {
  els.retentionLine.textContent = "";
  const inbox = selectedInboxEntry();
  if (!inbox) return;
  fillRetentionSelect(els.planSelect, inbox.retention_days === null ? "keep" : inbox.retention_days);
  const expiry = expiryDate(inbox);
  if (!expiry) {
    els.retentionLine.textContent = "Keeps until you remove it. Mail older than 90 days still ages out.";
    return;
  }
  const date = expiry.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  els.retentionLine.textContent = `Keeps until ${date} · plan ${inbox.retention_days} days. Renew restarts the clock.`;
}

function updateInboxEntry(updated) {
  const index = state.inboxes.findIndex((entry) => entry.address === updated.address);
  if (index >= 0) state.inboxes[index] = { ...state.inboxes[index], ...updated };
}

async function renewSelected() {
  if (!state.selected) return;
  setBusy(els.renewBtn, true);
  try {
    const response = await fetchJson(`/api/inboxes/${encodeURIComponent(state.selected)}/renew`, { method: "POST" });
    updateInboxEntry(response);
    renderRetentionLine();
    const expiry = expiryDate(response);
    const until = expiry ? expiry.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "until you remove it";
    showToast(`Clock restarted — kept ${until}.`, "success");
    flashButton(els.renewBtn, "ok");
  } catch (error) {
    showToast(`Could not renew inbox: ${error.message || error}`, "error");
    flashButton(els.renewBtn, "error");
  } finally {
    setBusy(els.renewBtn, false);
  }
}

async function handlePlanChange() {
  if (!state.selected) return;
  const value = els.planSelect.value;
  try {
    const response = await fetchJson(`/api/inboxes/${encodeURIComponent(state.selected)}/retention`, {
      method: "PATCH",
      body: JSON.stringify({ retentionDays: value === "keep" ? "keep" : Number(value) }),
    });
    updateInboxEntry(response);
    renderRetentionLine();
    showToast(`Plan set — ${retentionLabel(response.retention_days).toLowerCase()}.`, "success");
  } catch (error) {
    showToast(`Could not change plan: ${error.message || error}`, "error");
    renderRetentionLine();
  }
}

/* ---------- Config & session ---------- */

async function loadConfig() {
  const config = await fetchJson("/api/config", { headers: {} });
  state.config = {
    appName: config.appName || state.config.appName,
    mailDomain: config.mailDomain || state.config.mailDomain,
    mailDomains: config.mailDomains && config.mailDomains.length ? config.mailDomains : [config.mailDomain || "example.com"],
  };
  document.title = state.config.appName;
  els.appTitle.textContent = state.config.appName;
  els.appSubtitle.textContent = `Anonymous disposable inboxes for the masses`;
  els.localPartInput.placeholder = "Custom name — empty for random";

  els.domainSelect.innerHTML = "";
  for (const domain of state.config.mailDomains) {
    const option = document.createElement("option");
    option.value = domain;
    option.textContent = `@${domain}`;
    els.domainSelect.appendChild(option);
  }
  els.domainSelect.style.display = state.config.mailDomains.length <= 1 ? "none" : "";
  els.domainSelect.previousElementSibling.style.display = state.config.mailDomains.length <= 1 ? "none" : "";

  state.config.retentionOptions = Array.isArray(config.retentionOptions) && config.retentionOptions.length
    ? config.retentionOptions
    : state.config.retentionOptions;
  state.config.defaultRetentionDays = config.defaultRetentionDays || state.config.defaultRetentionDays;
  fillRetentionSelect(els.retentionSelect, String(state.config.defaultRetentionDays));
  initTurnstile(config.turnstileSiteKey || "");
}

/* ---------- Turnstile bot gate (inbox creation) ---------- */

const turnstileState = { widgetId: null, token: "" };

function initTurnstile(siteKey, attempt) {
  if (!siteKey) return;
  if (typeof window.turnstile === "undefined") {
    // turnstile api.js loads async — retry briefly, then give up silently
    if ((attempt || 0) < 20) setTimeout(() => initTurnstile(siteKey, (attempt || 0) + 1), 250);
    return;
  }
  try {
    document.getElementById("turnstileSlot").hidden = false;
    turnstileState.widgetId = window.turnstile.render("#turnstileWidget", {
      sitekey: siteKey,
      callback: (token) => { turnstileState.token = token; },
      'expired-callback': () => { turnstileState.token = ""; },
      'error-callback': () => { turnstileState.token = ""; },
    });
  } catch {
    /* widget unavailable: server still enforces when keys are set */
  }
}

function resetTurnstile() {
  turnstileState.token = "";
  if (turnstileState.widgetId !== null && typeof window.turnstile !== "undefined") {
    try { window.turnstile.reset(turnstileState.widgetId); } catch { /* noop */ }
  }
}

async function ensureSession() {
  const payload = await fetchJson("/api/session");
  state.sessionId = payload.sessionId;
  localStorage.setItem(SESSION_KEY, state.sessionId);
  setSessionBadge("ready", "Anonymous session");
}

/* ---------- Inboxes ---------- */

function renderInboxList() {
  els.inboxList.innerHTML = "";

  if (!state.inboxes.length) {
    const empty = document.createElement("li");
    empty.className = "inbox-empty";
    empty.textContent = "No entries yet. File your first address above.";
    els.inboxList.appendChild(empty);
    return;
  }

  for (const inbox of state.inboxes) {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "inbox-option";
    button.dataset.address = inbox.address;
    button.setAttribute("aria-selected", inbox.address === state.selected ? "true" : "false");

    const label = document.createElement("span");
    label.className = "address";
    label.textContent = inbox.address;

    button.appendChild(label);
    button.addEventListener("click", () => selectInbox(inbox.address));
    item.appendChild(button);
    els.inboxList.appendChild(item);
  }
}

async function loadInboxes(selectedAddress) {
  const inboxes = await fetchJson("/api/inboxes");
  state.inboxes = Array.isArray(inboxes) ? inboxes : [];
  els.inboxCount.textContent = String(state.inboxes.length);

  if (!state.inboxes.length) {
    state.selected = "";
    state.messages = [];
    state.openMessage = "";
    els.currentInbox.textContent = "No inbox selected";
    els.messageCount.textContent = "0 messages";
    renderTransferHint();
    renderRetentionLine();
    lockReaderButtons(true);
    renderInboxList();
    renderMessages();
    return;
  }

  const valid = state.inboxes.some((inbox) => inbox.address === selectedAddress);
  state.selected = valid ? selectedAddress : state.inboxes[0].address;
  state.openMessage = "";
  lockReaderButtons(false);
  renderInboxList();
  renderTransferHint();
  renderRetentionLine();
  await loadMessages();
}

async function selectInbox(address) {
  if (address === state.selected) return;
  state.selected = address;
  state.openMessage = "";
  renderInboxList();
  renderTransferHint();
  renderRetentionLine();
  await loadMessages();
}

/* ---------- Transfer codes (cross-device) ---------- */

function selectedTransferCode() {
  const inbox = state.inboxes.find((entry) => entry.address === state.selected);
  return (inbox && inbox.transferCode) || "";
}

function renderTransferHint() {
  els.transferHint.innerHTML = "";
  if (!state.selected) return;
  const code = selectedTransferCode();
  if (!code) {
    els.transferHint.textContent = "Transfer code unavailable for this entry.";
    return;
  }
  els.transferHint.textContent = "Transfer code ";
  const stamp = document.createElement("span");
  stamp.className = "transfer-code";
  stamp.textContent = code;
  els.transferHint.appendChild(stamp);
  els.transferHint.append(" — enter it on another device to shelve this inbox there.");
}

async function copyTransferCode() {
  const code = selectedTransferCode();
  if (!code) return;
  try {
    await navigator.clipboard.writeText(code);
  } catch {
    const temp = document.createElement("textarea");
    temp.value = code;
    document.body.appendChild(temp);
    temp.select();
    document.execCommand("copy");
    temp.remove();
  }
  showToast("Transfer code copied to clipboard.", "success");
  flashButton(els.copyCodeBtn, "ok");
}

async function handleClaimSubmit(event) {
  event.preventDefault();
  const code = els.claimCodeInput.value.trim();
  if (!code) {
    showToast("Enter a transfer code first.", "error");
    flashButton(els.claimBtn, "error");
    els.claimCodeInput.focus();
    return;
  }
  setBusy(els.claimBtn, true);
  try {
    const response = await fetchJson("/api/inboxes/claim", {
      method: "POST",
      body: JSON.stringify({ code }),
    });
    els.claimCodeInput.value = "";
    await loadInboxes(response.address);
    showToast(`Address ${response.address} is shelved here.`, "success");
    flashButton(els.claimBtn, "ok");
  } catch (error) {
    showToast(`Could not link inbox: ${error.message || error}`, "error");
    flashButton(els.claimBtn, "error");
  } finally {
    setBusy(els.claimBtn, false);
  }
}

/* ---------- Messages (ledger rows, click to expand) ---------- */

function padNumber(n) {
  return String(n).padStart(3, "0");
}

function formatWhen(value) {
  if (!value) return "Unknown";
  const date = new Date(typeof value === "number" ? value * 1000 : value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return date.toLocaleString(undefined, {
    month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit",
  });
}

function renderEmptyState(icon, title, body) {
  els.messageList.innerHTML = "";
  const wrapper = document.createElement("div");
  wrapper.className = "empty-state";
  const art = document.createElement("div");
  art.setAttribute("aria-hidden", "true");
  art.innerHTML = icon;
  const heading = document.createElement("h3");
  heading.textContent = title;
  const text = document.createElement("p");
  text.textContent = body;
  wrapper.append(art, heading, text);
  els.messageList.appendChild(wrapper);
}

function renderMessages() {
  els.messageList.innerHTML = "";

  if (!state.selected) {
    renderEmptyState(ICONS.inbox, "No inbox selected", "File an address to start receiving mail.");
    return;
  }

  if (!state.messages.length) {
    renderEmptyState(
      ICONS.mail,
      "Ledger is empty",
      `Mail sent to ${state.selected} will be filed here. Press Refresh to check again.`
    );
    return;
  }

  state.messages.forEach((message, index) => {
    const id = message.id || `${message.from_address}-${index}`;
    const row = document.createElement("div");
    row.className = "message-row" + (state.openMessage === id ? " is-open" : "");

    const summary = document.createElement("button");
    summary.type = "button";
    summary.className = "message-summary";
    summary.setAttribute("aria-expanded", state.openMessage === id ? "true" : "false");

    const no = document.createElement("span");
    no.className = "message-no";
    no.textContent = padNumber(index + 1);

    const from = document.createElement("span");
    from.className = "message-from";
    from.textContent = message.from_address || "Unknown sender";

    const subject = document.createElement("h3");
    subject.className = "message-subject";
    subject.textContent = message.subject || "(no subject)";

    const when = document.createElement("span");
    when.className = "message-when";
    when.textContent = formatWhen(message.received_at);

    summary.append(no, from, subject, when);
    summary.addEventListener("click", () => {
      state.openMessage = state.openMessage === id ? "" : id;
      renderMessages();
    });
    row.appendChild(summary);

    if (state.openMessage === id) {
      const body = document.createElement("div");
      body.className = "message-body";
      const text = document.createElement("p");
      text.className = "message-text";
      text.textContent = message.body || "";
      body.appendChild(text);
      if (message.id) {
        const actions = document.createElement("div");
        actions.className = "message-actions";
        const strike = document.createElement("button");
        strike.type = "button";
        strike.className = "btn btn-danger-ghost";
        strike.textContent = "Strike from ledger";
        strike.addEventListener("click", (event) => {
          event.stopPropagation();
          strikeMessage(message.id, strike);
        });
        actions.appendChild(strike);
        body.appendChild(actions);
      }
      row.appendChild(body);
    }

    els.messageList.appendChild(row);
  });
}

async function loadMessages() {
  const address = state.selected;
  if (!address) return;
  state.loadingMessages = true;
  els.messageList.setAttribute("aria-busy", "true");
  els.messageList.innerHTML = "";
  const loading = document.createElement("div");
  loading.className = "loading-row";
  const spinner = document.createElement("span");
  spinner.className = "spinner";
  spinner.setAttribute("aria-hidden", "true");
  const label = document.createElement("span");
  label.textContent = "Loading messages…";
  loading.append(spinner, label);
  els.messageList.appendChild(loading);
  setBusy(els.refreshBtn, true);

  try {
    const messages = await fetchJson(`/api/inboxes/${encodeURIComponent(address)}/messages`);
    state.messages = Array.isArray(messages) ? messages : [];
    els.currentInbox.textContent = address;
    els.messageCount.textContent = `${state.messages.length} ${state.messages.length === 1 ? "message" : "messages"}`;
    renderMessages();
  } catch (error) {
    renderEmptyState(ICONS.alert, "Could not load messages", String(error.message || error));
  } finally {
    state.loadingMessages = false;
    els.messageList.removeAttribute("aria-busy");
    setBusy(els.refreshBtn, false);
  }
}

/* ---------- Actions ---------- */

async function copySelected() {
  if (!state.selected) return;
  try {
    await navigator.clipboard.writeText(state.selected);
    showToast("Address copied to clipboard.", "success");
    flashButton(els.copyBtn, "ok");
  } catch {
    const temp = document.createElement("textarea");
    temp.value = state.selected;
    document.body.appendChild(temp);
    temp.select();
    document.execCommand("copy");
    temp.remove();
    showToast("Address copied to clipboard.", "success");
    flashButton(els.copyBtn, "ok");
  }
}

async function strikeMessage(id, button) {
  if (!window.confirm("Strike this entry from the ledger? This permanently deletes the message.")) return;
  setBusy(button, true);
  try {
    await fetchJson(`/api/messages/${encodeURIComponent(id)}`, { method: "DELETE" });
    state.messages = state.messages.filter((m) => m.id !== id);
    if (state.openMessage === id) state.openMessage = "";
    renderMessages();
    showToast("Entry struck from the ledger.", "success");
  } catch (error) {
    showToast(`Could not delete message: ${error.message || error}`, "error");
    flashButton(button, "error");
  } finally {
    setBusy(button, false);
  }
}

async function removeSelected() {
  if (!state.selected) return;
  setBusy(els.deleteBtn, true);
  try {
    await fetchJson(`/api/inboxes/${encodeURIComponent(state.selected)}`, { method: "DELETE" });
    showToast("Inbox removed from this session.", "success");
    await loadInboxes();
  } catch (error) {
    showToast(`Could not remove inbox: ${error.message || error}`, "error");
    flashButton(els.deleteBtn, "error");
  } finally {
    setBusy(els.deleteBtn, false);
  }
}

function validateLocalPart(value) {
  if (!value) return true;
  return /^[A-Za-z0-9._-]{1,64}$/.test(value);
}

async function createInbox(localPart) {
  const retentionChoice = els.retentionSelect.value === "keep" ? "keep" : Number(els.retentionSelect.value);
  const response = await fetchJson("/api/inboxes", {
    method: "POST",
    body: JSON.stringify({ localPart, domain: els.domainSelect.value || undefined, retentionDays: retentionChoice, turnstileToken: turnstileState.token || undefined }),
  });
  resetTurnstile();
  els.localPartInput.value = "";
  await loadInboxes(response.address);
  const code = response.transferCode ? ` Transfer code ${response.transferCode}.` : "";
  showToast(`Address ${response.address} is filed (kept ${retentionLabel(response.retention_days).toLowerCase()}).${code}`, "success");
}

async function handleComposerSubmit(event) {
  event.preventDefault();
  const localPart = els.localPartInput.value.trim().toLowerCase();
  if (!validateLocalPart(localPart)) {
    showToast("Use letters, numbers, dots, underscores, and hyphens only.", "error");
    flashButton(els.createBtn, "error");
    els.localPartInput.focus();
    return;
  }
  setBusy(els.createBtn, true);
  try {
    await createInbox(localPart);
    flashButton(els.createBtn, "ok");
  } catch (error) {
    resetTurnstile();
    showToast(`Could not create address: ${error.message || error}`, "error");
    flashButton(els.createBtn, "error");
  } finally {
    setBusy(els.createBtn, false);
  }
}


/* ---------- Theme: light linen default, dark plate opt-in ---------- */

const THEME_KEY = "tmail-theme";

function setTheme(dark) {
  if (dark) document.documentElement.setAttribute("data-theme", "dark");
  else document.documentElement.removeAttribute("data-theme");
  try {
    localStorage.setItem(THEME_KEY, dark ? "dark" : "light");
  } catch {
    /* private mode: theme just won't persist */
  }
  els.themeToggle.setAttribute("aria-pressed", dark ? "true" : "false");
  els.themeToggleLabel.textContent = dark ? "Light plate" : "Dark plate";
}

els.themeToggle.addEventListener("click", () => {
  setTheme(document.documentElement.getAttribute("data-theme") !== "dark");
});
setTheme(document.documentElement.getAttribute("data-theme") === "dark");

/* ---------- Events ---------- */

els.composerForm.addEventListener("submit", handleComposerSubmit);
els.claimForm.addEventListener("submit", handleClaimSubmit);
els.copyBtn.addEventListener("click", copySelected);
els.copyCodeBtn.addEventListener("click", copyTransferCode);
els.renewBtn.addEventListener("click", renewSelected);
els.planSelect.addEventListener("change", handlePlanChange);
els.refreshBtn.addEventListener("click", () => {
  if (!state.loadingMessages) loadMessages();
});
els.deleteBtn.addEventListener("click", () => {
  if (!state.selected) return;
  els.deleteDialogText.textContent =
    `Remove ${state.selected} from this session? This only unlinks the address from your browser.`;
  if (typeof els.deleteDialog.showModal === "function") {
    els.deleteDialog.showModal();
  } else if (window.confirm(`Remove ${state.selected} from this session?`)) {
    removeSelected();
  }
});
els.confirmDeleteBtn.addEventListener("click", (event) => {
  if (els.deleteDialog.returnValue === "cancel") {
    event.preventDefault();
    return;
  }
  removeSelected();
});

/* Keyboard layer: N = new entry, R = refresh. Inactive while typing. */
document.addEventListener("keydown", (event) => {
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  const target = event.target;
  if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT")) return;
  if (typeof els.deleteDialog.open !== "undefined" && els.deleteDialog.open) return;
  const key = event.key.toLowerCase();
  if (key === "n") {
    event.preventDefault();
    els.localPartInput.focus();
  } else if (key === "r" && state.selected && !state.loadingMessages) {
    event.preventDefault();
    loadMessages();
  }
});

/* Gentle auto-refresh while the tab is visible. */
window.setInterval(() => {
  if (document.visibilityState === "visible" && state.selected && !state.loadingMessages) {
    loadMessages();
  }
}, REFRESH_INTERVAL_MS);

/* ---------- Boot ---------- */

(async function init() {
  try {
    setSessionBadge("", "Connecting…");
    await loadConfig();
    await ensureSession();
    await loadInboxes();
  } catch (error) {
    console.error(error);
    setSessionBadge("error", "Connection failed");
    lockReaderButtons(true);
    renderEmptyState(ICONS.alert, "Connection error", String(error.message || error));
    showToast(`Connection failed: ${error.message || error}`, "error");
  }
})();

/* ---------- PWA: offline shell ---------- */

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((error) => {
      console.warn("Service worker registration failed:", error);
    });
  });
}
