(function () {
  "use strict";

  var SEND_URL = "/.netlify/functions/send-mail";
  var LIST_URL = "/.netlify/functions/list-mails";

  var form = document.getElementById("compose-form");
  var toInput = document.getElementById("to");
  var subjectInput = document.getElementById("subject");
  var bodyInput = document.getElementById("body");
  var sendBtn = document.getElementById("send-btn");
  var statusEl = document.getElementById("status");
  var historyList = document.getElementById("history-list");

  // --- helpers ---------------------------------------------------------

  function setStatus(message, type) {
    statusEl.textContent = message || "";
    statusEl.className = "status" + (type ? " " + type : "");
  }

  function formatDate(value) {
    if (!value) return "";
    var d = new Date(value);
    if (isNaN(d.getTime())) return String(value);
    return d.toLocaleString("ja-JP");
  }

  // Build a DOM element with safe text content (avoids innerHTML/XSS).
  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null && text !== "") node.textContent = text;
    return node;
  }

  // --- history rendering ----------------------------------------------

  function renderEmpty() {
    historyList.innerHTML = "";
    var li = el("li", "empty", "まだ送信履歴はありません");
    historyList.appendChild(li);
  }

  function renderHistory(mails) {
    historyList.innerHTML = "";

    if (!mails || mails.length === 0) {
      renderEmpty();
      return;
    }

    mails.forEach(function (mail) {
      var item = el("li", "history-item");

      var top = el("div", "history-top");
      top.appendChild(el("span", "history-to", mail.to_email || ""));

      var isSent = mail.status === "sent";
      var badge = el(
        "span",
        "badge " + (isSent ? "sent" : "failed"),
        isSent ? "sent" : "failed"
      );
      top.appendChild(badge);
      item.appendChild(top);

      item.appendChild(el("div", "history-subject", mail.subject || "(件名なし)"));
      item.appendChild(el("div", "history-meta", formatDate(mail.created_at)));

      if (!isSent && mail.error) {
        item.appendChild(el("div", "history-error", mail.error));
      }

      historyList.appendChild(item);
    });
  }

  function loadHistory() {
    fetch(LIST_URL, { method: "GET", headers: { Accept: "application/json" } })
      .then(function (res) {
        return res.json();
      })
      .then(function (data) {
        if (data && data.ok) {
          renderHistory(data.mails || []);
        } else {
          historyList.innerHTML = "";
          var msg = (data && data.error) || "履歴の取得に失敗しました";
          historyList.appendChild(el("li", "empty", msg));
        }
      })
      .catch(function () {
        historyList.innerHTML = "";
        historyList.appendChild(
          el("li", "empty", "履歴の取得中にネットワークエラーが発生しました")
        );
      });
  }

  // --- send ------------------------------------------------------------

  function setSending(sending) {
    sendBtn.disabled = sending;
    sendBtn.textContent = sending ? "送信中..." : "送信";
  }

  function handleSubmit(event) {
    event.preventDefault();

    var to = toInput.value.trim();
    var subject = subjectInput.value.trim();
    var body = bodyInput.value.trim();

    if (!to || !subject || !body) {
      setStatus("すべての項目を入力してください。", "error");
      return;
    }
    if (!form.checkValidity()) {
      setStatus("入力内容を確認してください。", "error");
      return;
    }

    setSending(true);
    setStatus("送信中...", "");

    fetch(SEND_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ to: to, subject: subject, body: body }),
    })
      .then(function (res) {
        return res.json().catch(function () {
          return { ok: false, error: "サーバーから不正な応答が返されました" };
        });
      })
      .then(function (data) {
        if (data && data.ok) {
          setStatus("送信しました。", "success");
          form.reset();
          loadHistory();
        } else {
          setStatus((data && data.error) || "送信に失敗しました。", "error");
        }
      })
      .catch(function () {
        setStatus("ネットワークエラーが発生しました。", "error");
      })
      .finally(function () {
        setSending(false);
      });
  }

  // --- init ------------------------------------------------------------

  form.addEventListener("submit", handleSubmit);
  loadHistory();
})();
