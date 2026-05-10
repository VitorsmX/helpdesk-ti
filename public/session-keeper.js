(function () {
  var timer = null;
  var countdownTimer = null;

  function onReady(callback) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", callback);
    } else {
      callback();
    }
  }

  function readMeta(name) {
    var el = document.querySelector('meta[name="' + name + '"]');
    return el ? el.getAttribute("content") : "";
  }

  function initSessionKeeper() {
    window.clearTimeout(timer);
    window.clearInterval(countdownTimer);

    var csrfToken = readMeta("csrf-token");
    var maxAgeMs = Number(readMeta("session-max-age-ms") || 0);
    var modalEl = document.getElementById("sessionRenewModal");
    var renewButton = document.getElementById("sessionRenewButton");
    var countdownEl = document.getElementById("sessionRenewCountdown");

    if (!csrfToken || !maxAgeMs || !modalEl || !renewButton || !window.bootstrap) return;

    var warnAfterMs = Math.max(1000, Math.floor(maxAgeMs * 0.7));
    var remainingMs = Math.max(1000, maxAgeMs - warnAfterMs);
    var modal = new window.bootstrap.Modal(modalEl, { backdrop: "static", keyboard: false });
    var expiresAt = 0;

    function formatRemaining(ms) {
      var totalSeconds = Math.max(0, Math.ceil(ms / 1000));
      var minutes = Math.floor(totalSeconds / 60);
      var seconds = totalSeconds % 60;
      var mm = minutes < 10 ? "0" + minutes : String(minutes);
      var ss = seconds < 10 ? "0" + seconds : String(seconds);
      return mm + ":" + ss;
    }

    function updateCountdown() {
      if (!countdownEl) return;
      countdownEl.textContent = formatRemaining(expiresAt - Date.now());
      if (Date.now() >= expiresAt) {
        window.location.href = "/login";
      }
    }

    function scheduleWarning() {
      window.clearTimeout(timer);
      window.clearInterval(countdownTimer);
      timer = window.setTimeout(function () {
        expiresAt = Date.now() + remainingMs;
        updateCountdown();
        countdownTimer = window.setInterval(updateCountdown, 1000);
        modal.show();
      }, warnAfterMs);
    }

    if (renewButton.dataset.sessionKeeperBound !== "true") {
      renewButton.dataset.sessionKeeperBound = "true";
      renewButton.addEventListener("click", function () {
        renewButton.disabled = true;
        renewButton.innerHTML = '<span class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>Renovando';

        var xhr = new XMLHttpRequest();
        xhr.open("POST", "/session/renew", true);
        xhr.setRequestHeader("Accept", "application/json");
        xhr.setRequestHeader("Content-Type", "application/x-www-form-urlencoded;charset=UTF-8");
        xhr.withCredentials = true;
        xhr.onreadystatechange = function () {
          if (xhr.readyState !== 4) return;
          if (xhr.status >= 200 && xhr.status < 300) {
            window.clearInterval(countdownTimer);
            modal.hide();
            renewButton.disabled = false;
            renewButton.textContent = "Continuar sessão";
            scheduleWarning();
          } else {
            window.location.href = "/login";
          }
        };
        xhr.onerror = function () {
          window.location.href = "/login";
        };
        xhr.send("_csrf=" + encodeURIComponent(readMeta("csrf-token")));
      });
    }

    scheduleWarning();
  }

  window.HelpdeskSessionKeeper = { init: initSessionKeeper };
  onReady(initSessionKeeper);
  document.addEventListener("app:page-ready", initSessionKeeper);
})();
