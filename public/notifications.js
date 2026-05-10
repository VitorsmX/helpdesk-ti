(function () {
  var POLL_INTERVAL_MS = 45000;
  var pollTimer = null;
  var initialized = false;
  var state = {
    userId: null,
    role: null,
    enabled: false,
    polling: false,
  };

  function onReady(callback) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", callback);
    } else {
      callback();
    }
  }

  onReady(init);
  document.addEventListener("app:page-ready", init);

  window.HelpdeskNotifications = {
    init: init,
    poll: poll,
    test: showTestNotification,
  };

  function init() {
    var body = document.body;
    if (!body || !body.dataset.userId) return;

    state.userId = body.dataset.userId;
    state.role = body.dataset.userRole || "REQUESTER";
    state.enabled = readEnabled();

    bindControls();
    renderState();

    if (state.enabled && permissionGranted()) startPolling();
    else stopPolling();

    initialized = true;
  }

  function bindControls() {
    var toggle = document.getElementById("notificationToggle");
    var permissionButton = document.getElementById("notificationPermissionButton");
    var testButton = document.getElementById("notificationTestButton");

    if (toggle && toggle.dataset.bound !== "true") {
      toggle.dataset.bound = "true";
      toggle.addEventListener("change", function () {
        setEnabled(toggle.checked);
        if (toggle.checked) requestPermissionAndStart();
        else stopPolling();
      });
    }

    if (permissionButton && permissionButton.dataset.bound !== "true") {
      permissionButton.dataset.bound = "true";
      permissionButton.addEventListener("click", requestPermissionAndStart);
    }

    if (testButton && testButton.dataset.bound !== "true") {
      testButton.dataset.bound = "true";
      testButton.addEventListener("click", showTestNotification);
    }
  }

  function requestPermissionAndStart() {
    if (!notificationsSupported()) {
      setEnabled(false);
      renderState("Este navegador não oferece notificações do sistema.");
      return;
    }

    if (Notification.permission === "granted") {
      setEnabled(true);
      ensureLastSeen();
      renderState("Notificações ativas.");
      startPolling();
      return;
    }

    if (Notification.permission === "denied") {
      setEnabled(false);
      renderState("As notificações estão bloqueadas no navegador. Use as permissões do site para permitir.");
      return;
    }

    Notification.requestPermission().then(function (permission) {
      if (permission === "granted") {
        setEnabled(true);
        ensureLastSeen();
        renderState("Notificações ativas.");
        showNotification({
          id: "permission-granted",
          title: "Helpdesk TI",
          body: "Notificações ativadas com sucesso neste navegador.",
          severity: "success",
          url: window.location.pathname,
        });
        startPolling();
      } else {
        setEnabled(false);
        renderState("Permissão não concedida. O sistema continuará sem alertas do Windows.");
      }
    });
  }

  function startPolling() {
    if (state.polling) return;
    state.polling = true;
    poll();
    pollTimer = window.setInterval(poll, POLL_INTERVAL_MS);
    renderState();
  }

  function stopPolling() {
    state.polling = false;
    window.clearInterval(pollTimer);
    pollTimer = null;
    renderState();
  }

  function poll() {
    if (!state.enabled || !permissionGranted() || !window.fetch) return;

    var since = readLastSeen() || new Date().toISOString();
    var url = "/notifications/events?limit=10&since=" + encodeURIComponent(since);

    fetch(url, {
      method: "GET",
      credentials: "same-origin",
      headers: {
        "Accept": "application/json",
        "X-Requested-With": "XMLHttpRequest",
      },
    })
      .then(function (response) {
        if (!response.ok) throw new Error("HTTP " + response.status);
        return response.json();
      })
      .then(function (payload) {
        if (!payload || payload.ok === false) return;
        var events = Array.isArray(payload.events) ? payload.events : [];
        events.reverse().forEach(function (event) {
          if (rememberEvent(event.id)) showNotification(event);
        });
        writeLastSeen(payload.serverTime || new Date().toISOString());
      })
      .catch(function () {
        renderState("Não foi possível consultar novas notificações agora.");
      });
  }

  function showTestNotification() {
    if (!state.enabled || !permissionGranted()) {
      requestPermissionAndStart();
      return;
    }

    showNotification({
      id: "manual-test-" + Date.now(),
      title: "Helpdesk TI - teste",
      body: roleTestMessage(),
      severity: "info",
      url: window.location.pathname,
    });
  }

  function showNotification(event) {
    if (!permissionGranted()) return;

    var notification = new Notification(formatTitle(event), {
      body: event.body || "Existe uma nova atualização no Helpdesk TI.",
      icon: "/public/assets/icons/notification.svg",
      badge: "/public/assets/icons/notification.svg",
      tag: event.id || event.type || "helpdesk-ti",
      renotify: event.severity === "urgent",
      requireInteraction: event.severity === "urgent" || event.severity === "warning",
      silent: false,
      data: { url: event.url || "/" },
    });

    notification.onclick = function () {
      window.focus();
      var targetUrl = notification.data && notification.data.url ? notification.data.url : "/";
      if (window.HelpdeskApp && window.HelpdeskApp.visit) {
        window.HelpdeskApp.visit(targetUrl, { push: true });
      } else {
        window.location.href = targetUrl;
      }
      notification.close();
    };
  }

  function renderState(message) {
    var toggle = document.getElementById("notificationToggle");
    var stateLabel = document.getElementById("notificationPermissionState");
    var permissionButton = document.getElementById("notificationPermissionButton");
    var testButton = document.getElementById("notificationTestButton");
    var dot = document.getElementById("notificationStatusDot");
    var guide = document.getElementById("notificationGuideStatus");

    if (toggle) toggle.checked = state.enabled;

    var text = message || defaultStateMessage();
    if (stateLabel) stateLabel.textContent = text;
    if (guide) guide.dataset.permission = notificationPermission();

    if (permissionButton) {
      permissionButton.disabled = !notificationsSupported() || Notification.permission === "granted";
    }
    if (testButton) {
      testButton.disabled = !state.enabled || !permissionGranted();
    }
    if (dot) {
      dot.dataset.state = state.enabled && permissionGranted() ? "on" : state.enabled ? "waiting" : "off";
    }
  }

  function setEnabled(enabled) {
    state.enabled = Boolean(enabled);
    localStorage.setItem(enabledKey(), state.enabled ? "true" : "false");
    if (state.enabled) ensureLastSeen();
    renderState();
  }

  function ensureLastSeen() {
    if (!readLastSeen()) writeLastSeen(new Date(Date.now() - 15000).toISOString());
  }

  function rememberEvent(id) {
    if (!id) return true;

    var key = seenKey();
    var seen = [];
    try {
      seen = JSON.parse(localStorage.getItem(key) || "[]");
      if (!Array.isArray(seen)) seen = [];
    } catch (error) {
      seen = [];
    }

    if (seen.indexOf(id) !== -1) return false;
    seen.push(id);
    localStorage.setItem(key, JSON.stringify(seen.slice(-120)));
    return true;
  }

  function readEnabled() {
    return localStorage.getItem(enabledKey()) === "true";
  }

  function readLastSeen() {
    return localStorage.getItem(lastSeenKey());
  }

  function writeLastSeen(value) {
    localStorage.setItem(lastSeenKey(), value);
  }

  function enabledKey() {
    return "helpdesk:notifications:enabled:" + state.userId;
  }

  function lastSeenKey() {
    return "helpdesk:notifications:last-seen:" + state.userId;
  }

  function seenKey() {
    return "helpdesk:notifications:seen:" + state.userId;
  }

  function notificationsSupported() {
    return "Notification" in window;
  }

  function permissionGranted() {
    return notificationsSupported() && Notification.permission === "granted";
  }

  function notificationPermission() {
    if (!notificationsSupported()) return "unsupported";
    return Notification.permission;
  }

  function defaultStateMessage() {
    if (!notificationsSupported()) return "Este navegador não suporta notificações do sistema.";
    if (!state.enabled) return "Desativadas neste navegador.";
    if (Notification.permission === "granted") return state.polling || initialized ? "Ativas e monitorando eventos." : "Ativas.";
    if (Notification.permission === "denied") return "Bloqueadas no navegador.";
    return "Aguardando permissão do navegador.";
  }

  function formatTitle(event) {
    var prefix = "Helpdesk TI";
    if (event.severity === "urgent") prefix += " - urgente";
    else if (event.severity === "warning") prefix += " - atenção";
    else if (event.severity === "success") prefix += " - concluído";
    return event.title ? prefix + ": " + event.title : prefix;
  }

  function roleTestMessage() {
    if (state.role === "ADMIN") return "Exemplo: SLA estourado, estoque crítico ou chamado urgente.";
    if (state.role === "TECH") return "Exemplo: novo chamado na fila ou resposta em chamado atribuído.";
    if (state.role === "COORDINATOR") return "Exemplo: movimentação em chamado da sua unidade.";
    return "Exemplo: resposta ou mudança de status no seu chamado.";
  }
})();
