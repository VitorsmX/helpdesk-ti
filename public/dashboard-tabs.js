(function () {
  function onReady(callback) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", callback);
    } else {
      callback();
    }
  }

  function initDashboardTabs() {
    var tabButtons = document.querySelectorAll(".dashboard-tabs .nav-link");
    Array.prototype.forEach.call(tabButtons, function (button) {
      if (button.dataset.dashboardTabBound === "true") return;
      button.dataset.dashboardTabBound = "true";

      button.addEventListener("click", function (event) {
        event.preventDefault();

        var tabPanels = document.querySelectorAll(".tab-pane");
        Array.prototype.forEach.call(tabButtons, function (btn) {
          btn.classList.remove("active");
        });
        Array.prototype.forEach.call(tabPanels, function (panel) {
          panel.classList.remove("show", "active");
        });

        this.classList.add("active");

        var targetId = this.getAttribute("data-bs-target");
        var targetPanel = document.querySelector(targetId);
        if (targetPanel) {
          targetPanel.classList.add("show", "active");
        }
      });
    });
  }

  window.HelpdeskDashboardTabs = { init: initDashboardTabs };
  onReady(initDashboardTabs);
  document.addEventListener("app:page-ready", initDashboardTabs);
})();
