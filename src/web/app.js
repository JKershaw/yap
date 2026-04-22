// @ts-check

/**
 * @typedef {import("../messages/messages.ts").Message} Message
 * @typedef {{ nick: string, last_seen_seconds_ago: number, inactive: boolean }} Presence
 */

const POLL_INTERVAL_MS = 2000;
const WHO_INTERVAL_MS = 10_000;
const CACHE_LIMIT = 200;
const MAX_RECONNECT_ATTEMPTS = 6;

const state = {
  /** @type {string | null} */ nick: null,
  /** @type {string | null} */ channel: null,
  /** @type {string | null} */ password: null,
  /** @type {number} */ cursor: 0,
  /** @type {Message[]} */ messages: [],
  /** @type {"connected" | "reconnecting" | "failed"} */ connection: "connected",
  /** @type {number} */ retryAttempt: 0,
  /** @type {ReturnType<typeof setInterval> | null} */ pollTimer: null,
  /** @type {ReturnType<typeof setInterval> | null} */ whoTimer: null,
  /** @type {ReturnType<typeof setTimeout> | null} */ reconnectTimer: null,
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
  aloneHint: /** @type {HTMLElement} */ (document.getElementById("alone-hint")),
  sayForm: /** @type {HTMLFormElement} */ (document.getElementById("say-form")),
  sayInput: /** @type {HTMLTextAreaElement} */ (document.getElementById("say-input")),
  sayError: /** @type {HTMLElement} */ (document.getElementById("say-error")),
  leaveBtn: /** @type {HTMLButtonElement} */ (document.getElementById("leave-btn")),
};

const BASE_TITLE = "yap";
let unreadMentions = 0;

el.joinForm.addEventListener("submit", onJoin);
el.sayForm.addEventListener("submit", onSay);
el.leaveBtn.addEventListener("click", onLeave);
document.addEventListener("visibilitychange", onVisibilityChange);
el.sayInput.addEventListener("input", autoGrowTextarea);
el.sayInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    el.sayForm.requestSubmit();
  }
});

// Pre-fill the landing form in case auto-resume fails or isn't available.
const savedNick = readCookie("yap_nick");
if (savedNick) {
  /** @type {HTMLInputElement} */ (el.joinForm.elements.namedItem("nick")).value = savedNick;
}
/** @type {HTMLInputElement} */ (el.joinForm.elements.namedItem("channel")).value =
  channelFromUrl() ?? "#general";

// If there's a saved session, try to resume it before showing the landing.
attemptAutoResume();

/**
 * @param {Event} e
 */
