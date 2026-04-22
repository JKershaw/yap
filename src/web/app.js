// @ts-check

/**
 * @typedef {import("../messages/messages.ts").Message} Message
 * @typedef {{ nick: string, last_seen_seconds_ago: number, inactive: boolean }} Presence
 */

const POLL_INTERVAL_MS = 2000;
const WHO_INTERVAL_MS = 10_000;

const state = {
  /** @type {string | null} */ nick: null,
  /** @type {string | null} */ channel: null,
  /** @type {string | null} */ password: null,
  /** @type {number} */ cursor: 0,
  /** @type {ReturnType<typeof setInterval> | null} */ pollTimer: null,
  /** @type {ReturnType<typeof setInterval> | null} */ whoTimer: null,
};

const el = {
  landing: /** @type {HTMLElement} */ (document.getElementById("landing")),
  chat: /** @type {HTMLElement} */ (document.getElementById("chat")),
  joinForm: /** @type {HTMLFormElement} */ (document.getElementById("join-form")),
  joinError: /** @type {HTMLElement} */ (document.getElementById("join-error")),
  channelLabel: /** @type {HTMLElement} */ (document.getElementById("chat-channel")),
  nickLabel: /** @type {HTMLElement} */ (document.getElementById("chat-nick")),
  messageList: /** @type {HTMLElement} */ (document.getElementById("message-list")),
  whoList: /** @type {HTMLElement} */ (document.getElementById("who-list")),
  sayForm: /** @type {HTMLFormElement} */ (document.getElementById("say-form")),
  sayInput: /** @type {HTMLInputElement} */ (document.getElementById("say-input")),
  sayError: /** @type {HTMLElement} */ (document.getElementById("say-error")),
  leaveBtn: /** @type {HTMLButtonElement} */ (document.getElementById("leave-btn")),
};

el.joinForm.addEventListener("submit", onJoin);
el.sayForm.addEventListener("submit", onSay);
el.leaveBtn.addEventListener("click", onLeave);

// Pre-fill nick from the cookie so a refresh doesn't kick the user out.
const savedNick = readCookie("yap_nick");
if (savedNick) {
  /** @type {HTMLInputElement} */ (el.joinForm.elements.namedItem("nick")).value = savedNick;
}

/**
 * @param {Event} e
 */
async function onJoin(e) {
  e.preventDefault();
  setError(el.joinError, null);
  const form = new FormData(el.joinForm);
  const nick = String(form.get("nick") ?? "").trim();
  const channel = String(form.get("channel") ?? "").trim();
  const password = String(form.get("password") ?? "").trim() || null;
  if (!nick || !channel) return;

  const res = await api("/api/join", { nick, channel, password: password ?? undefined });
  if (!res.ok) {
    setError(el.joinError, res.error);
    return;
  }
  state.nick = nick;
  state.channel = channel;
  state.password = password;
  state.cursor = typeof res.value.cursor === "number" ? res.value.cursor : 0;

  el.channelLabel.textContent = channel;
  el.nickLabel.textContent = nick;
  el.messageList.innerHTML = "";
  renderMessages(res.value.recent ?? [], /* markMentions= */ true);
  show("chat");
  el.sayInput.focus();
  startPolling();
  refreshWho();
}

/**
 * @param {Event} e
 */
async function onSay(e) {
  e.preventDefault();
  setError(el.sayError, null);
  if (!state.channel || !state.nick) return;
  const text = el.sayInput.value.trim();
  if (!text) return;

  /** @type {{ channel: string, nick: string, message: string, type?: "message" | "action", password?: string }} */
  const body = {
    channel: state.channel,
    nick: state.nick,
    message: text,
  };
  if (text.startsWith("/me ")) {
    body.message = text.slice(4);
    body.type = "action";
  }
  if (state.password) body.password = state.password;

  const res = await api("/api/say", body);
  if (!res.ok) {
    setError(el.sayError, res.error);
    return;
  }
  el.sayInput.value = "";
  // Let the next poll render the message to keep ordering consistent.
}

async function onLeave() {
  if (!state.channel || !state.nick) return;
  await api("/api/leave", { channel: state.channel, nick: state.nick });
  stopPolling();
  state.cursor = 0;
  state.channel = null;
  el.messageList.innerHTML = "";
  el.whoList.innerHTML = "";
  show("landing");
}

