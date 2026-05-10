(function () {
  function onReady(callback) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", callback);
    } else {
      callback();
    }
  }

  onReady(bindOnce);
  document.addEventListener("app:page-ready", bindOnce);

  function bindOnce() {
    if (document.documentElement.dataset.hardwareModalsBound === "true") return;
    document.documentElement.dataset.hardwareModalsBound = "true";

    document.addEventListener("click", function (event) {
      var editButton = closest(event.target, ".btn-edit-hw");
      if (editButton) {
        event.preventDefault();
        handleEdit(editButton);
        return;
      }

      var moveButton = closest(event.target, ".btn-move-hw");
      if (moveButton) {
        event.preventDefault();
        handleMove(moveButton);
        return;
      }

      var deleteButton = closest(event.target, ".btn-delete-hw");
      if (deleteButton) {
        event.preventDefault();
        handleDelete(deleteButton);
      }
    });
  }

  function handleEdit(button) {
    try {
      var hw = parseData(button.getAttribute("data-hw"));
      var usfs = parseData(button.getAttribute("data-usfs") || "[]");
      if (usfs.length) openAdminEditModal(hw, usfs);
      else openTechEditModal(hw);
    } catch (error) {
      showModalError("Não foi possível abrir a edição do equipamento.");
    }
  }

  function handleMove(button) {
    try {
      var id = Number(button.getAttribute("data-id"));
      var patrimonio = button.getAttribute("data-patrimonio") || "";
      var usfs = parseData(button.getAttribute("data-usfs") || "[]");
      openMoveModal(id, patrimonio, usfs);
    } catch (error) {
      showModalError("Não foi possível abrir a movimentação do equipamento.");
    }
  }

  function handleDelete(button) {
    var id = Number(button.getAttribute("data-id"));
    var patrimonio = button.getAttribute("data-patrimonio") || "";
    var form = document.getElementById("formDelete");
    var label = document.getElementById("deletePatrimonio");
    if (!form || !label) return;

    form.action = "/hardware/" + id + "/delete";
    label.textContent = patrimonio;
    showModal("modalDelete");
  }

  function openAdminEditModal(hw, usfs) {
    var form = document.getElementById("formEdit");
    var body = document.getElementById("editModalBody");
    if (!form || !body) return;

    form.action = "/hardware/" + hw.id + "/update";
    body.innerHTML = [
      field("Patrimônio <span class=\"text-muted fw-normal small\">(opcional)</span>", "<input type=\"text\" name=\"patrimonio\" class=\"form-control\" value=\"" + escapeHtml(hw.patrimonio || "") + "\">"),
      field("USF *", "<select name=\"usfId\" class=\"form-select\" required>" + usfs.map(function (usf) {
        return "<option value=\"" + usf.id + "\" " + (Number(usf.id) === Number(hw.usfId) ? "selected" : "") + ">" + escapeHtml(usf.nome) + "</option>";
      }).join("") + "</select>"),
      field("Sala *", roomSelect(hw.sala)),
      field("Tipo *", "<input type=\"text\" name=\"tipo\" class=\"form-control\" value=\"" + escapeHtml(hw.tipo || "") + "\" required>"),
      field("Modelo", "<input type=\"text\" name=\"modelo\" class=\"form-control\" value=\"" + escapeHtml(hw.modelo || "") + "\">"),
      field("AnyDesk", "<input type=\"text\" name=\"anydesk\" class=\"form-control\" value=\"" + escapeHtml(hw.anydesk || "") + "\">"),
      field("Status", statusSelect(hw.status)),
      field("Observações", "<textarea name=\"observacoes\" class=\"form-control\" rows=\"3\">" + escapeHtml(hw.observacoes || "") + "</textarea>"),
    ].join("");

    showModal("modalEdit");
  }

  function openTechEditModal(hw) {
    var form = document.getElementById("formEdit");
    var body = document.getElementById("editModalBody");
    if (!form || !body) return;

    form.action = "/hardware/" + hw.id + "/update";
    body.innerHTML = [
      "<div class=\"alert alert-info\"><i class=\"bi bi-info-circle\"></i> Como técnico, você pode editar apenas o <strong>AnyDesk</strong> e o <strong>Status</strong>.</div>",
      field("Patrimônio", "<input type=\"text\" class=\"form-control\" value=\"" + escapeHtml(hw.patrimonio || "") + "\" disabled>"),
      field("USF", "<input type=\"text\" class=\"form-control\" value=\"" + escapeHtml(hw.usf && hw.usf.nome ? hw.usf.nome : "") + "\" disabled>"),
      field("Tipo", "<input type=\"text\" class=\"form-control\" value=\"" + escapeHtml(hw.tipo || "") + "\" disabled>"),
      field("Modelo", "<input type=\"text\" class=\"form-control\" value=\"" + escapeHtml(hw.modelo || "-") + "\" disabled>"),
      "<hr>",
      field("AnyDesk", "<input type=\"text\" name=\"anydesk\" class=\"form-control\" value=\"" + escapeHtml(hw.anydesk || "") + "\" placeholder=\"Digite o código AnyDesk\">"),
      field("Status", statusSelect(hw.status)),
    ].join("");

    showModal("modalEdit");
  }

  function openMoveModal(id, patrimonio, usfs) {
    var form = document.getElementById("formMove");
    var label = document.getElementById("movePatrimonio");
    var select = document.getElementById("moveUsfSelect");
    if (!form || !label || !select) return;

    form.action = "/hardware/" + id + "/move";
    label.textContent = patrimonio;
    select.innerHTML = "<option value=\"\">Selecione...</option>" + usfs.map(function (usf) {
      return "<option value=\"" + usf.id + "\">" + escapeHtml(usf.nome) + "</option>";
    }).join("");

    showModal("modalMove");
  }

  function statusSelect(current) {
    var statuses = [
      ["ATIVO", "Ativo"],
      ["MANUTENCAO", "Manutenção"],
      ["PERCA_TOTAL", "Perca Total"],
    ];
    return "<select name=\"status\" class=\"form-select\">" + statuses.map(function (item) {
      return "<option value=\"" + item[0] + "\" " + (current === item[0] ? "selected" : "") + ">" + item[1] + "</option>";
    }).join("") + "</select>";
  }

  function roomSelect(current) {
    var rooms = [
      ["RECEPCAO", "Recepção"],
      ["ENFERMAGEM", "Enfermagem"],
      ["MEDICO", "Médico"],
      ["REUNIAO", "Reunião"],
      ["VACINA", "Vacina"],
      ["TRIAGEM", "Triagem"],
    ];
    return "<select name=\"sala\" class=\"form-select\" required>" + rooms.map(function (item) {
      return "<option value=\"" + item[0] + "\" " + (current === item[0] ? "selected" : "") + ">" + item[1] + "</option>";
    }).join("") + "</select>";
  }

  function field(label, control) {
    return "<div class=\"mb-3\"><label class=\"form-label\">" + label + "</label>" + control + "</div>";
  }

  function parseData(raw) {
    return JSON.parse(decodeHtml(raw || "null"));
  }

  function decodeHtml(text) {
    var textarea = document.createElement("textarea");
    textarea.innerHTML = text;
    return textarea.value;
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function showModal(id) {
    var element = document.getElementById(id);
    if (!element || !window.bootstrap) return;
    new window.bootstrap.Modal(element).show();
  }

  function showModalError(message) {
    if (window.HelpdeskApp && window.HelpdeskApp.showFlash) {
      window.HelpdeskApp.showFlash({ error: [message], success: [], info: [] });
    } else {
      alert(message);
    }
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
})();