async function onJoin(e) {
  e.preventDefault();
  setError(el.joinError, null);
  const form = new FormData(el.joinForm);
  const nick = String(form.get("nick") ?? "").trim();
  const rawChannel = String(form.get("channel") ?? "").trim();
  const channel = /^[#&]/.test(rawChannel) ? rawChannel : `#${rawChannel}`;
  const password = String(form.get("password") ?? "").trim() || null;
  if (!nick || !channel) return;
  await enterChannel(nick, channel, password, /* showErrorsOnLanding= */ true);
}

/**
 * Join a channel and switch the UI into chat mode. Used by both the landing
 * form and the auto-resume flow.
 * @param {string} nick
 * @param {string} channel
 * @param {string | null} password
 * @param {boolean} showErrorsOnLanding
 */
async function enterChannel(nick, channel, password, showErrorsOnLanding) {
  const res = await api("/api/join", { nick, channel, password: password ?? undefined });
  if (!res.ok) {
    if (showErrorsOnLanding) setError(el.joinError, res.error);
    return false;
  }
  state.nick = nick;
  state.channel = channel;
  state.password = password;
  state.cursor = typeof res.value.cursor === "number" ? res.value.cursor : 0;
  saveSession(channel, password);
  updateUrlHash(channel);

  // Merge any locally-cached history with the server's recent buffer so a
  // server restart doesn't visually wipe the user's view.
  const cached = loadCache(channel);
  const merged = mergeMessages(cached, res.value.recent ?? []);
  state.messages = merged;
  saveCache(channel, merged);

  el.channelLabel.textContent = channel;
  el.nickLabel.textContent = nick;
  el.messageList.innerHTML = "";
  el.aloneHint.hidden = true;
  renderMessages(merged, /* markMentions= */ true);
  show("chat");
  updateTitle();
  setConnectionState("connected");
  el.sayInput.focus();
  startPolling();
  refreshWho();
  return true;
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
  el.sayInput.style.height = "auto";
  // Let the next poll render the message to keep ordering consistent.
}

async function onLeave() {
  if (!state.channel || !state.nick) return;
  const channel = state.channel;
  await api("/api/leave", { channel, nick: state.nick });
  stopPolling();
  cancelReconnect();
  clearCache(channel);
  clearSession();
  clearUrlHash();
  state.cursor = 0;
  state.channel = null;
  state.nick = null;
  state.password = null;
  state.messages = [];
  state.retryAttempt = 0;
  setConnectionState("connected");
  unreadMentions = 0;
  el.messageList.innerHTML = "";
  el.whoList.innerHTML = "";
  el.aloneHint.hidden = true;
  updateTitle();
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
  if (state.connection === "reconnecting") return;
  const res = await api("/api/poll", {
    channel: state.channel,
    nick: state.nick,
    since_id: state.cursor,
  });
  if (!res.ok) {
    onConnectionLost();
    return;
  }
  if (state.connection !== "connected") {
    setConnectionState("connected");
    state.retryAttempt = 0;
  }
  const messages = /** @type {Message[]} */ (res.value.messages ?? []);
  if (messages.length > 0) {
    const newOnes = ingestNew(messages);
    if (newOnes.length > 0) renderMessages(newOnes, /* markMentions= */ true);
    state.cursor = res.value.cursor;
    const mentions = /** @type {Message[]} */ (res.value.mentions ?? []);
    if (document.hidden && mentions.length > 0) {
      unreadMentions += mentions.length;
      updateTitle();
    }
  }
}

async function refreshWho() {
  if (!state.channel || !state.nick) return;
  if (state.connection === "reconnecting") return;
  const res = await api("/api/who", { channel: state.channel, nick: state.nick });
  if (!res.ok) {
    // `who` returns 404 when the channel is gone (e.g. after a server restart).
    // Poll silently succeeds in that case, so `who` is the canary that lets us
    // notice and trigger a rejoin.
    onConnectionLost();
    return;
  }
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
  const activeOthers = members.filter((m) => m.nick !== state.nick && !m.inactive).length;
  el.aloneHint.hidden = activeOthers > 0;
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
 * Reads a channel name from the URL so that yap.example.com/#general or
 * /?c=general prefills the channel field. Hash wins over query string.
 * @returns {string | null}
 */
function channelFromUrl() {
  const hash = location.hash.replace(/^#+/, "");
  const fromQuery = new URLSearchParams(location.search).get("c");
  const raw = hash.length > 0 ? `#${hash}` : (fromQuery ?? "").trim();
  if (!raw) return null;
  const withPrefix = /^[#&]/.test(raw) ? raw : `#${raw}`;
  return /^[#&][\w-]{1,64}$/.test(withPrefix) ? withPrefix : null;
}

function updateTitle() {
  if (state.channel) {
    const prefix = unreadMentions > 0 ? `(${unreadMentions}) ` : "";
    document.title = `${prefix}${BASE_TITLE} — ${state.channel}`;
  } else {
    document.title = BASE_TITLE;
  }
}

function autoGrowTextarea() {
  el.sayInput.style.height = "auto";
  el.sayInput.style.height = `${el.sayInput.scrollHeight}px`;
}

function onVisibilityChange() {
  if (!document.hidden && unreadMentions > 0) {
    unreadMentions = 0;
    updateTitle();
  }
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

// ---------- Client-side persistence ----------
// Messages are cached in localStorage per channel so a reload (or a server
// restart during the session) doesn't visually wipe the user's history.
// The server remains the source of truth; this is a UX convenience only.

/** @param {string} channel */
function cacheKey(channel) {
  return `yap_cache:${channel}`;
}

/**
 * @param {string} channel
 * @returns {Message[]}
 */
function loadCache(channel) {
  try {
    const raw = localStorage.getItem(cacheKey(channel));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * @param {string} channel
 * @param {Message[]} messages
 */
function saveCache(channel, messages) {
  try {
    const trimmed = messages.slice(-CACHE_LIMIT);
    localStorage.setItem(cacheKey(channel), JSON.stringify(trimmed));
  } catch {
    // localStorage full or disabled — nothing to do.
  }
}

/** @param {string} channel */
function clearCache(channel) {
  try { localStorage.removeItem(cacheKey(channel)); } catch {}
}

/**
 * @param {string} channel
 * @param {string | null} password
 */
function saveSession(channel, password) {
  try {
    sessionStorage.setItem(
      "yap_session",
      JSON.stringify({ channel, password: password ?? null }),
    );
  } catch {}
}

/** @returns {{ channel: string, password: string | null } | null} */
function loadSession() {
  try {
    const raw = sessionStorage.getItem("yap_session");
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.channel !== "string") return null;
    return { channel: parsed.channel, password: parsed.password ?? null };
  } catch {
    return null;
  }
}

function clearSession() {
  try { sessionStorage.removeItem("yap_session"); } catch {}
}

/** @param {string} channel */
function updateUrlHash(channel) {
  const name = channel.replace(/^[#&]/, "");
  const next = `#${name}`;
  if (location.hash !== next) {
    history.replaceState(null, "", location.pathname + location.search + next);
  }
}

function clearUrlHash() {
  if (location.hash) {
    history.replaceState(null, "", location.pathname + location.search);
  }
}

/** @param {Message} m */
function msgKey(m) {
  // (id, timestamp) survives server restart — after a restart, the same id
  // can be reused but the timestamp will be different, so we keep both
  // messages rather than dropping one as a duplicate.
  return `${m.id}:${m.timestamp}`;
}

/**
 * Dedupe by (id, timestamp), sort by timestamp, keep the last CACHE_LIMIT.
 * @param {Message[]} existing
 * @param {Message[]} incoming
 * @returns {Message[]}
 */
function mergeMessages(existing, incoming) {
  const seen = new Set();
  /** @type {Message[]} */ const out = [];
  for (const m of existing) {
    const k = msgKey(m);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(m);
  }
  for (const m of incoming) {
    const k = msgKey(m);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(m);
  }
  out.sort((a, b) => a.timestamp - b.timestamp);
  return out.slice(-CACHE_LIMIT);
}

/**
 * Adds any genuinely-new messages to the in-memory list and persists the
 * updated cache. Returns just the new ones so the caller can render them.
 * @param {Message[]} msgs
 * @returns {Message[]}
 */
function ingestNew(msgs) {
  if (!msgs || msgs.length === 0) return [];
  const known = new Set(state.messages.map(msgKey));
  const newOnes = msgs.filter((m) => !known.has(msgKey(m)));
  if (newOnes.length === 0) return [];
  state.messages = mergeMessages(state.messages, newOnes);
  if (state.channel) saveCache(state.channel, state.messages);
  return newOnes;
}

// ---------- Connection state / reconnect ----------

/** @param {"connected" | "reconnecting" | "failed"} s */
function setConnectionState(s) {
  state.connection = s;
  el.nickLabel.dataset.conn = s;
}

function onConnectionLost() {
  if (state.connection === "reconnecting" || state.connection === "failed") return;
  setConnectionState("reconnecting");
  scheduleReconnect();
}

function scheduleReconnect() {
  cancelReconnect();
  const delayMs = Math.min(2000 * Math.pow(2, state.retryAttempt), 15000);
  state.retryAttempt++;
  state.reconnectTimer = setTimeout(attemptReconnect, delayMs);
}

function cancelReconnect() {
  if (state.reconnectTimer) {
    clearTimeout(state.reconnectTimer);
    state.reconnectTimer = null;
  }
}

async function attemptReconnect() {
  state.reconnectTimer = null;
  if (!state.channel || !state.nick) return;
  const res = await api("/api/join", {
    channel: state.channel,
    nick: state.nick,
    password: state.password ?? undefined,
  });
  if (!res.ok) {
    if (state.retryAttempt >= MAX_RECONNECT_ATTEMPTS) {
      setConnectionState("failed");
      return;
    }
    scheduleReconnect();
    return;
  }
  state.retryAttempt = 0;
  state.cursor = typeof res.value.cursor === "number" ? res.value.cursor : 0;
  const recent = /** @type {Message[]} */ (res.value.recent ?? []);
  const newOnes = ingestNew(recent);
  if (newOnes.length > 0) renderMessages(newOnes, /* markMentions= */ true);
  setConnectionState("connected");
  // Covers the case where auto-resume failed its first join and we got here
  // via the backoff loop without ever starting the poll intervals.
  if (!state.pollTimer) {
    startPolling();
    refreshWho();
  }
}

// ---------- Auto-resume on page load ----------

async function attemptAutoResume() {
  const nick = readCookie("yap_nick");
  const session = loadSession();
  if (!nick || !session) return;

  state.nick = nick;
  state.channel = session.channel;
  state.password = session.password;

  // Render cached messages immediately so the UI feels instant, even before
  // the silent rejoin completes.
  const cached = loadCache(session.channel);
  state.messages = cached;
  el.channelLabel.textContent = session.channel;
  el.nickLabel.textContent = nick;
  el.messageList.innerHTML = "";
  if (cached.length > 0) renderMessages(cached, /* markMentions= */ true);
  show("chat");
  updateTitle();
  setConnectionState("reconnecting");
  updateUrlHash(session.channel);

  const res = await api("/api/join", {
    nick,
    channel: session.channel,
    password: session.password ?? undefined,
  });
  if (!res.ok) {
    if (cached.length === 0) {
      // Nothing cached and the server won't let us in — fall back to landing
      // so the user can correct the password or pick a new channel.
      clearSession();
      state.nick = null;
      state.channel = null;
      state.password = null;
      setConnectionState("connected");
      show("landing");
      setError(el.joinError, res.error);
      return;
    }
    // Keep showing cached history while we back off and retry.
    scheduleReconnect();
    return;
  }
  state.cursor = typeof res.value.cursor === "number" ? res.value.cursor : 0;
  const recent = /** @type {Message[]} */ (res.value.recent ?? []);
  const newOnes = ingestNew(recent);
  if (newOnes.length > 0) renderMessages(newOnes, /* markMentions= */ true);
  setConnectionState("connected");
  el.sayInput.focus();
  startPolling();
  refreshWho();
}
