"use strict";

/* Disposable Temp Mail — inbox client (vanilla JS, no dependencies).
 * API contract: GET /api/config, GET /api/session, GET+POST /api/inboxes,
 * DELETE /api/inboxes/:address, GET /api/inboxes/:address/messages.
 * Session is carried in the x-session-id header and localStorage.
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
  createCustomBtn: $("createCustomBtn"),
  createRandomBtn: $("createRandomBtn"),
  currentInbox: $("currentInbox"),
  messageCount: $("messageCount"),
  messageList: $("messageList"),
  copyBtn: $("copyBtn"),
  refreshBtn: $("refreshBtn"),
  deleteBtn: $("deleteBtn"),
  deleteDialog: $("deleteDialog"),
  deleteDialogText: $("deleteDialogText"),
  confirmDeleteBtn: $("confirmDeleteBtn"),
  toastContainer: $("toastContainer"),
};

const SESSION_KEY = "disposable_temp_mail_session_id";
const REFRESH_INTERVAL_MS = 30000;

const state = {
  config: { appName: "Disposable Temp Mail", mailDomain: "example.com", mailDomains: ["example.com"] },
  sessionId: localStorage.getItem(SESSION_KEY) || "",
  inboxes: [],
  selected: "",
  messages: [],
  loadingMessages: false,
};

const ICONS = {
  mail: '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>',
  inbox: '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>',
  alert: '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>',
  dot: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"/></svg>',
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
  for (const button of [els.copyBtn, els.refreshBtn, els.deleteBtn]) {
    button.dataset.locked = locked ? "true" : "false";
    button.disabled = locked;
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
  els.appSubtitle.textContent = `Anonymous disposable inboxes for ${state.config.mailDomain}`;
  els.localPartInput.placeholder = "Custom name or leave empty for random";

  els.domainSelect.innerHTML = "";
  for (const domain of state.config.mailDomains) {
    const option = document.createElement("option");
    option.value = domain;
    option.textContent = `@${domain}`;
    els.domainSelect.appendChild(option);
  }
  els.domainSelect.style.display = state.config.mailDomains.length <= 1 ? "none" : "";
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
    empty.textContent = "No inboxes yet. Create your first address above.";
    els.inboxList.appendChild(empty);
    return;
  }

  for (const inbox of state.inboxes) {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "inbox-option";
    button.setAttribute("role", "option");
    button.dataset.address = inbox.address;
    button.setAttribute("aria-selected", inbox.address === state.selected ? "true" : "false");

    const icon = document.createElement("span");
    icon.setAttribute("aria-hidden", "true");
    icon.innerHTML = ICONS.dot;
    const label = document.createElement("span");
    label.className = "address";
    label.textContent = inbox.address;

    button.append(icon, label);
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
    els.currentInbox.textContent = "No inbox selected";
    els.messageCount.textContent = "0 messages";
    lockReaderButtons(true);
    renderInboxList();
    renderMessages();
    return;
  }

  const valid = state.inboxes.some((inbox) => inbox.address === selectedAddress);
  state.selected = valid ? selectedAddress : state.inboxes[0].address;
  lockReaderButtons(false);
  renderInboxList();
  await loadMessages();
}

async function selectInbox(address) {
  if (address === state.selected) return;
  state.selected = address;
  renderInboxList();
  await loadMessages();
}

/* ---------- Messages ---------- */

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
    renderEmptyState(ICONS.inbox, "No inbox selected", "Create an address to start receiving mail.");
    return;
  }

  if (!state.messages.length) {
    renderEmptyState(
      ICONS.mail,
      "Inbox is empty",
      `Mail sent to ${state.selected} will appear here. Press Refresh to check again.`
    );
    return;
  }

  for (const message of state.messages) {
    const card = document.createElement("article");
    card.className = "message-card";

    const header = document.createElement("header");
    const subject = document.createElement("h3");
    subject.className = "message-subject";
    subject.textContent = message.subject || "(no subject)";
    const meta = document.createElement("p");
    meta.className = "message-meta";
    const when = message.received_at ? new Date(message.received_at).toLocaleString() : "unknown time";
    meta.textContent = `From ${message.from_address || "unknown sender"} · ${when}`;
    header.append(subject, meta);

    const body = document.createElement("div");
    body.className = "message-body";
    body.textContent = message.body || "";

    card.append(header, body);
    els.messageList.appendChild(card);
  }
}

async function loadMessages() {
  const address = state.selected;
  if (!address) return;
  state.loadingMessages = true;
  els.messageList.setAttribute("aria-busy", "true");
  els.messageList.innerHTML = "";
  const loading = document.createElement("div");
  loading.className = "loading-row";
  loading.innerHTML = '<span class="spinner" aria-hidden="true"></span><span>Loading messages&hellip;</span>';
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
  } catch {
    const temp = document.createElement("textarea");
    temp.value = state.selected;
    document.body.appendChild(temp);
    temp.select();
    document.execCommand("copy");
    temp.remove();
    showToast("Address copied to clipboard.", "success");
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
  } finally {
    setBusy(els.deleteBtn, false);
  }
}

function validateLocalPart(value) {
  if (!value) return true;
  return /^[A-Za-z0-9._-]{1,64}$/.test(value);
}

async function createInbox(localPart) {
  const response = await fetchJson("/api/inboxes", {
    method: "POST",
    body: JSON.stringify({ localPart, domain: els.domainSelect.value || undefined }),
  });
  els.localPartInput.value = "";
  await loadInboxes(response.address);
  showToast(`Address ${response.address} is ready.`, "success");
}

async function handleComposerSubmit(event) {
  event.preventDefault();
  const localPart = els.localPartInput.value.trim().toLowerCase();
  if (!validateLocalPart(localPart)) {
    showToast("Use letters, numbers, dots, underscores, and hyphens only.", "error");
    els.localPartInput.focus();
    return;
  }
  setBusy(els.createCustomBtn, true);
  try {
    await createInbox(localPart);
  } catch (error) {
    showToast(`Could not create address: ${error.message || error}`, "error");
  } finally {
    setBusy(els.createCustomBtn, false);
  }
}

async function handleRandomCreate() {
  setBusy(els.createRandomBtn, true);
  try {
    await createInbox("");
  } catch (error) {
    showToast(`Could not create address: ${error.message || error}`, "error");
  } finally {
    setBusy(els.createRandomBtn, false);
  }
}

/* ---------- Events ---------- */

els.composerForm.addEventListener("submit", handleComposerSubmit);
els.createRandomBtn.addEventListener("click", handleRandomCreate);
els.copyBtn.addEventListener("click", copySelected);
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
