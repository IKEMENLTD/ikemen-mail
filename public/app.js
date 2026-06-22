import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/* =========================================================================
   Ikemen Mail — frontend
   - Supabase Auth (email/password)
   - Folders: inbox / sent / drafts (client-side via supabase-js, RLS-filtered)
   - Compose: send via /.netlify/functions/send-mail (Bearer access_token)
   ========================================================================= */

/* ---------- Supabase client init ---------- */
const cfg = window.SUPABASE_CONFIG || {};
if (!cfg.url || !cfg.anonKey) {
  alert("設定エラー: config.js が読み込まれていません。");
  throw new Error("Missing SUPABASE_CONFIG");
}
const supabase = createClient(cfg.url, cfg.anonKey);

/* ---------- DOM helpers ---------- */
const $ = (id) => document.getElementById(id);

const FOLDER_LABELS = { inbox: "受信箱", sent: "送信済", drafts: "下書き" };
const EMPTY_TEXT = {
  inbox: "受信箱は空です",
  sent: "送信済みのメッセージはありません",
  drafts: "下書きはありません",
};
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/* ---------- App state ---------- */
const state = {
  session: null,
  user: null,
  folder: "inbox",
  messages: [],
  selectedId: null,
  unread: 0,
  loadToken: 0, // guards against out-of-order async list loads
};

/* ---------- Utilities ---------- */
function fmtDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleString("ja-JP");
}

function previewText(body) {
  if (!body) return "";
  return body.replace(/\s+/g, " ").trim().slice(0, 120);
}

let toastTimer = null;
function toast(msg, type = "") {
  const el = $("toast");
  el.textContent = msg;
  el.className = "toast show" + (type ? " " + type : "");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.className = "toast";
  }, 3200);
}

function showAuthMessage(text, type) {
  const el = $("auth-message");
  el.textContent = text || "";
  el.className = "auth-message" + (text ? " show " + type : "");
}

function showComposeMessage(text, type) {
  const el = $("compose-message");
  el.textContent = text || "";
  el.className = "auth-message" + (text ? " show " + type : "");
}

/* =========================================================================
   AUTH
   ========================================================================= */
let authMode = "login"; // 'login' | 'signup'

function setAuthMode(mode) {
  authMode = mode;
  showAuthMessage("", "");
  if (mode === "login") {
    $("auth-sub").textContent = "アカウントにログイン";
    $("auth-submit").textContent = "ログイン";
    $("auth-toggle-text").textContent = "アカウントをお持ちでない方は";
    $("auth-toggle-link").textContent = "新規登録";
    $("auth-password").setAttribute("autocomplete", "current-password");
  } else {
    $("auth-sub").textContent = "新規アカウント登録";
    $("auth-submit").textContent = "新規登録";
    $("auth-toggle-text").textContent = "既にアカウントをお持ちの方は";
    $("auth-toggle-link").textContent = "ログイン";
    $("auth-password").setAttribute("autocomplete", "new-password");
  }
}

$("auth-toggle-link").addEventListener("click", (e) => {
  e.preventDefault();
  setAuthMode(authMode === "login" ? "signup" : "login");
});

$("auth-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = $("auth-email").value.trim();
  const password = $("auth-password").value;
  if (!email || !password) return;

  const btn = $("auth-submit");
  btn.disabled = true;
  showAuthMessage("", "");

  try {
    if (authMode === "login") {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        showAuthMessage("ログインに失敗しました: " + translateAuthError(error.message), "error");
      }
      // success → onAuthStateChange handles the rest
    } else {
      const { data, error } = await supabase.auth.signUp({ email, password });
      if (error) {
        showAuthMessage("登録に失敗しました: " + translateAuthError(error.message), "error");
      } else if (data.session) {
        // Auto-confirmed & signed in → onAuthStateChange takes over.
        showAuthMessage("登録が完了しました。", "success");
      } else {
        // Needs email confirmation.
        showAuthMessage("確認メールを送信しました。メールをご確認ください。", "success");
        setAuthMode("login");
      }
    }
  } catch (err) {
    showAuthMessage("通信エラーが発生しました。", "error");
  } finally {
    btn.disabled = false;
  }
});

function translateAuthError(msg) {
  if (!msg) return "不明なエラー";
  const m = msg.toLowerCase();
  if (m.includes("invalid login")) return "メールアドレスまたはパスワードが正しくありません";
  if (m.includes("already registered") || m.includes("already been registered"))
    return "このメールアドレスは既に登録されています";
  if (m.includes("password")) return "パスワードは6文字以上にしてください";
  if (m.includes("email")) return "有効なメールアドレスを入力してください";
  return msg;
}

