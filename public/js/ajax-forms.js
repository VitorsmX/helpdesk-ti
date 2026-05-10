document.addEventListener("submit", async (event) => {
  if (event.defaultPrevented) return;

  const form = event.target.closest(".js-ajax-form");

  if (!form) return;

  event.preventDefault();

  const submitButton = form.querySelector('[type="submit"]');

  if (submitButton) {
    submitButton.disabled = true;
  }

  try {
    const csrfInput = form.querySelector('input[name="_csrf"]');
    const csrfMeta = document.querySelector('meta[name="csrf-token"]');
    const csrfToken = csrfInput?.value || csrfMeta?.getAttribute("content") || "";

    const response = await fetch(form.action, {
      method: form.method || "POST",
      body: new URLSearchParams(new FormData(form)),
      headers: {
        "X-App-Form": "true",
        "X-Requested-With": "XMLHttpRequest",
        ...(csrfToken ? { "X-CSRF-Token": csrfToken } : {}),
        Accept: "application/json",
      },
      credentials: "same-origin",
    });

    const data = await response.json();

    if (data.ok && data.redirect) {
      if (window.HelpdeskApp && window.HelpdeskApp.visit) {
        window.HelpdeskApp.visit(data.redirect, {
          push: true,
          flash: data.flash,
          replaceFlash: true,
        });
        return;
      }
      window.location.href = data.redirect;
      return;
    }

    showFlashMessages(data.flash);
  } catch (error) {
    console.error("Erro AJAX:", error);

    alert(
      "Erro ao processar solicitação. Recarregue a página e tente novamente.",
    );
  } finally {
    if (submitButton) {
      submitButton.disabled = false;
    }
  }
});

function showFlashMessages(flash) {
  if (!flash) return;

  const messages = [
    ...(flash.error || []),
    ...(flash.success || []),
    ...(flash.info || []),
  ];

  if (messages.length > 0) {
    alert(messages.join("\n"));
  }
}
