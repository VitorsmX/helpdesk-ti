(function () {
  var scriptLoadCache = {};
  var pendingForm = null;
  var confirmModal = null;

  function onReady(callback) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", callback);
    } else {
      callback();
    }
  }

  onReady(function () {
    bindGlobalHandlers();
    initPage();
  });

  window.HelpdeskApp = window.HelpdeskApp || {};
  window.HelpdeskApp.init = initPage;
  window.HelpdeskApp.visit = visit;
  window.HelpdeskApp.showFlash = showFlash;

  function bindGlobalHandlers() {
    if (document.documentElement.dataset.appShellBound === "true") return;
    document.documentElement.dataset.appShellBound = "true";

    rememberExistingScripts();
    document.addEventListener("click", handleDocumentClick);
    document.addEventListener("submit", handleDocumentSubmit);

    window.addEventListener("popstate", function () {
      visit(window.location.href, { push: false });
    });
  }

  function initPage() {
    initTooltips();
    initFlashFeedback();
    initMonitoringAccordion();
    document.dispatchEvent(createAppEvent("app:page-ready"));
  }

  function handleDocumentClick(event) {
    var passwordButton = closest(event.target, ".js-toggle-password");
    if (passwordButton) {
      event.preventDefault();
      togglePassword(passwordButton);
      return;
    }

    var mobileButton = closest(event.target, "#mobileMenuBtn");
    if (mobileButton) {
      event.preventDefault();
      toggleSidebar();
      return;
    }

    var overlay = closest(event.target, "#sidebarOverlay");
    if (overlay) {
      event.preventDefault();
      toggleSidebar();
      return;
    }

    var accordionButton = closest(event.target, "#monitoringAccordion");
    if (accordionButton) {
      event.preventDefault();
      toggleMonitoringAccordion();
      return;
    }

    var link = closest(event.target, "a");
    if (shouldAjaxNavigate(event, link)) {
      event.preventDefault();
      visit(link.href, { push: true });
    }
  }

  function handleDocumentSubmit(event) {
    var form = event.target;

    if (form && form.classList && form.classList.contains("js-confirm-action") && form.dataset.confirmed !== "true") {
      event.preventDefault();
      showConfirmModal(form);
      return;
    }

    if (shouldAjaxGetForm(form)) {
      event.preventDefault();
      visit(buildGetFormUrl(form), { push: true });
      return;
    }

    if (!shouldAjaxSubmit(form)) {
      markFormSubmitting(form);
      return;
    }

    event.preventDefault();
    submitForm(form);
  }

  function shouldAjaxNavigate(event, link) {
    if (!link || !window.fetch || !window.DOMParser) return false;
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
    if (link.target && link.target !== "_self") return false;
    if (link.hasAttribute("download") || link.dataset.noAjax === "true") return false;

    var url = new URL(link.href, window.location.href);
    if (url.origin !== window.location.origin) return false;
    if (url.hash && url.pathname === window.location.pathname && url.search === window.location.search) return false;
    if (url.pathname.indexOf("/public/") === 0 || url.pathname.indexOf("/system-assets/") === 0) return false;
    if (url.pathname.indexOf("/export") === 0) return false;

    return true;
  }

  function shouldAjaxSubmit(form) {
    if (!form || form.tagName !== "FORM" || !window.fetch || !window.FormData || !window.URLSearchParams || !window.DOMParser) return false;
    if (form.dataset.noAjax === "true") return false;
    if (form.target && form.target !== "_self") return false;

    var method = String(form.getAttribute("method") || "get").toLowerCase();
    if (method !== "post") return false;

    var actionUrl = new URL(form.getAttribute("action") || window.location.href, window.location.href);
    if (actionUrl.pathname === "/logout") return false;

    return actionUrl.origin === window.location.origin;
  }

  function shouldAjaxGetForm(form) {
    if (!form || form.tagName !== "FORM" || !window.fetch || !window.FormData || !window.URLSearchParams) return false;
    if (form.dataset.noAjax === "true") return false;
    if (form.target && form.target !== "_self") return false;

    var method = String(form.getAttribute("method") || "get").toLowerCase();
    if (method !== "get") return false;

    var actionUrl = new URL(form.getAttribute("action") || window.location.href, window.location.href);
    if (actionUrl.origin !== window.location.origin) return false;
    return actionUrl.pathname.indexOf("/export") !== 0;
  }

  function buildGetFormUrl(form) {
    var actionUrl = new URL(form.getAttribute("action") || window.location.href, window.location.href);
    var data = new FormData(form);
    actionUrl.search = new URLSearchParams(data).toString();
    return actionUrl.href;
  }

  function submitForm(form) {
    var submitter = document.activeElement && closest(document.activeElement, "button,input");
    var actionUrl = new URL(form.getAttribute("action") || window.location.href, window.location.href);
    var payload = buildPostPayload(form, submitter);

    markFormSubmitting(form);
    hideOpenModals();

    var headers = {
      "Accept": "application/json",
      "X-App-Form": "true",
      "X-Requested-With": "XMLHttpRequest",
    };
    Object.keys(payload.headers).forEach(function (name) {
      headers[name] = payload.headers[name];
    });

    fetch(actionUrl.href, {
      method: "POST",
      body: payload.body,
      credentials: "same-origin",
      headers: headers,
    })
      .then(function (response) {
        return readResponse(response);
      })
      .then(function (payload) {
        if (payload.type === "json") {
          if (payload.data && payload.data.ok === false) {
            showFlash(payload.data.flash || jsonErrorToFlash(payload.data.error));
            return null;
          }
          if (payload.data && payload.data.redirect) {
            return visit(payload.data.redirect, {
              push: true,
              flash: payload.data.flash,
              replaceFlash: true,
            });
          }
          showFlash(payload.data && payload.data.flash);
          return null;
        }

        if (payload.type === "html") {
          swapHtml(payload.text, actionUrl.href, true, null);
          return null;
        }

        window.location.href = actionUrl.href;
        return null;
      })
      .catch(function (error) {
        showFlash({
          error: [friendlyNetworkMessage(error)],
          success: [],
          info: [],
        });
      })
      .then(function () {
        restoreFormSubmitting(form);
      });
  }

  function buildPostPayload(form, submitter) {
    var body = new FormData(form);
    var headers = {};
    var csrfToken = getCsrfToken(form);

    if (submitter && submitter.name && !body.has(submitter.name)) {
      body.append(submitter.name, submitter.value || "");
    }

    if (csrfToken) {
      headers["X-CSRF-Token"] = csrfToken;
    }

    if (shouldUseMultipart(form)) {
      return { body: body, headers: headers };
    }

    headers["Content-Type"] = "application/x-www-form-urlencoded;charset=UTF-8";
    return { body: new URLSearchParams(body), headers: headers };
  }

  function shouldUseMultipart(form) {
    var enctype = String(form.getAttribute("enctype") || form.enctype || "").toLowerCase();
    if (enctype.indexOf("multipart/form-data") !== -1) return true;
    return Boolean(form.querySelector('input[type="file"]'));
  }

  function getCsrfToken(form) {
    var input = form && form.querySelector('input[name="_csrf"]');
    if (input && input.value) return input.value;

    var meta = document.querySelector('meta[name="csrf-token"]');
    return meta ? meta.getAttribute("content") || "" : "";
  }

  function visit(url, options) {
    var opts = options || {};
    var targetUrl = new URL(url, window.location.href);
    if (targetUrl.origin !== window.location.origin) {
      window.location.href = targetUrl.href;
      return Promise.resolve();
    }

    setBusy(true);

    return fetch(targetUrl.href, {
      method: "GET",
      credentials: "same-origin",
      headers: {
        "Accept": "text/html",
        "X-App-Navigation": "true",
      },
    })
      .then(function (response) {
        if (!response.ok) throw new Error("HTTP " + response.status);
        return response.text();
      })
      .then(function (html) {
        swapHtml(html, targetUrl.href, opts.push !== false, opts.flash, opts.replaceFlash);
      })
      .catch(function (error) {
        showFlash({
          error: [friendlyNetworkMessage(error)],
          success: [],
          info: [],
        });
      })
      .then(function () {
        setBusy(false);
      });
  }

  function readResponse(response) {
    var contentType = response.headers.get("content-type") || "";
    if (contentType.indexOf("application/json") !== -1) {
      return response.json().then(function (data) {
        return { type: "json", data: data, response: response };
      });
    }
    if (contentType.indexOf("text/html") !== -1) {
      return response.text().then(function (text) {
        return { type: "html", text: text, response: response };
      });
    }
    return { type: "other", response: response };
  }

  function swapHtml(html, url, push, flash, replaceFlash) {
    var parser = new DOMParser();
    var nextDocument = parser.parseFromString(html, "text/html");
    var nextBody = nextDocument.body;
    if (!nextBody) throw new Error("Resposta HTML inválida.");

    hideOpenModals();
    document.title = nextDocument.title || document.title;
    syncMeta(nextDocument, "csrf-token");
    syncMeta(nextDocument, "session-max-age-ms");
    syncBodyAttributes(nextBody);

    document.body.innerHTML = nextBody.innerHTML;

    if (push) {
      window.history.pushState({}, document.title, url);
    }

    loadPageScripts()
      .then(function () {
        if (replaceFlash) removeFlashRegions();
        showFlash(flash);
        initPage();
        try {
          window.scrollTo({ top: 0, behavior: "smooth" });
        } catch (error) {
          window.scrollTo(0, 0);
        }
      });
  }

  function syncBodyAttributes(nextBody) {
    document.body.className = nextBody.className || "";

    Array.prototype.slice.call(document.body.attributes).forEach(function (attr) {
      if (attr.name.indexOf("data-") === 0 && !nextBody.hasAttribute(attr.name)) {
        document.body.removeAttribute(attr.name);
      }
    });

    Array.prototype.slice.call(nextBody.attributes).forEach(function (attr) {
      if (attr.name.indexOf("data-") === 0) {
        document.body.setAttribute(attr.name, attr.value);
      }
    });
  }

  function loadPageScripts() {
    var scripts = Array.prototype.slice.call(document.body.querySelectorAll("script[src]"));
    var chain = Promise.resolve();

    scripts.forEach(function (script) {
      var src = script.getAttribute("src");
      if (!src || shouldSkipScript(src)) return;
      chain = chain.then(function () {
        return loadScript(src);
      });
    });

    return chain;
  }

  function shouldSkipScript(src) {
    return src.indexOf("/public/app-shell") !== -1 ||
      src.indexOf("/public/vendor/bootstrap") !== -1;
  }

  function loadScript(src) {
    var absolute = new URL(src, window.location.href).href;
    if (scriptLoadCache[absolute]) return scriptLoadCache[absolute];

    scriptLoadCache[absolute] = new Promise(function (resolve, reject) {
      var script = document.createElement("script");
      script.src = absolute;
      script.async = false;
      script.onload = function () { resolve(); };
      script.onerror = function () { reject(new Error("Falha ao carregar script " + absolute)); };
      document.head.appendChild(script);
    });

    return scriptLoadCache[absolute];
  }

  function rememberExistingScripts() {
    Array.prototype.forEach.call(document.querySelectorAll("script[src]"), function (script) {
      var absolute = new URL(script.getAttribute("src"), window.location.href).href;
      scriptLoadCache[absolute] = Promise.resolve();
    });
  }

  function showConfirmModal(form) {
    var confirmModalEl = document.getElementById("confirmActionModal");
    if (!confirmModalEl || !window.bootstrap) {
      form.dataset.confirmed = "true";
      submitFormOrNative(form);
      return;
    }

    var titleEl = document.getElementById("confirmActionTitle");
    var messageEl = document.getElementById("confirmActionMessage");
    var confirmBtn = document.getElementById("confirmActionSubmit");

    confirmModal = confirmModal || new window.bootstrap.Modal(confirmModalEl);
    pendingForm = form;

    titleEl.textContent = form.dataset.confirmTitle || "Confirmar ação";
    messageEl.textContent = form.dataset.confirmMessage || "Revise esta operação antes de continuar.";
    confirmBtn.textContent = form.dataset.confirmConfirm || "Confirmar";
    confirmBtn.className = "btn " + (form.dataset.confirmVariant || "btn-danger");

    confirmBtn.onclick = function () {
      if (!pendingForm) return;
      pendingForm.dataset.confirmed = "true";
      var confirmedForm = pendingForm;
      pendingForm = null;
      confirmModal.hide();
      submitFormOrNative(confirmedForm);
    };

    confirmModalEl.addEventListener("hidden.bs.modal", function () {
      if (pendingForm) delete pendingForm.dataset.confirmed;
      pendingForm = null;
    }, { once: true });

    confirmModal.show();
  }

  function submitFormOrNative(form) {
    if (shouldAjaxSubmit(form)) submitForm(form);
    else form.submit();
  }

  function showFlash(flash) {
    if (!flash) return;

    var messages = normalizeFlash(flash);
    if (!messages.error.length && !messages.success.length && !messages.info.length) return;

    removeFlashRegions();

    var region = document.createElement("div");
    region.className = "app-flash-region";
    region.tabIndex = -1;
    region.setAttribute("aria-label", "Mensagens do sistema");

    appendFlashAlert(region, "danger", "bi-exclamation-circle", "Não foi possível continuar", messages.error, "assertive");
    appendFlashAlert(region, "success", "bi-check-circle", "Tudo certo", messages.success, "polite");
    appendFlashAlert(region, "info", "bi-info-circle", "Atualização recebida", messages.info, "polite");

    document.body.appendChild(region);
    initFlashFeedback();
  }

  function appendFlashAlert(region, variant, icon, title, messages, live) {
    if (!messages || !messages.length) return;

    var alert = document.createElement("div");
    alert.className = "alert app-alert app-alert-" + variant + " alert-dismissible fade show";
    alert.setAttribute("role", variant === "danger" ? "alert" : "status");
    alert.setAttribute("aria-live", live);

    var iconEl = document.createElement("i");
    iconEl.className = "bi " + icon + " app-alert-icon";

    var content = document.createElement("div");
    var strong = document.createElement("strong");
    strong.textContent = title;
    content.appendChild(strong);

    messages.forEach(function (message) {
      var item = document.createElement("div");
      item.textContent = message;
      content.appendChild(item);
    });

    var closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.className = "btn-close";
    closeButton.setAttribute("data-bs-dismiss", "alert");
    closeButton.setAttribute("aria-label", "Fechar");

    alert.appendChild(iconEl);
    alert.appendChild(content);
    alert.appendChild(closeButton);
    region.appendChild(alert);
  }

  function normalizeFlash(flash) {
    return {
      error: Array.isArray(flash.error) ? flash.error : [],
      success: Array.isArray(flash.success) ? flash.success : [],
      info: Array.isArray(flash.info) ? flash.info : [],
    };
  }

  function jsonErrorToFlash(error) {
    if (!error || !error.message) return null;
    return { error: [error.message], success: [], info: [] };
  }

  function removeFlashRegions() {
    Array.prototype.forEach.call(document.querySelectorAll(".app-flash-region"), function (region) {
      region.parentNode.removeChild(region);
    });
  }

  function initFlashFeedback() {
    var flashRegion = document.querySelector(".app-flash-region");
    if (!flashRegion) return;

    window.setTimeout(function () {
      try {
        flashRegion.focus({ preventScroll: true });
      } catch (error) {
        flashRegion.focus();
      }

      try {
        flashRegion.scrollIntoView({ block: "nearest", behavior: "smooth" });
      } catch (error) {
        flashRegion.scrollIntoView();
      }
    }, 60);
  }

  function initTooltips() {
    if (!window.bootstrap) return;
    Array.prototype.forEach.call(document.querySelectorAll('[data-bs-toggle="tooltip"]'), function (el) {
      if (!window.bootstrap.Tooltip.getInstance(el)) {
        new window.bootstrap.Tooltip(el);
      }
    });
  }

  function initMonitoringAccordion() {
    var accordionHeader = document.getElementById("monitoringAccordion");
    var accordionContent = document.getElementById("monitoringContent");
    if (!accordionHeader || !accordionContent || accordionHeader.dataset.bound === "true") return;

    var isCollapsed = localStorage.getItem("monitoringAccordionCollapsed") === "true";
    accordionHeader.classList.toggle("collapsed", isCollapsed);
    accordionContent.classList.toggle("collapsed", isCollapsed);
    accordionHeader.dataset.bound = "true";
  }

  function toggleMonitoringAccordion() {
    var accordionHeader = document.getElementById("monitoringAccordion");
    var accordionContent = document.getElementById("monitoringContent");
    if (!accordionHeader || !accordionContent) return;

    var collapsed = accordionHeader.classList.toggle("collapsed");
    accordionContent.classList.toggle("collapsed", collapsed);
    localStorage.setItem("monitoringAccordionCollapsed", collapsed);
  }

  function togglePassword(button) {
    var target = document.querySelector(button.getAttribute("data-target"));
    if (!target) return;

    var isHidden = target.getAttribute("type") === "password";
    target.setAttribute("type", isHidden ? "text" : "password");
    button.setAttribute("aria-label", isHidden ? "Ocultar senha" : "Mostrar senha");

    var icon = button.querySelector("i");
    if (icon) icon.className = "bi bi-" + (isHidden ? "eye-slash" : "eye");
  }

  function toggleSidebar() {
    var sidebar = document.querySelector(".sidebar");
    var overlay = document.getElementById("sidebarOverlay");
    if (!sidebar || !overlay) return;
    sidebar.classList.toggle("show");
    overlay.classList.toggle("show");
  }

  function hideOpenModals() {
    if (!window.bootstrap) return;
    Array.prototype.forEach.call(document.querySelectorAll(".modal.show"), function (modalEl) {
      var instance = window.bootstrap.Modal.getInstance(modalEl);
      if (instance) instance.hide();
    });
    Array.prototype.forEach.call(document.querySelectorAll(".modal-backdrop"), function (backdrop) {
      backdrop.parentNode.removeChild(backdrop);
    });
    document.body.classList.remove("modal-open");
    document.body.style.removeProperty("padding-right");
  }

  function markFormSubmitting(form) {
    if (!form || form.classList.contains("is-submitting")) return;
    form.classList.add("is-submitting");

    var buttons = form.querySelectorAll('button[type="submit"], input[type="submit"]');
    Array.prototype.forEach.call(buttons, function (button) {
      if (button.disabled) return;
      button.dataset.originalLabel = button.tagName === "INPUT" ? button.value : button.innerHTML;
      button.disabled = true;
      if (button.tagName === "INPUT") {
        button.value = button.dataset.submittingLabel || "Enviando...";
      } else {
        button.innerHTML = '<span class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>' +
          (button.dataset.submittingLabel || "Enviando...");
      }
    });
  }

  function restoreFormSubmitting(form) {
    if (!form || !form.classList) return;
    form.classList.remove("is-submitting");

    var buttons = form.querySelectorAll('button[type="submit"], input[type="submit"]');
    Array.prototype.forEach.call(buttons, function (button) {
      if (button.dataset.originalLabel) {
        if (button.tagName === "INPUT") button.value = button.dataset.originalLabel;
        else button.innerHTML = button.dataset.originalLabel;
        delete button.dataset.originalLabel;
      }
      button.disabled = false;
    });
  }

  function syncMeta(nextDocument, name) {
    var current = document.querySelector('meta[name="' + name + '"]');
    var next = nextDocument.querySelector('meta[name="' + name + '"]');

    if (!next) {
      if (current) current.parentNode.removeChild(current);
      return;
    }

    if (!current) {
      current = document.createElement("meta");
      current.setAttribute("name", name);
      document.head.appendChild(current);
    }
    current.setAttribute("content", next.getAttribute("content") || "");
  }

  function updateCsrf(token) {
    if (!token) return;
    var meta = document.querySelector('meta[name="csrf-token"]');
    if (meta) meta.setAttribute("content", token);
    Array.prototype.forEach.call(document.querySelectorAll('input[name="_csrf"]'), function (input) {
      input.value = token;
    });
  }

  function setBusy(active) {
    document.documentElement.classList.toggle("app-busy", Boolean(active));
  }

  function friendlyNetworkMessage(error) {
    if (error && error.message && (error.message.indexOf("HTTP 403") !== -1 || error.message.indexOf("HTTP 419") !== -1)) {
      return "Sua sessão expirou ou o formulário ficou desatualizado. Recarregue a página e tente novamente.";
    }
    return "Não foi possível concluir a ação agora. Verifique sua conexão e tente novamente.";
  }

  function closest(node, selector) {
    while (node && node !== document) {
      if (matches(node, selector)) return node;
      node = node.parentNode;
    }
    return null;
  }

  function matches(node, selector) {
    var fn = node.matches || node.msMatchesSelector || node.webkitMatchesSelector;
    return Boolean(fn && fn.call(node, selector));
  }

  function createAppEvent(name) {
    if (typeof window.CustomEvent === "function") return new window.CustomEvent(name);
    var event = document.createEvent("Event");
    event.initEvent(name, true, true);
    return event;
  }
})();