$("logout-btn").addEventListener("click", async () => {
  await supabase.auth.signOut();
});

/* =========================================================================
   VIEW SWITCHING
   ========================================================================= */
function showSplash(show) {
  $("splash").classList.toggle("hidden", !show);
}

function renderForSession(session) {
  state.session = session;
  state.user = session ? session.user : null;

  if (session) {
    $("auth-view").classList.add("hidden");
    $("app-view").classList.remove("hidden");
    $("user-email").textContent = session.user.email || "";
    $("user-email").title = session.user.email || "";
    setActiveFolder(state.folder, true);
  } else {
    $("app-view").classList.remove("sidebar-open", "detail-open");
    $("app-view").classList.add("hidden");
    $("auth-view").classList.remove("hidden");
    $("auth-email").value = "";
    $("auth-password").value = "";
    state.messages = [];
    state.selectedId = null;
  }
}

/* =========================================================================
   FOLDER NAVIGATION & LIST
   ========================================================================= */
document.querySelectorAll(".nav-item").forEach((btn) => {
  btn.addEventListener("click", () => {
    setActiveFolder(btn.dataset.folder);
    closeSidebar();
  });
});

$("refresh-btn").addEventListener("click", () => loadFolder(state.folder));

function setActiveFolder(folder, force) {
  if (!force && folder === state.folder && state.messages.length) {
    // still refresh, but keep instant feel
  }
  state.folder = folder;
  document.querySelectorAll(".nav-item").forEach((b) => {
    b.classList.toggle("active", b.dataset.folder === folder);
  });
  $("list-title").textContent = FOLDER_LABELS[folder] || "";
  clearDetail();
  loadFolder(folder);
}

async function loadFolder(folder) {
  const token = ++state.loadToken;
  const listEl = $("message-list");
  listEl.innerHTML = "";
  const loading = document.createElement("div");
  loading.className = "empty-state";
  loading.textContent = "読み込み中...";
  listEl.appendChild(loading);

  const { data, error } = await supabase
    .from("messages")
    .select("*")
    .eq("folder", folder)
    .order("created_at", { ascending: false });

  if (token !== state.loadToken) return; // a newer load superseded this one

  if (error) {
    listEl.innerHTML = "";
    const errEl = document.createElement("div");
    errEl.className = "empty-state";
    errEl.textContent = "読み込みに失敗しました";
    listEl.appendChild(errEl);
    toast("読み込みに失敗しました", "error");
    return;
  }

  state.messages = data || [];
  renderList();
  if (folder === "inbox") updateUnreadFromList();
}

function renderList() {
  const listEl = $("message-list");
  listEl.innerHTML = "";

  if (!state.messages.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = EMPTY_TEXT[state.folder] || "メッセージはありません";
    listEl.appendChild(empty);
    return;
  }

  const isInbox = state.folder === "inbox";
  for (const msg of state.messages) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "msg-row";
    if (isInbox && !msg.read) row.classList.add("unread");
    if (msg.id === state.selectedId) row.classList.add("selected");
    row.dataset.id = msg.id;

    const addr = isInbox ? msg.from_email : msg.to_email;

    const top = document.createElement("div");
    top.className = "msg-row-top";
    const addrEl = document.createElement("span");
    addrEl.className = "msg-addr";
    addrEl.textContent = addr || "(不明)";
    const dateEl = document.createElement("span");
    dateEl.className = "msg-date";
    dateEl.textContent = fmtDate(msg.created_at);
    top.appendChild(addrEl);
    top.appendChild(dateEl);

    const subjEl = document.createElement("div");
    subjEl.className = "msg-subject";
    subjEl.textContent = msg.subject || "(件名なし)";

    const prevEl = document.createElement("div");
    prevEl.className = "msg-preview";
    prevEl.textContent = previewText(msg.body) || "(本文なし)";

    row.appendChild(top);
    row.appendChild(subjEl);
    row.appendChild(prevEl);

    row.addEventListener("click", () => onSelectMessage(msg.id));
    listEl.appendChild(row);
  }
}

function updateUnreadFromList() {
  // Only accurate when the inbox list is currently loaded.
  state.unread = state.messages.filter((m) => !m.read).length;
  applyUnreadBadge();
}

async function refreshUnreadBadge() {
  // Authoritative count via head query (works regardless of active folder).
  const { count, error } = await supabase
    .from("messages")
    .select("id", { count: "exact", head: true })
    .eq("folder", "inbox")
    .eq("read", false);
  if (!error && typeof count === "number") {
    state.unread = count;
    applyUnreadBadge();
  }
}

