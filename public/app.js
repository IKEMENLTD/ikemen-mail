/* ===========================================================
   Standard Mailer — frontend application
   Vanilla JS, no frameworks, no external deps.
   =========================================================== */
(function () {
  "use strict";

  // ---------------------------------------------------------
  // Constants & config
  // ---------------------------------------------------------
  var API_BASE = "/.netlify/functions";
  var TOKEN_KEY = "sm_token";
  var AUTO_REFRESH_MS = 60000;   // inbox auto-refresh interval
  var AUTOSAVE_MS = 1500;        // compose draft autosave debounce

  var FOLDERS = {
    inbox:  { label: "受信箱", empty: "受信箱にメールはありません" },
    sent:   { label: "送信済", empty: "送信済みのメールはありません" },
    drafts: { label: "下書き", empty: "下書きはありません" }
  };

  // ---------------------------------------------------------
  // Application state
  // ---------------------------------------------------------
  var state = {
    folder: "inbox",
    cache: { inbox: null, sent: null, drafts: null }, // arrays or null (not loaded)
    loading: { inbox: false, sent: false, drafts: false },
    errored: { inbox: false, sent: false, drafts: false },
    selectedId: null,
    search: "",
    compose: {
      open: false,
      draftId: null,
      sending: false,
      autosaveTimer: null,
      lastSaved: ""
    },
    confirmCallback: null,
    autoRefreshTimer: null
  };

  // ---------------------------------------------------------
  // Tiny DOM helpers
  // ---------------------------------------------------------
  function $(id) { return document.getElementById(id); }
  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }
  function show(node) { if (node) node.hidden = false; }
  function hide(node) { if (node) node.hidden = true; }

  // ---------------------------------------------------------
  // Token storage
  // ---------------------------------------------------------
  function getToken() {
    try { return localStorage.getItem(TOKEN_KEY); } catch (e) { return null; }
  }
  function setToken(t) {
    try { localStorage.setItem(TOKEN_KEY, t); } catch (e) {}
  }
  function clearToken() {
    try { localStorage.removeItem(TOKEN_KEY); } catch (e) {}
  }

  // ---------------------------------------------------------
  // API helper — adds Bearer header, parses JSON, handles 401
  // ---------------------------------------------------------
  function api(path, options) {
    options = options || {};
    var headers = { "Content-Type": "application/json" };
    if (!options.noAuth) {
      var token = getToken();
      if (token) headers["Authorization"] = "Bearer " + token;
    }
    var init = { method: options.method || "GET", headers: headers };
    if (options.body !== undefined) init.body = JSON.stringify(options.body);

    return fetch(API_BASE + path, init).then(function (res) {
      if (res.status === 401 && !options.noAuth) {
        handleUnauthorized();
        var err = new Error("unauthorized");
        err.isUnauthorized = true;
        throw err;
      }
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok || (data && data.ok === false)) {
          var msg = (data && data.error) || ("エラーが発生しました (" + res.status + ")");
          var e = new Error(msg);
          e.data = data;
          throw e;
        }
        return data;
      });
    });
  }

  function handleUnauthorized() {
    clearToken();
    stopAutoRefresh();
    showLogin();
    showLoginError("セッションの有効期限が切れました。再度ログインしてください。");
  }

  // ---------------------------------------------------------
  // Utilities
  // ---------------------------------------------------------
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  function isValidEmail(v) { return EMAIL_RE.test((v || "").trim()); }

  function truncate(s, n) {
    s = (s || "").replace(/\s+/g, " ").trim();
    return s.length > n ? s.slice(0, n) + "…" : s;
  }

  function fullDate(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    return d.toLocaleString("ja-JP");
  }

  function relativeDate(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    var now = new Date();
    var diff = now - d;
    var min = 60000, hour = 3600000, day = 86400000;
    if (diff >= 0 && diff < min) return "たった今";
    if (diff >= 0 && diff < hour) return Math.floor(diff / min) + "分前";
    var sameDay = d.toDateString() === now.toDateString();
    if (sameDay) {
      return d.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
    }
    var yesterday = new Date(now.getTime() - day);
    if (d.toDateString() === yesterday.toDateString()) return "昨日";
    if (diff >= 0 && diff < 7 * day) return Math.floor(diff / day) + "日前";
    if (d.getFullYear() === now.getFullYear()) {
      return d.toLocaleDateString("ja-JP", { month: "numeric", day: "numeric" });
    }
    return d.toLocaleDateString("ja-JP", { year: "numeric", month: "numeric", day: "numeric" });
  }

  // ---------------------------------------------------------
  // Toasts
  // ---------------------------------------------------------
  function toast(message, kind) {
    var stack = $("toast-stack");
    var t = el("div", "toast" + (kind === "error" ? " is-error" : ""));
    t.appendChild(el("span", null, message));
    stack.appendChild(t);
    var timeout = setTimeout(dismiss, kind === "error" ? 5000 : 3000);
    function dismiss() {
      clearTimeout(timeout);
      t.classList.add("is-leaving");
      setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 220);
    }
    t.addEventListener("click", dismiss);
  }

  // ---------------------------------------------------------
  // Confirm dialog
  // ---------------------------------------------------------
  function openConfirm(message, onOk) {
    $("confirm-msg").textContent = message;
    state.confirmCallback = onOk;
    show($("confirm-overlay"));
    $("confirm-ok").focus();
  }
  function closeConfirm() {
    hide($("confirm-overlay"));
    state.confirmCallback = null;
  }

  // ===========================================================
  // LOGIN
  // ===========================================================
  function showLogin() {
    hide($("app-view"));
    show($("login-view"));
    var pw = $("login-password");
    pw.value = "";
    pw.focus();
  }
  function showApp() {
    hide($("login-view"));
    show($("app-view"));
  }
  function showLoginError(msg) {
    var box = $("login-error");
    box.textContent = msg;
    show(box);
  }
  function clearLoginError() { hide($("login-error")); }

  function handleLogin(e) {
    e.preventDefault();
    clearLoginError();
    var pw = $("login-password").value;
    if (!pw) { showLoginError("パスワードを入力してください"); return; }

    var btn = $("login-submit");
    btn.disabled = true;
    btn.textContent = "ログイン中...";

    api("/login", { method: "POST", noAuth: true, body: { password: pw } })
      .then(function (data) {
        if (data && data.token) {
          setToken(data.token);
          enterApp();
        } else {
          showLoginError("ログインに失敗しました");
        }
      })
      .catch(function (err) {
        var msg = (err && err.data && err.data.error) ? err.data.error : "パスワードが違います";
        showLoginError(msg);
      })
      .then(function () {
        btn.disabled = false;
        btn.textContent = "ログイン";
      });
  }

  function togglePassword() {
    var pw = $("login-password");
    var btn = $("login-toggle");
    if (pw.type === "password") {
      pw.type = "text";
      btn.textContent = "隠す";
      btn.setAttribute("aria-label", "パスワードを隠す");
    } else {
      pw.type = "password";
      btn.textContent = "表示";
      btn.setAttribute("aria-label", "パスワードを表示");
    }
    pw.focus();
  }

  function logout() {
    clearToken();
    stopAutoRefresh();
    state.cache = { inbox: null, sent: null, drafts: null };
    state.selectedId = null;
    showLogin();
  }

  // ===========================================================
  // FOLDER LOADING
  // ===========================================================
  function loadFolder(folder, opts) {
    opts = opts || {};
    state.loading[folder] = true;
    state.errored[folder] = false;
    if (folder === state.folder && !opts.silent) renderList();

    return api("/list-messages?folder=" + encodeURIComponent(folder))
      .then(function (data) {
        var msgs = (data && data.messages) || [];
        msgs.sort(function (a, b) {
          return new Date(b.created_at) - new Date(a.created_at);
        });
        state.cache[folder] = msgs;
        state.loading[folder] = false;
        state.errored[folder] = false;
        updateBadges();
        if (folder === state.folder) renderList();
      })
      .catch(function (err) {
        state.loading[folder] = false;
        if (err && err.isUnauthorized) return;
        state.errored[folder] = true;
        if (folder === state.folder) renderList();
        if (!opts.silent) toast("読み込みに失敗しました", "error");
      });
  }

  function refreshAll() {
    loadFolder("inbox", { silent: state.folder !== "inbox" });
    loadFolder("sent", { silent: state.folder !== "sent" });
    loadFolder("drafts", { silent: state.folder !== "drafts" });
  }

  function updateBadges() {
    setBadge("badge-inbox", unreadCount());
    setBadge("badge-sent", count("sent"));
    setBadge("badge-drafts", count("drafts"));
  }
  function count(folder) {
    var c = state.cache[folder];
    return c ? c.length : 0;
  }
  function unreadCount() {
    var c = state.cache.inbox;
    if (!c) return 0;
    return c.filter(function (m) { return !m.read; }).length;
  }
  function setBadge(id, n) {
    var b = $(id);
    if (!b) return;
    if (n > 0) { b.textContent = n > 99 ? "99+" : String(n); show(b); }
    else { hide(b); }
  }

  // ===========================================================
  // MESSAGE LIST RENDERING
  // ===========================================================
  function addressFor(m) {
    return state.folder === "inbox" ? (m.from_email || "(差出人なし)") : (m.to_email || "(宛先なし)");
  }

  function filteredMessages() {
    var msgs = state.cache[state.folder] || [];
    var q = state.search.trim().toLowerCase();
    if (!q) return msgs;
    return msgs.filter(function (m) {
      return [m.from_email, m.to_email, m.subject, m.body]
        .map(function (x) { return (x || "").toLowerCase(); })
        .some(function (x) { return x.indexOf(q) !== -1; });
    });
  }

  function renderList() {
    var container = $("message-list");
    container.textContent = "";
    var folder = state.folder;

    // Loading state (only when nothing cached yet)
    if (state.loading[folder] && state.cache[folder] === null) {
      container.appendChild(buildState(true, "読み込み中...", null, null));
      return;
    }
    // Error state
    if (state.errored[folder] && state.cache[folder] === null) {
      container.appendChild(buildState(false, "読み込みに失敗しました",
        "ネットワークまたはサーバーのエラーです。", "再試行"));
      return;
    }

    var msgs = filteredMessages();
    if (msgs.length === 0) {
      var title, sub;
      if (state.search.trim()) {
        title = "該当するメールがありません";
        sub = "検索条件を変更してください。";
      } else {
        title = FOLDERS[folder].empty;
        sub = null;
      }
      container.appendChild(buildState(false, title, sub, null));
      return;
    }

    msgs.forEach(function (m) {
      container.appendChild(buildRow(m));
    });
  }

  function buildState(loading, title, sub, action) {
    var box = el("div", "list-state");
    if (loading) box.appendChild(el("div", "spinner"));
    box.appendChild(el("p", "state-title", title));
    if (sub) box.appendChild(el("p", null, sub));
    if (action) {
      var btn = el("button", "btn btn-soft", action);
      btn.type = "button";
      btn.addEventListener("click", function () { loadFolder(state.folder); });
      box.appendChild(btn);
    }
    return box;
  }

  function buildRow(m) {
    var unread = state.folder === "inbox" && !m.read;
    var row = el("button", "msg-row" + (unread ? " is-unread" : "") +
      (m.id === state.selectedId ? " is-selected" : ""));
    row.type = "button";
    row.setAttribute("role", "listitem");
    row.dataset.id = m.id;

    var top = el("div", "msg-row-top");
    if (unread) top.appendChild(el("span", "unread-dot"));
    top.appendChild(el("span", "msg-from", addressFor(m)));
    var date = el("span", "msg-date", relativeDate(m.created_at));
    date.title = fullDate(m.created_at);
    top.appendChild(date);
    row.appendChild(top);

    var subjWrap = el("div", "msg-subject");
    subjWrap.appendChild(document.createTextNode(m.subject || "(件名なし)"));
    if (state.folder === "drafts") {
      subjWrap.appendChild(el("span", "msg-tag is-draft", "下書き"));
    } else if (m.status === "failed" || m.error) {
      subjWrap.appendChild(el("span", "msg-tag is-error", "送信失敗"));
    }
    row.appendChild(subjWrap);

    row.appendChild(el("div", "msg-preview", truncate(m.body, 90) || "(本文なし)"));

    row.addEventListener("click", function () { onSelectMessage(m); });
    return row;
  }

  // ===========================================================
  // MESSAGE SELECTION / READING PANE
  // ===========================================================
  function onSelectMessage(m) {
    if (state.folder === "drafts") {
      // Drafts open in the compose editor.
      openCompose({
        draftId: m.id,
        to: m.to_email || "",
        subject: m.subject || "",
        body: m.body || ""
      });
      return;
    }

    state.selectedId = m.id;
    renderList();
    renderReading(m);
    $("app-view").classList.add("reading-open");

    if (state.folder === "inbox" && !m.read) {
      markRead(m, true, { silent: true });
    }
  }

  function renderReading(m) {
    hide($("reading-empty"));
    show($("reading-content"));

    $("read-subject").textContent = m.subject || "(件名なし)";
    $("read-from").textContent = m.from_email || "(差出人なし)";
    $("read-to").textContent = m.to_email || "(宛先なし)";
    $("read-date").textContent = fullDate(m.created_at);

    var statusRow = $("read-status-row");
    if (m.status === "failed" || m.error) {
      show(statusRow);
      $("read-status").textContent = "送信失敗" + (m.error ? "：" + m.error : "");
    } else if (m.status && state.folder === "sent") {
      show(statusRow);
      $("read-status").textContent = m.status === "sent" ? "送信済み" : m.status;
    } else {
      hide(statusRow);
    }

    // Body — rendered safely via textContent (white-space: pre-wrap in CSS)
    $("read-body").textContent = m.body || "(本文なし)";

    // Reply/forward always available
    show($("act-reply"));
    show($("act-forward"));

    // Read/unread toggle only for inbox
    var toggle = $("act-readtoggle");
    if (state.folder === "inbox") {
      show(toggle);
      toggle.textContent = m.read ? "未読にする" : "既読にする";
    } else {
      hide(toggle);
    }
  }

  function closeReading() {
    state.selectedId = null;
    hide($("reading-content"));
    show($("reading-empty"));
    $("app-view").classList.remove("reading-open");
    renderList();
  }

  function selectedMessage() {
    var msgs = state.cache[state.folder] || [];
    for (var i = 0; i < msgs.length; i++) {
      if (msgs[i].id === state.selectedId) return msgs[i];
    }
    return null;
  }

  // ---------------------------------------------------------
  // Read / unread
  // ---------------------------------------------------------
  function markRead(m, read, opts) {
    opts = opts || {};
    m.read = read; // optimistic
    updateBadges();
    renderList();
    var cur = selectedMessage();
    if (cur && cur.id === m.id) renderReading(cur);

    api("/update-message", { method: "POST", body: { id: m.id, read: read } })
      .catch(function (err) {
        if (err && err.isUnauthorized) return;
        m.read = !read; // revert
        updateBadges();
        renderList();
        if (!opts.silent) toast("状態の更新に失敗しました", "error");
      });
  }

  function toggleReadState() {
    var m = selectedMessage();
    if (!m) return;
    markRead(m, !m.read, {});
  }

  // ---------------------------------------------------------
  // Delete
  // ---------------------------------------------------------
  function deleteSelected() {
    var m = selectedMessage();
    if (!m) return;
    openConfirm("このメールを削除しますか？この操作は取り消せません。", function () {
      api("/delete-message", { method: "POST", body: { id: m.id } })
        .then(function () {
          var arr = state.cache[state.folder];
          if (arr) {
            state.cache[state.folder] = arr.filter(function (x) { return x.id !== m.id; });
          }
          state.selectedId = null;
          hide($("reading-content"));
          show($("reading-empty"));
          $("app-view").classList.remove("reading-open");
          updateBadges();
          renderList();
          toast("削除しました");
        })
        .catch(function (err) {
          if (err && err.isUnauthorized) return;
          toast("削除に失敗しました", "error");
        });
    });
  }

  // ---------------------------------------------------------
  // Reply / forward
  // ---------------------------------------------------------
  function quoteBody(m) {
    var lines = (m.body || "").split("\n");
    var quoted = lines.map(function (l) { return "> " + l; }).join("\n");
    var who = m.from_email || "";
    return "\n\n----- " + who + " からのメッセージ -----\n" + quoted;
  }
  function replyToSelected() {
    var m = selectedMessage();
    if (!m) return;
    var subj = m.subject || "";
    openCompose({
      draftId: null,
      to: m.from_email || "",
      subject: /^re:/i.test(subj) ? subj : "Re: " + subj,
      body: quoteBody(m)
    });
  }
  function forwardSelected() {
    var m = selectedMessage();
    if (!m) return;
    var subj = m.subject || "";
    openCompose({
      draftId: null,
      to: "",
      subject: /^fwd:/i.test(subj) ? subj : "Fwd: " + subj,
      body: quoteBody(m)
    });
  }

  // ===========================================================
  // COMPOSE
  // ===========================================================
  function openCompose(opts) {
    opts = opts || {};
    state.compose.open = true;
    state.compose.draftId = opts.draftId || null;
    state.compose.sending = false;
    state.compose.lastSaved = composeSignature(opts.to || "", opts.subject || "", opts.body || "");

    $("compose-to").value = opts.to || "";
    $("compose-subject").value = opts.subject || "";
    $("compose-body").value = opts.body || "";
    $("compose-title").textContent = state.compose.draftId ? "下書きの編集" : "新規メッセージ";
    $("compose-autosave").textContent = "";

    clearComposeErrors();
    show($("compose-overlay"));
    setTimeout(function () {
      ($("compose-to").value ? $("compose-subject") : $("compose-to")).focus();
    }, 0);
  }

  function closeCompose() {
    if (state.compose.autosaveTimer) {
      clearTimeout(state.compose.autosaveTimer);
      state.compose.autosaveTimer = null;
    }
    state.compose.open = false;
    hide($("compose-overlay"));
  }

  function composeSignature(to, subject, body) {
    return [to, subject, body].join(" ");
  }
  function readComposeFields() {
    return {
      to: $("compose-to").value.trim(),
      subject: $("compose-subject").value,
      body: $("compose-body").value
    };
  }

  function clearComposeErrors() {
    hide($("compose-to-error"));
    hide($("compose-body-error"));
  }
  function setFieldError(id, msg) {
    var box = $(id);
    box.textContent = msg;
    show(box);
  }

  function validateCompose() {
    clearComposeErrors();
    var f = readComposeFields();
    var ok = true;
    if (!f.to) { setFieldError("compose-to-error", "宛先を入力してください"); ok = false; }
    else if (!isValidEmail(f.to)) { setFieldError("compose-to-error", "メールアドレスの形式が正しくありません"); ok = false; }
    if (!f.body.trim()) { setFieldError("compose-body-error", "本文を入力してください"); ok = false; }
    return ok;
  }

  function sendCompose() {
    if (state.compose.sending) return;
    if (!validateCompose()) return;
    var f = readComposeFields();

    state.compose.sending = true;
    var btn = $("compose-send");
    btn.disabled = true;
    btn.textContent = "送信中...";
    if (state.compose.autosaveTimer) {
      clearTimeout(state.compose.autosaveTimer);
      state.compose.autosaveTimer = null;
    }

    var body = { to: f.to, subject: f.subject, body: f.body };
    if (state.compose.draftId) body.draftId = state.compose.draftId;

    api("/send-mail", { method: "POST", body: body })
      .then(function () {
        var wasDraftId = state.compose.draftId;
        closeCompose();
        toast("送信しました");
        if (wasDraftId) {
          // remove from drafts cache immediately
          var d = state.cache.drafts;
          if (d) state.cache.drafts = d.filter(function (x) { return x.id !== wasDraftId; });
          updateBadges();
          if (state.folder === "drafts") renderList();
          loadFolder("drafts", { silent: true });
        }
        loadFolder("sent", { silent: state.folder !== "sent" });
      })
      .catch(function (err) {
        if (err && err.isUnauthorized) return;
        toast((err && err.message) || "送信に失敗しました", "error");
        state.compose.sending = false;
        btn.disabled = false;
        btn.textContent = "送信";
      });
  }

  function saveDraft(opts) {
    opts = opts || {};
    var f = readComposeFields();
    if (!f.to && !f.subject.trim() && !f.body.trim()) {
      if (!opts.silent) toast("保存する内容がありません", "error");
      return Promise.resolve();
    }

    var body = { to: f.to, subject: f.subject, body: f.body };
    if (state.compose.draftId) body.id = state.compose.draftId;

    if (!opts.silent) $("compose-savedraft").disabled = true;

    return api("/save-draft", { method: "POST", body: body })
      .then(function (data) {
        if (data && data.id) state.compose.draftId = data.id;
        $("compose-title").textContent = "下書きの編集";
        state.compose.lastSaved = composeSignature(f.to, f.subject, f.body);
        if (opts.silent) {
          $("compose-autosave").textContent = "下書きを保存しました " +
            new Date().toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
        } else {
          toast("下書きを保存しました");
        }
        loadFolder("drafts", { silent: true });
      })
      .catch(function (err) {
        if (err && err.isUnauthorized) return;
        if (!opts.silent) toast("下書きの保存に失敗しました", "error");
      })
      .then(function () {
        var b = $("compose-savedraft");
        if (b) b.disabled = false;
      });
  }

  function scheduleAutosave() {
    if (!state.compose.open || state.compose.sending) return;
    if (state.compose.autosaveTimer) clearTimeout(state.compose.autosaveTimer);
    state.compose.autosaveTimer = setTimeout(function () {
      state.compose.autosaveTimer = null;
      if (!state.compose.open || state.compose.sending) return;
      var f = readComposeFields();
      var sig = composeSignature(f.to, f.subject, f.body);
      var hasContent = f.to || f.subject.trim() || f.body.trim();
      if (hasContent && sig !== state.compose.lastSaved) {
        saveDraft({ silent: true });
      }
    }, AUTOSAVE_MS);
  }

  // ===========================================================
  // FOLDER NAV / SIDEBAR
  // ===========================================================
  function selectFolder(folder) {
    if (!FOLDERS[folder]) return;
    state.folder = folder;
    state.selectedId = null;
    state.search = "";
    $("search-input").value = "";

    // nav active states
    var items = document.querySelectorAll(".nav-item");
    for (var i = 0; i < items.length; i++) {
      items[i].classList.toggle("is-active", items[i].dataset.folder === folder);
    }
    $("list-title").textContent = FOLDERS[folder].label;

    // reset reading pane
    hide($("reading-content"));
    show($("reading-empty"));
    $("app-view").classList.remove("reading-open");

    closeSidebar();
    renderList();
    if (state.cache[folder] === null) loadFolder(folder);
  }

  function openSidebar() { $("app-view").classList.add("sidebar-open"); show($("sidebar-backdrop")); }
  function closeSidebar() { $("app-view").classList.remove("sidebar-open"); hide($("sidebar-backdrop")); }

  // ===========================================================
  // AUTO REFRESH
  // ===========================================================
  function startAutoRefresh() {
    stopAutoRefresh();
    state.autoRefreshTimer = setInterval(function () {
      if (document.hidden) return;
      loadFolder("inbox", { silent: true });
    }, AUTO_REFRESH_MS);
  }
  function stopAutoRefresh() {
    if (state.autoRefreshTimer) {
      clearInterval(state.autoRefreshTimer);
      state.autoRefreshTimer = null;
    }
  }

  // ===========================================================
  // APP ENTRY
  // ===========================================================
  function enterApp() {
    showApp();
    // selectFolder("inbox") already loads the inbox; load the other two
    // folders (for their badge counts) without re-fetching the inbox.
    selectFolder("inbox");
    loadFolder("sent", { silent: true });
    loadFolder("drafts", { silent: true });
    startAutoRefresh();
  }

  // ===========================================================
  // GLOBAL KEYBOARD
  // ===========================================================
  function onKeydown(e) {
    if (e.key === "Escape") {
      if (!$("confirm-overlay").hidden) { closeConfirm(); return; }
      if (state.compose.open) { closeCompose(); return; }
      if ($("app-view").classList.contains("sidebar-open")) { closeSidebar(); return; }
      if (!$("reading-content").hidden) { closeReading(); return; }
    }
    // Ctrl/Cmd + Enter sends from within compose
    if (state.compose.open && (e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      sendCompose();
      return;
    }
    // "c" opens compose when app is active and not typing
    if (e.key === "c" && !state.compose.open && !$("app-view").hidden) {
      var tag = (e.target && e.target.tagName) || "";
      if (tag !== "INPUT" && tag !== "TEXTAREA" && tag !== "SELECT") {
        e.preventDefault();
        openCompose({});
      }
    }
  }

  // ===========================================================
  // EVENT WIRING
  // ===========================================================
  function wire() {
    // Login
    $("login-form").addEventListener("submit", handleLogin);
    $("login-toggle").addEventListener("click", togglePassword);
    $("login-password").addEventListener("input", clearLoginError);

    // Sidebar / nav
    var navItems = document.querySelectorAll(".nav-item");
    for (var i = 0; i < navItems.length; i++) {
      (function (item) {
        item.addEventListener("click", function () { selectFolder(item.dataset.folder); });
      })(navItems[i]);
    }
    $("compose-btn").addEventListener("click", function () { openCompose({}); });
    $("refresh-btn").addEventListener("click", function () { refreshAll(); toast("更新しました"); });
    $("logout-btn").addEventListener("click", logout);

    // Mobile sidebar toggles
    $("menu-btn").addEventListener("click", openSidebar);
    $("sidebar-close").addEventListener("click", closeSidebar);
    $("sidebar-backdrop").addEventListener("click", closeSidebar);

    // List
    $("list-refresh").addEventListener("click", function () { loadFolder(state.folder); });
    $("search-input").addEventListener("input", function (e) {
      state.search = e.target.value;
      renderList();
    });

    // Reading actions
    $("reading-back").addEventListener("click", closeReading);
    $("act-reply").addEventListener("click", replyToSelected);
    $("act-forward").addEventListener("click", forwardSelected);
    $("act-readtoggle").addEventListener("click", toggleReadState);
    $("act-delete").addEventListener("click", deleteSelected);

    // Compose
    $("compose-close").addEventListener("click", closeCompose);
    $("compose-send").addEventListener("click", sendCompose);
    $("compose-savedraft").addEventListener("click", function () { saveDraft({}); });
    $("compose-overlay").addEventListener("mousedown", function (e) {
      if (e.target === $("compose-overlay")) closeCompose();
    });
    ["compose-to", "compose-subject", "compose-body"].forEach(function (id) {
      $(id).addEventListener("input", scheduleAutosave);
    });

    // Confirm
    $("confirm-cancel").addEventListener("click", closeConfirm);
    $("confirm-ok").addEventListener("click", function () {
      var cb = state.confirmCallback;
      closeConfirm();
      if (cb) cb();
    });
    $("confirm-overlay").addEventListener("mousedown", function (e) {
      if (e.target === $("confirm-overlay")) closeConfirm();
    });

    // Global keyboard
    document.addEventListener("keydown", onKeydown);

    // Refresh inbox when tab becomes visible again
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden && !$("app-view").hidden) {
        loadFolder("inbox", { silent: true });
      }
    });
  }

  // ===========================================================
  // BOOT
  // ===========================================================
  function boot() {
    wire();
    if (getToken()) enterApp();
    else showLogin();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
