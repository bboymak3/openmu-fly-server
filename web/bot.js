// BarrioMU — pagina "Conectate a nuestro bot": la guia de Telegram y la de WhatsApp, cada una
// plegada; la guia de uso es una sola (<template id="guia">) y se copia en las dos con su nombre.
(() => {
  const cfg = window.BARRIOMU || {};
  document.querySelectorAll("[data-link]").forEach(a => {
    a.href = cfg[a.dataset.link] || "#";
    if (a.dataset.link === "play") a.target = "_blank";
  });

  const guia = document.getElementById("guia");
  document.querySelectorAll("[data-guide]").forEach(box => {
    box.appendChild(guia.content.cloneNode(true));
    box.querySelectorAll("[data-app]").forEach(e => (e.textContent = box.dataset.guide));
    // Lo que es solo de una app (los avisos y el chat con el juego son solo por Telegram).
    box.querySelectorAll("[data-only]").forEach(e => e.dataset.only !== box.dataset.guide && e.remove());
  });

  const telegram = String(cfg.telegramBot || "").replace(/^@/, "").replace(/[^A-Za-z0-9_]/g, "");
  if (telegram) {
    document.querySelector("[data-tg-open]").hidden = false;
    document.querySelector("[data-tg-link]").href = `https://t.me/${telegram}`;
  }
  const whatsapp = String(cfg.whatsappBot || "").replace(/\D/g, "");
  if (whatsapp) {
    document.querySelector("[data-wa-open]").hidden = false;
    document.querySelector("[data-wa-link]").href = `https://wa.me/${whatsapp}?text=ayuda`;
  } else {
    document.querySelector("[data-wa-paused]").hidden = false;
    document.querySelector("[data-wa-state]").textContent = "En pausa por ahora · toca para ver la guía";
  }

  // Solo una abierta a la vez; un enlace con #telegram o #whatsapp la abre de una.
  const picks = [...document.querySelectorAll(".bot-pick")];
  picks.forEach(d => d.addEventListener("toggle", () => {
    if (d.open) picks.forEach(o => o !== d && (o.open = false));
  }));
  const wanted = document.getElementById(location.hash.slice(1));
  if (wanted && wanted.classList.contains("bot-pick")) wanted.open = true;
})();