function applyUnreadBadge() {
  const badge = $("unread-badge");
  if (state.unread > 0) {
    badge.textContent = state.unread > 99 ? "99+" : String(state.unread);
    badge.classList.remove("hidden");
  } else {
    badge.classList.add("hidden");
  }
}

/* =========================================================================
   DETAIL / READING PANE
   ========================================================================= */
function clearDetail() {
  state.selectedId = null;
  $("detail-title").textContent = "メッセージ";
  $("delete-btn").classList.add("hidden");
  const body = $("detail-body");
  body.innerHTML = "";
  const empty = document.createElement("div");
  empty.className = "empty-state";
  empty.textContent = "メッセージを選択してください";
  body.appendChild(empty);
  $("app-view").classList.remove("detail-open");
}

async function onSelectMessage(id) {
  const msg = state.messages.find((m) => m.id === id);
  if (!msg) return;

  // Drafts open in the compose editor instead of a reading pane.
  if (state.folder === "drafts") {
    openCompose(msg);
    return;
  }

  state.selectedId = id;
  renderList(); // update .selected highlight
  renderDetail(msg);
  openDetailMobile();

  // Mark unread inbox messages as read.
  if (state.folder === "inbox" && !msg.read) {
    const { error } = await supabase.from("messages").update({ read: true }).eq("id", id);
    if (!error) {
      msg.read = true;
      renderList();
      refreshUnreadBadge();
    }
  }
}

function renderDetail(msg) {
  $("detail-title").textContent = msg.subject || "(件名なし)";
  $("delete-btn").classList.remove("hidden");

  const body = $("detail-body");
  body.innerHTML = "";

  const card = document.createElement("div");
  card.className = "detail-card";

  const subj = document.createElement("h1");
  subj.className = "detail-subject";
  subj.textContent = msg.subject || "(件名なし)";
  card.appendChild(subj);

  const meta = document.createElement("div");
  meta.className = "detail-meta";
  meta.appendChild(metaRow("差出人", msg.from_email || "(不明)"));
  meta.appendChild(metaRow("宛先", msg.to_email || "(不明)"));
  meta.appendChild(metaRow("日時", fmtDate(msg.created_at)));
  if (msg.status) meta.appendChild(metaRow("状態", String(msg.status)));
  card.appendChild(meta);

  const text = document.createElement("div");
  text.className = "detail-text";
  text.textContent = msg.body || "(本文なし)";
  card.appendChild(text);

  body.appendChild(card);
}

function metaRow(label, value) {
  const row = document.createElement("div");
  const l = document.createElement("span");
  l.className = "label";
  l.textContent = label;
  const v = document.createElement("span");
  v.className = "val";
  v.textContent = value;
  row.appendChild(l);
  row.appendChild(v);
  return row;
}

$("delete-btn").addEventListener("click", async () => {
  if (!state.selectedId) return;
  if (!confirm("このメッセージを削除しますか?")) return;
  const id = state.selectedId;
  const { error } = await supabase.from("messages").delete().eq("id", id);
  if (error) {
    toast("削除に失敗しました", "error");
    return;
  }
  state.messages = state.messages.filter((m) => m.id !== id);
  clearDetail();
  renderList();
  if (state.folder === "inbox") updateUnreadFromList();
  toast("削除しました", "success");
});

/* =========================================================================
   COMPOSE
   ========================================================================= */
function openCompose(draft) {
  showComposeMessage("", "");
  $("compose-draft-id").value = draft && draft.id ? draft.id : "";
  $("compose-to").value = draft ? draft.to_email || "" : "";
  $("compose-subject").value = draft ? draft.subject || "" : "";
  $("compose-body").value = draft ? draft.body || "" : "";
  $("compose-title").textContent = draft ? "下書きを編集" : "新規メッセージ";
  $("compose-overlay").classList.remove("hidden");
  $("compose-to").focus();
}

function closeCompose() {
  $("compose-overlay").classList.add("hidden");
  $("compose-form").reset();
  $("compose-draft-id").value = "";
  showComposeMessage("", "");
}

$("compose-btn").addEventListener("click", () => {
  openCompose(null);
  closeSidebar();
});
$("compose-close").addEventListener("click", closeCompose);
$("compose-overlay").addEventListener("click", (e) => {
  if (e.target === $("compose-overlay")) closeCompose();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !$("compose-overlay").classList.contains("hidden")) closeCompose();
});

