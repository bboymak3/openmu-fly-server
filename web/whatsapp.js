// BarrioMU — pagina de comandos del WhatsApp del Sabio: enlaces y boton para abrir el chat del bot.
(() => {
  const cfg = window.BARRIOMU || {};
  document.querySelectorAll("[data-link]").forEach(a => {
    a.href = cfg[a.dataset.link] || "#";
    if (a.dataset.link === "play") a.target = "_blank";
  });
  const bot = String(cfg.whatsappBot || "").replace(/\D/g, "");
  const open = document.getElementById("wa-open");
  if (bot && open) open.href = `https://wa.me/${bot}?text=${encodeURIComponent("ayuda")}`;
})();
