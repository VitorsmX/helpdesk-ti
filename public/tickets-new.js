(function () {
  function onReady(callback) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", callback);
    } else {
      callback();
    }
  }

  function initTicketLocationForm() {
    var dataEl = document.getElementById("ticketLocationsData");
    var formEl = document.getElementById("ticketLocationForm");
    var usfSelect = document.getElementById("ticketUsfSelect");
    var sectorSelect = document.getElementById("ticketSectorSelect");
    var roomSelect = document.getElementById("ticketRoomSelect");
    var legacyRoomSelect = document.getElementById("ticketLegacyRoomSelect");
    var managedGroups = document.querySelectorAll(".location-managed");
    var legacyGroups = document.querySelectorAll(".location-legacy");

    if (!dataEl || !formEl || !sectorSelect || !roomSelect || !legacyRoomSelect) return;
    if (formEl.dataset.locationFormBound === "true") return;
    formEl.dataset.locationFormBound = "true";

    var locations = [];
    try {
      locations = JSON.parse(dataEl.textContent || "[]");
    } catch (error) {
      locations = [];
    }

    function currentUsfId() {
      return usfSelect && usfSelect.value
        ? Number(usfSelect.value)
        : Number(formEl.getAttribute("data-current-usf"));
    }

    function setManagedMode(enabled) {
      Array.prototype.forEach.call(managedGroups, function (group) {
        group.classList.toggle("d-none", !enabled);
      });
      Array.prototype.forEach.call(legacyGroups, function (group) {
        group.classList.toggle("d-none", enabled);
      });
      sectorSelect.required = enabled;
      roomSelect.required = enabled;
      legacyRoomSelect.required = !enabled;
      if (enabled) legacyRoomSelect.value = "OUTRO";
    }

    function fillSectors() {
      var usfId = currentUsfId();
      var sectors = locations.filter(function (sector) {
        return Number(sector.usfId) === usfId;
      });

      sectorSelect.innerHTML = '<option value="">Selecione...</option>';
      roomSelect.innerHTML = '<option value="">Selecione...</option>';

      if (!usfId || sectors.length === 0) {
        setManagedMode(false);
        return;
      }

      setManagedMode(true);
      sectors.forEach(function (sector) {
        var option = document.createElement("option");
        option.value = String(sector.id);
        option.textContent = sector.nome;
        sectorSelect.appendChild(option);
      });
    }

    function fillRooms() {
      var sectorId = Number(sectorSelect.value);
      var sector = null;
      for (var i = 0; i < locations.length; i += 1) {
        if (Number(locations[i].id) === sectorId) {
          sector = locations[i];
          break;
        }
      }
      roomSelect.innerHTML = '<option value="">Selecione...</option>';

      if (!sector) return;

      sector.rooms.forEach(function (room) {
        var option = document.createElement("option");
        option.value = String(room.id);
        option.textContent = room.nome;
        option.dataset.legacyRoom = room.legacyRoom || "OUTRO";
        roomSelect.appendChild(option);
      });
    }

    function syncLegacyRoom() {
      var selected = roomSelect.options[roomSelect.selectedIndex];
      if (selected && selected.dataset.legacyRoom) {
        legacyRoomSelect.value = selected.dataset.legacyRoom;
      }
    }

    if (usfSelect) usfSelect.addEventListener("change", fillSectors);
    sectorSelect.addEventListener("change", fillRooms);
    roomSelect.addEventListener("change", syncLegacyRoom);

    fillSectors();
  }

  window.HelpdeskTicketsNew = { init: initTicketLocationForm };
  onReady(initTicketLocationForm);
  document.addEventListener("app:page-ready", initTicketLocationForm);
})();