/* Send */
$("compose-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const to = $("compose-to").value.trim();
  const subject = $("compose-subject").value.trim();
  const body = $("compose-body").value;
  const draftId = $("compose-draft-id").value || null;

  if (!EMAIL_RE.test(to)) {
    showComposeMessage("有効な宛先メールアドレスを入力してください。", "error");
    return;
  }
  if (!subject) {
    showComposeMessage("件名を入力してください。", "error");
    return;
  }
  if (!body.trim()) {
    showComposeMessage("本文を入力してください。", "error");
    return;
  }

  const sendBtn = $("send-btn");
  const draftBtn = $("save-draft-btn");
  sendBtn.disabled = true;
  draftBtn.disabled = true;
  showComposeMessage("送信中...", "success");

  try {
    // Get a fresh access token.
    const { data: sess } = await supabase.auth.getSession();
    const token = sess && sess.session ? sess.session.access_token : null;
    if (!token) {
      showComposeMessage("セッションが無効です。再ログインしてください。", "error");
      return;
    }

    const res = await fetch("/.netlify/functions/send-mail", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token,
      },
      body: JSON.stringify({ to, subject, body }),
    });

    let payload = {};
    try {
      payload = await res.json();
    } catch (_) {
      /* ignore parse errors */
    }

    if (!res.ok || !payload.ok) {
      showComposeMessage("送信に失敗しました: " + (payload.error || res.status), "error");
      return;
    }

    // If we were editing a draft, delete that draft row.
    if (draftId) {
      await supabase.from("messages").delete().eq("id", draftId);
    }

    closeCompose();
    toast("メッセージを送信しました", "success");

    // Refresh sent folder.
    setActiveFolder("sent", true);
  } catch (err) {
    showComposeMessage("通信エラーが発生しました。", "error");
  } finally {
    sendBtn.disabled = false;
    draftBtn.disabled = false;
  }
});

/* Save draft */
$("save-draft-btn").addEventListener("click", async () => {
  const to = $("compose-to").value.trim();
  const subject = $("compose-subject").value.trim();
  const body = $("compose-body").value;
  const draftId = $("compose-draft-id").value || null;

  if (!to && !subject && !body.trim()) {
    showComposeMessage("保存する内容がありません。", "error");
    return;
  }

  const sendBtn = $("send-btn");
  const draftBtn = $("save-draft-btn");
  sendBtn.disabled = true;
  draftBtn.disabled = true;

  try {
    const userEmail = state.user ? state.user.email : null;
    const userId = state.user ? state.user.id : null;

    if (draftId) {
      // Update existing draft.
      const { error } = await supabase
        .from("messages")
        .update({ to_email: to, subject, body })
        .eq("id", draftId);
      if (error) {
        showComposeMessage("下書きの保存に失敗しました。", "error");
        return;
      }
    } else {
      // Insert new draft. MUST set user_id to logged-in user (RLS).
      const { error } = await supabase.from("messages").insert({
        user_id: userId,
        folder: "drafts",
        to_email: to,
        subject,
        body,
        status: "draft",
        from_email: userEmail,
        read: true,
      });
      if (error) {
        showComposeMessage("下書きの保存に失敗しました。", "error");
        return;
      }
    }

    closeCompose();
    toast("下書きを保存しました", "success");
    setActiveFolder("drafts", true);
  } catch (err) {
    showComposeMessage("通信エラーが発生しました。", "error");
  } finally {
    sendBtn.disabled = false;
    draftBtn.disabled = false;
  }
});

/* =========================================================================
   MOBILE NAV (sidebar + detail)
   ========================================================================= */
function openSidebar() {
  $("app-view").classList.add("sidebar-open");
  $("sidebar-backdrop").classList.remove("hidden");
}
function closeSidebar() {
  $("app-view").classList.remove("sidebar-open");
  $("sidebar-backdrop").classList.add("hidden");
}
$("sidebar-toggle").addEventListener("click", openSidebar);
$("sidebar-backdrop").addEventListener("click", closeSidebar);

function openDetailMobile() {
  $("app-view").classList.add("detail-open");
}
$("detail-back").addEventListener("click", () => {
  $("app-view").classList.remove("detail-open");
  state.selectedId = null;
  renderList();
});

/* =========================================================================
   SESSION BOOTSTRAP
   ========================================================================= */
setAuthMode("login");

let bootstrapped = false;
supabase.auth.onAuthStateChange((_event, session) => {
  renderForSession(session);
  if (session) refreshUnreadBadge();
  if (!bootstrapped) {
    bootstrapped = true;
    showSplash(false);
  }
});

// Initial session check (in case onAuthStateChange is slow to fire).
(async () => {
  const { data } = await supabase.auth.getSession();
  if (!bootstrapped) {
    bootstrapped = true;
    renderForSession(data.session || null);
    if (data.session) refreshUnreadBadge();
    showSplash(false);
  }
})();
