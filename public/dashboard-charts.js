(function () {
  var activeCharts = [];

  function onReady(callback) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", callback);
    } else {
      callback();
    }
  }

  function initDashboardCharts() {
    var chartDataEl = document.getElementById("chartDataJson");
    if (!chartDataEl) return;

    destroyCharts();

    var chartData = {};
    try {
      chartData = JSON.parse(chartDataEl.textContent || "{}");
    } catch (error) {
      chartData = {};
    }

    var usfData = chartData.byUsf || [];
    var trendData = chartData.trendData || [];
    var categoryData = chartData.categoryChart || [];
    var slaByUnitData = chartData.slaByUnitChart || [];

    createBarChart("myBarChart", usfData.map(function (d) { return d.usfName; }), usfData.map(function (d) { return d.count; }), "Chamados", "#2563eb", true);
    createLineChart("trendChart", trendData);
    createDoughnutChart("categoryChart", categoryData);
    createBarChart("slaByUnitChart", slaByUnitData.map(function (d) { return d.label; }), slaByUnitData.map(function (d) { return d.value; }), "SLA %", "#16a34a", true, 100);

    bindReportControls();
  }

  function bindReportControls() {
    var periodFilter = document.getElementById("periodFilter");
    if (periodFilter && periodFilter.dataset.bound !== "true") {
      periodFilter.dataset.bound = "true";
      periodFilter.addEventListener("change", function () {
        var url = "/reports?period=" + encodeURIComponent(this.value);
        if (window.HelpdeskApp && window.HelpdeskApp.visit) window.HelpdeskApp.visit(url, { push: true });
        else window.location.href = url;
      });
    }

    var advancedFields = document.getElementById("advancedReportFields");
    var modeInput = document.getElementById("reportModeInput");
    var modeButtons = document.querySelectorAll("input[name='reportModeToggle']");
    Array.prototype.forEach.call(modeButtons, function (button) {
      if (button.dataset.bound === "true") return;
      button.dataset.bound = "true";
      button.addEventListener("change", function () {
        if (!advancedFields || !modeInput) return;
        var advanced = this.value === "advanced";
        modeInput.value = this.value;
        advancedFields.classList.toggle("d-none", !advanced);
      });
    });
  }

  function destroyCharts() {
    activeCharts.forEach(function (chart) {
      if (chart && typeof chart.destroy === "function") chart.destroy();
    });
    activeCharts = [];
  }

  function trackChart(chart) {
    if (chart) activeCharts.push(chart);
  }

  function createBarChart(canvasId, labels, data, label, color, horizontal, max) {
    var canvas = document.getElementById(canvasId);
    if (!canvas || !window.Chart || !labels.length) return;

    trackChart(new window.Chart(canvas.getContext("2d"), {
      type: "bar",
      data: {
        labels: labels,
        datasets: [{
          label: label,
          data: data,
          backgroundColor: color,
          hoverBackgroundColor: color,
          borderColor: color,
          borderWidth: 1,
        }],
      },
      options: {
        indexAxis: horizontal ? "y" : "x",
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: { beginAtZero: true, max: max || undefined },
          y: { beginAtZero: true, max: horizontal ? undefined : max || undefined, grid: { display: !horizontal } },
        },
        plugins: { legend: { display: false } },
      },
    }));
  }

  function createLineChart(canvasId, trendData) {
    var canvas = document.getElementById(canvasId);
    if (!canvas || !window.Chart || !trendData.length) return;

    var labels = trendData.map(function (d) {
      return new Date(d.dia).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
    });

    trackChart(new window.Chart(canvas.getContext("2d"), {
      type: "line",
      data: {
        labels: labels,
        datasets: [
          { label: "Total", data: trendData.map(function (d) { return d.total_chamados; }), borderColor: "#2563eb", backgroundColor: "rgba(37,99,235,.12)", tension: 0.3, fill: true },
          { label: "Urgentes", data: trendData.map(function (d) { return d.urgentes; }), borderColor: "#dc2626", backgroundColor: "rgba(220,38,38,.08)", tension: 0.3, fill: true },
          { label: "Resolvidos", data: trendData.map(function (d) { return d.resolvidos; }), borderColor: "#16a34a", backgroundColor: "rgba(22,163,74,.08)", tension: 0.3, fill: true },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: { y: { beginAtZero: true, ticks: { precision: 0 } } },
      },
    }));
  }

  function createDoughnutChart(canvasId, data) {
    var canvas = document.getElementById(canvasId);
    if (!canvas || !window.Chart || !data.length) return;

    trackChart(new window.Chart(canvas.getContext("2d"), {
      type: "doughnut",
      data: {
        labels: data.map(function (d) { return d.label; }),
        datasets: [{
          data: data.map(function (d) { return d.value; }),
          backgroundColor: ["#2563eb", "#16a34a", "#f59e0b", "#dc2626", "#7c3aed", "#0891b2"],
          borderWidth: 2,
          borderColor: "#ffffff",
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { position: "bottom" } },
      },
    }));
  }

  window.HelpdeskDashboardCharts = { init: initDashboardCharts };
  onReady(initDashboardCharts);
  document.addEventListener("app:page-ready", initDashboardCharts);
})();
