(function () {
  var monthNames = [
    "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
    "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
  ];
  var weekDays = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

  function onReady(callback) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", callback);
    } else {
      callback();
    }
  }

  function initReportDateControls() {
    initPeriodVisibility();
    initDatePickers();
    bindReportValidation();
  }

  function initPeriodVisibility() {
    var periodSelect = document.querySelector('#reportExportForm select[name="period"]');
    var customFields = document.getElementById("reportCustomPeriodFields");
    if (!periodSelect || !customFields || periodSelect.dataset.customPeriodBound === "true") return;

    periodSelect.dataset.customPeriodBound = "true";
    periodSelect.addEventListener("change", function () {
      var custom = this.value === "custom";
      customFields.classList.toggle("d-none", !custom);
      if (!custom) clearCustomDates(customFields);
      if (custom) {
        var firstInput = customFields.querySelector("[data-date-display]");
        if (firstInput) firstInput.focus();
      }
      clearDateFeedback();
    });
  }

  function initDatePickers() {
    var fields = document.querySelectorAll("[data-date-picker]");
    Array.prototype.forEach.call(fields, function (field) {
      if (field.dataset.datePickerBound === "true") return;
      field.dataset.datePickerBound = "true";

      var input = field.querySelector("[data-date-display]");
      var hidden = field.querySelector("[data-date-value]");
      var toggle = field.querySelector("[data-date-toggle]");
      var panel = field.querySelector("[data-date-panel]");
      if (!input || !hidden || !toggle || !panel) return;

      var selected = parseIsoDate(hidden.value) || parseBrDate(input.value) || new Date();
      selected.setHours(0, 0, 0, 0);
      field._visibleMonth = new Date(selected.getFullYear(), selected.getMonth(), 1);

      input.addEventListener("input", function () {
        this.value = maskDate(this.value);
        syncTypedDate(field);
      });

      input.addEventListener("blur", function () {
        syncTypedDate(field, true);
      });

      input.addEventListener("keydown", function (event) {
        if (event.key === "ArrowDown" || event.keyCode === 40) {
          event.preventDefault();
          openPanel(field);
        }
      });

      toggle.addEventListener("click", function () {
        if (panel.hidden) openPanel(field);
        else closePanel(field);
      });

      renderPanel(field);
    });

    if (document.documentElement.dataset.reportDateOutsideBound !== "true") {
      document.documentElement.dataset.reportDateOutsideBound = "true";
      document.addEventListener("click", function (event) {
        var target = event.target;
        Array.prototype.forEach.call(document.querySelectorAll("[data-date-picker]"), function (field) {
          if (!field.contains(target)) closePanel(field);
        });
      });
    }
  }

  function bindReportValidation() {
    var form = document.getElementById("reportExportForm");
    if (!form || form.dataset.reportDateValidationBound === "true") return;
    form.dataset.reportDateValidationBound = "true";

    form.addEventListener("submit", function (event) {
      var periodSelect = form.querySelector('select[name="period"]');
      if (!periodSelect || periodSelect.value !== "custom") return;

      var start = form.querySelector('input[name="startDate"]');
      var end = form.querySelector('input[name="endDate"]');
      var startDate = start ? parseIsoDate(start.value) : null;
      var endDate = end ? parseIsoDate(end.value) : null;

      if (!startDate || !endDate) {
        event.preventDefault();
        markInvalid("Informe a data inicial e a data final para gerar um relatório personalizado.");
        focusFirstDateInput();
        return;
      }

      if (startDate > endDate) {
        event.preventDefault();
        markInvalid("A data inicial não pode ser maior que a data final.");
        focusFirstDateInput();
        return;
      }

      clearDateFeedback();
    });
  }

  function openPanel(field) {
    var panel = field.querySelector("[data-date-panel]");
    if (!panel) return;
    closeAllPanels(field);
    renderPanel(field);
    panel.hidden = false;
  }

  function closePanel(field) {
    var panel = field.querySelector("[data-date-panel]");
    if (panel) panel.hidden = true;
  }

  function closeAllPanels(exceptField) {
    Array.prototype.forEach.call(document.querySelectorAll("[data-date-picker]"), function (field) {
      if (field !== exceptField) closePanel(field);
    });
  }

  function renderPanel(field) {
    var panel = field.querySelector("[data-date-panel]");
    var hidden = field.querySelector("[data-date-value]");
    if (!panel) return;

    var visible = field._visibleMonth || new Date();
    var year = visible.getFullYear();
    var month = visible.getMonth();
    var selected = parseIsoDate(hidden && hidden.value);
    var todayIso = formatIso(new Date());

    panel.innerHTML = "";
    panel.appendChild(buildHeader(field, year, month));

    var grid = document.createElement("div");
    grid.className = "report-date-grid";

    weekDays.forEach(function (label) {
      var dayName = document.createElement("div");
      dayName.className = "report-date-weekday";
      dayName.textContent = label;
      grid.appendChild(dayName);
    });

    var first = new Date(year, month, 1);
    var start = new Date(year, month, 1 - first.getDay());
    for (var i = 0; i < 42; i += 1) {
      var current = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      var button = document.createElement("button");
      var iso = formatIso(current);
      button.type = "button";
      button.className = "report-date-day";
      button.textContent = String(current.getDate());
      button.setAttribute("data-date", iso);
      if (current.getMonth() !== month) button.className += " is-muted";
      if (selected && iso === formatIso(selected)) button.className += " is-selected";
      if (iso === todayIso) button.className += " is-today";
      button.addEventListener("click", function () {
        chooseDate(field, this.getAttribute("data-date"));
      });
      grid.appendChild(button);
    }

    panel.appendChild(grid);
  }

  function buildHeader(field, year, month) {
    var header = document.createElement("div");
    header.className = "report-date-picker-header";

    var prev = document.createElement("button");
    prev.type = "button";
    prev.className = "btn btn-sm btn-outline-secondary";
    prev.setAttribute("aria-label", "Mês anterior");
    prev.innerHTML = "&lsaquo;";
    prev.addEventListener("click", function () {
      moveMonth(field, -1);
    });

    var title = document.createElement("strong");
    title.textContent = monthNames[month] + " " + year;

    var next = document.createElement("button");
    next.type = "button";
    next.className = "btn btn-sm btn-outline-secondary";
    next.setAttribute("aria-label", "Próximo mês");
    next.innerHTML = "&rsaquo;";
    next.addEventListener("click", function () {
      moveMonth(field, 1);
    });

    header.appendChild(prev);
    header.appendChild(title);
    header.appendChild(next);
    return header;
  }

  function moveMonth(field, delta) {
    var visible = field._visibleMonth || new Date();
    field._visibleMonth = new Date(visible.getFullYear(), visible.getMonth() + delta, 1);
    renderPanel(field);
  }

  function chooseDate(field, iso) {
    var input = field.querySelector("[data-date-display]");
    var hidden = field.querySelector("[data-date-value]");
    var date = parseIsoDate(iso);
    if (!date || !input || !hidden) return;

    hidden.value = formatIso(date);
    input.value = formatBr(date);
    input.classList.remove("is-invalid");
    field._visibleMonth = new Date(date.getFullYear(), date.getMonth(), 1);
    closePanel(field);
    clearDateFeedback();
  }

  function syncTypedDate(field, strict) {
    var input = field.querySelector("[data-date-display]");
    var hidden = field.querySelector("[data-date-value]");
    if (!input || !hidden) return;

    var date = parseBrDate(input.value);
    if (date) {
      hidden.value = formatIso(date);
      input.value = strict ? formatBr(date) : input.value;
      input.classList.remove("is-invalid");
      field._visibleMonth = new Date(date.getFullYear(), date.getMonth(), 1);
      renderPanel(field);
      clearDateFeedback();
      return;
    }

    hidden.value = "";
    input.classList.toggle("is-invalid", strict && input.value.trim().length > 0);
  }

  function maskDate(value) {
    var digits = String(value || "").replace(/\D/g, "").slice(0, 8);
    if (digits.length <= 2) return digits;
    if (digits.length <= 4) return digits.slice(0, 2) + "/" + digits.slice(2);
    return digits.slice(0, 2) + "/" + digits.slice(2, 4) + "/" + digits.slice(4);
  }

  function parseBrDate(value) {
    var match = String(value || "").match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!match) return null;
    return normalizedDate(Number(match[3]), Number(match[2]), Number(match[1]));
  }

  function parseIsoDate(value) {
    var match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return null;
    return normalizedDate(Number(match[1]), Number(match[2]), Number(match[3]));
  }

  function normalizedDate(year, month, day) {
    if (year < 1900 || year > 2200 || month < 1 || month > 12 || day < 1 || day > 31) return null;
    var date = new Date(year, month - 1, day);
    date.setHours(0, 0, 0, 0);
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
    return date;
  }

  function formatIso(date) {
    var value = new Date(date);
    var year = value.getFullYear();
    var month = String(value.getMonth() + 1);
    var day = String(value.getDate());
    if (month.length < 2) month = "0" + month;
    if (day.length < 2) day = "0" + day;
    return year + "-" + month + "-" + day;
  }

  function formatBr(date) {
    var iso = formatIso(date).split("-");
    return iso[2] + "/" + iso[1] + "/" + iso[0];
  }

  function markInvalid(message) {
    var feedback = document.getElementById("reportCustomPeriodFeedback");
    if (feedback) {
      feedback.textContent = message;
      feedback.classList.add("is-visible");
    }
    Array.prototype.forEach.call(document.querySelectorAll("#reportCustomPeriodFields [data-date-display]"), function (input) {
      if (!input.value) input.classList.add("is-invalid");
    });
  }

  function clearCustomDates(container) {
    Array.prototype.forEach.call(container.querySelectorAll("[data-date-display], [data-date-value]"), function (input) {
      input.value = "";
      input.classList.remove("is-invalid");
    });
  }

  function clearDateFeedback() {
    var feedback = document.getElementById("reportCustomPeriodFeedback");
    if (feedback) {
      feedback.textContent = "";
      feedback.classList.remove("is-visible");
    }
    Array.prototype.forEach.call(document.querySelectorAll("#reportCustomPeriodFields [data-date-display]"), function (input) {
      input.classList.remove("is-invalid");
    });
  }

  function focusFirstDateInput() {
    var input = document.querySelector("#reportCustomPeriodFields [data-date-display]");
    if (input) input.focus();
  }

  window.HelpdeskReportDatePicker = { init: initReportDateControls };
  onReady(initReportDateControls);
  document.addEventListener("app:page-ready", initReportDateControls);
})();
