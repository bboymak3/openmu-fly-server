// BarrioMU — tienda en linea publica. Lee el catalogo de la API de la tablet (/tienda);
// si no responde, muestra el catalogo de referencia para que la pagina nunca quede vacia.
(() => {
  const cfg = window.BARRIOMU || {};
  const $ = s => document.querySelector(s);
  const esc = s =>
    String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

  document.querySelectorAll("[data-link]").forEach(a => {
    a.href = cfg[a.dataset.link] || "#";
    if (a.dataset.link === "play") a.target = "_blank";
  });

  // Lo mismo que trae la tienda al estrenarse (babylon/api/tienda.ts, SEED con enabled).
  const FALLBACK = [
    ["Jewel of Bless", 10], ["Jewel of Soul", 10], ["Jewel of Chaos", 15], ["Jewel of Life", 25], ["Jewel of Creation", 30],
    ["Wings of Heaven (Dark Wizard)", 300], ["Wings of Satan (Dark Knight, Magic Gladiator)", 300],
    ["Wings of Elf (Fairy Elf)", 300], ["Wings of Curse (Summoner)", 300],
    ["Wings of Soul (Dark Wizard)", 800], ["Wings of Dragon (Dark Knight)", 800], ["Wings of Spirits (Fairy Elf)", 800],
    ["Wings of Darkness (Magic Gladiator)", 800], ["Wings of Despair (Summoner)", 800],
    ["Cape of Lord (Dark Lord)", 800], ["Cape of Fighter (Rage Fighter)", 800],
  ].map(([label, price]) => ({ label, price, currency: "puntos", level: 0 }));

  const COINS = { puntos: ["🪙", "puntos"], wcoinc: ["💎", "WCoinC"] };
  const card = it => {
    const [icon, name] = COINS[it.currency] ?? COINS.puntos;
    return `
      <div class="ref-reward shop-item is-ready">
        <div class="ref-reward-at">${esc(it.label)}${it.level ? ` +${it.level}` : ""}</div>
        <div class="ref-reward-what">${icon} ${Number(it.price).toLocaleString("es")} ${name}</div>
        <div class="shop-buy"><a class="btn btn-gold btn-small" href="cuenta.html#tienda">Comprar</a></div>
      </div>`;
  };

  function render(items) {
    const by = c => items.filter(it => (it.currency || "puntos") === c);
    const p = by("puntos");
    const w = by("wcoinc");
    $("#items-puntos").innerHTML = p.length ? p.map(card).join("") : '<p class="skeleton">Nada a la venta con puntos por ahora.</p>';
    $("#box-wcoinc").hidden = !w.length;
    $("#items-wcoinc").innerHTML = w.map(card).join("");
  }

  async function load() {
    try {
      const res = await fetch((cfg.api || "") + "/tienda", { signal: AbortSignal.timeout(10000) });
      if (!res.ok) throw new Error(res.status);
      const data = await res.json();
      render(data.items || []);
      if (data.rate) $("#rate").textContent = data.rate;
      $("#monsters").innerHTML = (data.monsters || []).length
        ? data.monsters.map(m => `<tr><td>${esc(m.name)}</td><td class="num">🪙 ${m.points}</td></tr>`).join("")
        : '<tr><td class="skeleton">Sin datos por ahora.</td></tr>';
    } catch {
      render(FALLBACK);
      const note = $("#shop-note");
      note.hidden = false;
      note.textContent = "El servidor no responde ahora mismo (apagado o actualizándose): estos son los precios de referencia.";
      $("#monsters").innerHTML = '<tr><td class="skeleton">El servidor no responde ahora mismo. Vuelve en un rato.</td></tr>';
    }
  }
  load();
})();
