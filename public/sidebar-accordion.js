document.addEventListener("DOMContentLoaded", function () {
  var accordionHeader = document.getElementById("monitoringAccordion");
  var accordionContent = document.getElementById("monitoringContent");
  if (!accordionHeader || !accordionContent) return;

  var isCollapsed = localStorage.getItem("monitoringAccordionCollapsed") === "true";
  accordionHeader.classList.toggle("collapsed", isCollapsed);
  accordionContent.classList.toggle("collapsed", isCollapsed);

  accordionHeader.addEventListener("click", function () {
    var collapsed = accordionHeader.classList.toggle("collapsed");
    accordionContent.classList.toggle("collapsed", collapsed);
    localStorage.setItem("monitoringAccordionCollapsed", collapsed);
  });
});