function startPolling() {
  stopPolling();
  state.pollTimer = setInterval(pollOnce, POLL_INTERVAL_MS);
  state.whoTimer = setInterval(refreshWho, WHO_INTERVAL_MS);
}

function stopPolling() {
  if (state.pollTimer) clearInterval(state.pollTimer);
  if (state.whoTimer) clearInterval(state.whoTimer);
  state.pollTimer = null;
  state.whoTimer = null;
}

async function pollOnce() {
  if (!state.channel || !state.nick) return;
  const res = await api("/api/poll", {
    channel: state.channel,
    nick: state.nick,
    since_id: state.cursor,
  });
  if (!res.ok) return;
  const messages = /** @type {Message[]} */ (res.value.messages ?? []);
  if (messages.length > 0) {
    renderMessages(messages, /* markMentions= */ true);
    state.cursor = res.value.cursor;
  }
}

async function refreshWho() {
  if (!state.channel || !state.nick) return;
  const res = await api("/api/who", { channel: state.channel, nick: state.nick });
  if (!res.ok) return;
  renderWho(/** @type {Presence[]} */ (res.value.members ?? []));
}

/**
 * @param {Message[]} messages
 * @param {boolean} markMentions
 */
function renderMessages(messages, markMentions) {
  const atBottom = isScrolledNearBottom(el.messageList);
  for (const m of messages) {
    const li = document.createElement("li");
    if (markMentions && state.nick && m.mentions && m.mentions.includes(state.nick)) {
      li.classList.add("mentioned");
    }
    const ts = document.createElement("span");
    ts.className = "ts";
    ts.textContent = formatTime(m.timestamp);
    const nick = document.createElement("span");
    nick.className = "nick";
    nick.textContent = m.type === "action" ? `* ${m.nick}` : `<${m.nick}>`;
    const msg = document.createElement("span");
    msg.className = `msg ${m.type}`;
    msg.append(...renderText(m.text));
    li.append(ts, nick, document.createTextNode(" "), msg);
    el.messageList.appendChild(li);
  }
  if (atBottom) el.messageList.scrollTop = el.messageList.scrollHeight;
}

/**
 * @param {Presence[]} members
 */
function renderWho(members) {
  el.whoList.innerHTML = "";
  const sorted = [...members].sort((a, b) => a.nick.localeCompare(b.nick));
  for (const m of sorted) {
    const li = document.createElement("li");
    li.textContent = m.nick;
    if (m.inactive) li.classList.add("inactive");
    li.title = `last seen ${m.last_seen_seconds_ago}s ago`;
    el.whoList.appendChild(li);
  }
}

/**
 * @param {string} text
 * @returns {(Text | HTMLElement)[]}
 */
function renderText(text) {
  const parts = [];
  const re = /@([\w-]+)/g;
  let last = 0;
  for (const match of text.matchAll(re)) {
    const start = match.index ?? 0;
    if (start > last) parts.push(document.createTextNode(text.slice(last, start)));
    const tag = document.createElement("span");
    tag.className = "mention";
    tag.textContent = match[0];
    parts.push(tag);
    last = start + match[0].length;
  }
  if (last < text.length) parts.push(document.createTextNode(text.slice(last)));
  return parts;
}

/**
 * @param {"landing" | "chat"} which
 */
function show(which) {
  el.landing.hidden = which !== "landing";
  el.chat.hidden = which !== "chat";
}

/**
 * @param {HTMLElement} target
 * @param {string | null} msg
 */
function setError(target, msg) {
  target.textContent = msg ?? "";
  target.hidden = !msg;
}

/**
 * @param {HTMLElement} el
 */
function isScrolledNearBottom(el) {
  return el.scrollHeight - el.scrollTop - el.clientHeight < 80;
}

/**
 * @param {number} ts
 */
function formatTime(ts) {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

/**
 * @param {string} name
 * @returns {string | null}
 */
function readCookie(name) {
  const parts = document.cookie.split(";");
  for (const p of parts) {
    const [k, ...v] = p.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}

/**
 * @param {string} path
 * @param {unknown} body
 * @returns {Promise<{ ok: true, value: any } | { ok: false, error: string }>}
 */
async function api(path, body) {
  try {
    const res = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      credentials: "same-origin",
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, error: json.error ?? `request failed (${res.status})` };
    }
    return { ok: true, value: json };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
