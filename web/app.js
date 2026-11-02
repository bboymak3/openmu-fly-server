// BarrioMU — landing. Lee la API de la tablet; si la tablet esta apagada, la
// pagina sigue funcionando y lo dice.
(() => {
  const cfg = window.BARRIOMU;
  const $ = sel => document.querySelector(sel);

  // Clases de Season 6 (CharacterClassNumber de OpenMU)
  const CLASSES = {
    0: "Dark Wizard", 2: "Soul Master", 3: "Grand Master",
    4: "Dark Knight", 6: "Blade Knight", 7: "Blade Master",
    8: "Fairy Elf", 10: "Muse Elf", 11: "High Elf",
    12: "Magic Gladiator", 13: "Duel Master",
    16: "Dark Lord", 17: "Lord Emperor",
    20: "Summoner", 22: "Bloody Summoner", 23: "Dimension Master",
    24: "Rage Fighter", 25: "Fist Master",
  };
  const className = n => CLASSES[n] ?? "—";

  const esc = s =>
    String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

  async function api(path) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    try {
      const res = await fetch(cfg.api + path, { signal: ctrl.signal });
      if (!res.ok) throw new Error(res.status);
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }

  // ---------- Links y menu ----------
  document.querySelectorAll("[data-link]").forEach(a => {
    a.href = cfg[a.dataset.link];
    if (a.dataset.link === "play") a.target = "_blank";
  });
  // Ventana de la version para PC: la abren los botones con data-pc-modal.
  const pcModal = $("#pc-modal");
  const closePc = () => {
    pcModal.close();
  };
  pcModal.addEventListener("close", () => document.body.classList.remove("modal-open"));
  document.querySelectorAll("[data-pc-modal]").forEach(btn =>
    btn.addEventListener("click", e => {
      e.preventDefault();
      document.body.classList.add("modal-open");
      pcModal.showModal();
    }),
  );
  pcModal.querySelectorAll("[data-close]").forEach(btn => btn.addEventListener("click", closePc));
  // Tocar fuera de la ventana la cierra.
  pcModal.addEventListener("click", e => {
    if (e.target !== pcModal) return;
    const r = pcModal.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) closePc();
  });
  if (location.hash === "#pc") {
    document.body.classList.add("modal-open");
    pcModal.showModal();
  }

  const toggle = $(".menu-toggle");
  const menu = $(".menu");
  toggle.addEventListener("click", () => {
    const open = menu.classList.toggle("is-open");
    toggle.setAttribute("aria-expanded", String(open));
  });
  menu.addEventListener("click", e => {
    if (e.target.closest("a")) menu.classList.remove("is-open");
  });

  // ---------- Caracteristicas, reglas y comunidad ----------
  $("#features").innerHTML = cfg.features
    .map(f => `<div class="card feature"><span class="icon">${f.icon}</span><div><h4>${esc(f.title)}</h4><p>${esc(f.text)}</p></div></div>`)
    .join("");
  $("#rules").innerHTML = cfg.rules.map(r => `<li>${esc(r)}</li>`).join("");

  const ICONS = {
    discord:
      '<svg viewBox="0 0 24 24"><path d="M20.3 4.4A19.8 19.8 0 0 0 15.4 3l-.6 1.3a18.4 18.4 0 0 0-5.6 0L8.6 3a19.7 19.7 0 0 0-4.9 1.4C.6 9 .0 13.5.3 18a19.9 19.9 0 0 0 6 3l1.3-2a12.9 12.9 0 0 1-2-1l.5-.4a14.2 14.2 0 0 0 12 0l.5.4a12.8 12.8 0 0 1-2 1l1.3 2a19.8 19.8 0 0 0 6-3c.5-5.2-.8-9.7-3.6-13.6ZM8.7 15.3c-1.2 0-2.1-1-2.1-2.3s.9-2.3 2.1-2.3 2.1 1 2.1 2.3-.9 2.3-2.1 2.3Zm6.6 0c-1.2 0-2.1-1-2.1-2.3s.9-2.3 2.1-2.3 2.1 1 2.1 2.3-.9 2.3-2.1 2.3Z"/></svg>',
    whatsapp:
      '<svg viewBox="0 0 24 24"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm5.8 14.2c-.2.7-1.4 1.3-2 1.4-.5.1-1.2.1-1.9-.1a17 17 0 0 1-1.8-.7 13.9 13.9 0 0 1-5.3-4.7c-.4-.6-1-1.6-1-3s.7-2.1 1-2.4c.3-.3.6-.4.8-.4h.6c.2 0 .4 0 .6.5l.9 2.1c.1.2.1.4 0 .6l-.3.5-.4.5c-.2.2-.3.3-.1.6.2.3.8 1.3 1.7 2.1 1.2 1 2.2 1.4 2.5 1.5.3.2.5.1.7-.1l.9-1.1c.2-.3.4-.2.7-.1l2 1c.3.1.5.2.6.3.1.2.1.9-.1 1.6Z"/></svg>',
  };
  $("#floating").innerHTML = ["discord", "whatsapp"]
    .filter(k => cfg[k])
    .map(k => `<a class="${k}" href="${esc(cfg[k])}" target="_blank" rel="noopener" aria-label="${k}">${ICONS[k]}</a>`)
    .join("");

  // ---------- Noticias ----------
  fetch("news.json")
    .then(r => r.json())
    .then(items => {
      const fmt = new Intl.DateTimeFormat("es", { day: "numeric", month: "long", year: "numeric" });
      $("#news").innerHTML = items
        .map(n => `
          <article class="card post">
            <div class="meta"><span class="tag">${esc(n.tag)}</span><span>${fmt.format(new Date(n.date + "T12:00:00"))}</span></div>
            <h3>${esc(n.title)}</h3>
            <p>${esc(n.text)}</p>
          </article>`)
        .join("");
    })
    .catch(() => ($("#news").innerHTML = '<p class="skeleton">No hay noticias por ahora.</p>'));

  // ---------- Estado del servidor ----------
  const SERVERS = [
    { name: "MIJAGUA", pvp: true, drop: "Normal" },
    { name: "ALTOBARINAS", pvp: false, drop: "Doble" },
  ];

  function renderServers(data) {
    const online = !!data?.online;
    const pill = $("#status-pill");
    pill.className = "status-pill " + (online ? "is-online" : "is-offline");
    const total = data?.players;
    pill.querySelector("span").textContent = online
      ? total == null ? "Servidor en línea" : `Servidor en línea · ${total} jugando`
      : "Servidor en mantenimiento";

    const list = data?.servers ?? SERVERS;
    $("#servers").innerHTML = list
      .map(s => `
        <div class="card server ${online ? "is-online" : ""}">
          <span class="dot"></span>
          <h3>${esc(s.name)}</h3>
          <div class="players">${online ? (s.players ?? "—") : "—"}<small>${online ? "jugando" : "fuera de línea"}</small></div>
          <div class="badges">
            ${s.pvp ? '<span class="badge pvp">⚔ PvP</span>' : '<span class="badge safe">🛡 Sin PvP</span>'}
            <span class="badge drop">💎 Drop ${esc(s.drop)}</span>
          </div>
        </div>`)
      .join("");
  }

  async function loadStatus() {
    try {
      renderServers(await api("/status"));
    } catch {
      renderServers(null);
    }
  }
  loadStatus();
  setInterval(loadStatus, 30000);

  // ---------- Eventos ----------
  // Si la API no responde: el horario por defecto de OpenMU (cada 4 horas, en UTC).
  const DEFAULT_EVENTS = [
    { name: "Blood Castle", from: 1 },
    { name: "Devil Square", from: 0 },
    { name: "Chaos Castle", from: 2 },
  ].map(e => {
    const next = [];
    const now = Date.now();
    const base = new Date();
    base.setUTCHours(0, 0, 0, 0);
    for (let h = e.from; next.length < 3 && h < 48; h += 4) {
      const t = base.getTime() + h * 3600000;
      if (t > now) next.push(new Date(t).toISOString());
    }
    return { name: e.name, active: true, next };
  });

  let events = [];
  const hhmm = new Intl.DateTimeFormat("es", { hour: "2-digit", minute: "2-digit" });

  function renderEvents() {
    const now = Date.now();
    $("#events").innerHTML = events
      .filter(e => e.active)
      .map(e => {
        const next = e.next.map(t => new Date(t).getTime()).filter(t => t > now);
        if (!next.length) return "";
        const left = next[0] - now;
        const h = Math.floor(left / 3600000);
        const m = Math.floor((left % 3600000) / 60000);
        const s = Math.floor((left % 60000) / 1000);
        const pad = n => String(n).padStart(2, "0");
        return `
          <div class="card event ${left < 15 * 60000 ? "is-soon" : ""}">
            <h3>${esc(e.name)}</h3>
            <div class="countdown">${pad(h)}:${pad(m)}:${pad(s)}</div>
            <div class="when">Empieza a las ${hhmm.format(next[0])}${next[1] ? ` · luego ${hhmm.format(next[1])}` : ""}</div>
          </div>`;
      })
      .join("");
  }

  async function loadEvents() {
    try {
      events = await api("/events");
    } catch {
      events = DEFAULT_EVENTS;
    }
    renderEvents();
  }
  loadEvents();
  setInterval(renderEvents, 1000);
  setInterval(loadEvents, 10 * 60000);

  // ---------- Ultimos ganadores ----------
  const ago = iso => {
    const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
    if (min < 60) return `hace ${min} min`;
    const h = Math.round(min / 60);
    if (h < 48) return `hace ${h} h`;
    return `hace ${Math.round(h / 24)} días`;
  };
  const TROPHY = { "Blood Castle": "🏰", "Devil Square": "😈", "Chaos Castle": "⚔️" };

  async function loadWinners() {
    try {
      const rows = await api("/events/winners?limit=8");
      $("#winners").innerHTML = rows.length
        ? rows
            .map(w => `
          <li>
            <span class="trophy">${TROPHY[w.event] ?? "🏆"}</span>
            <span class="who"><strong>${esc(w.name)}</strong><small>${esc(w.event)} ${esc(w.level)} · ${esc(className(w.class))} · ${esc(w.score)} puntos</small></span>
            <span class="ago">${w.at ? ago(w.at) : ""}</span>
          </li>`)
            .join("")
        : '<li class="skeleton">Todavía no hay ganadores. ¡Entra al próximo evento!</li>';
    } catch {
      $("#winners").innerHTML = '<li class="skeleton">El servidor está fuera de línea.</li>';
    }
  }
  loadWinners();
  setInterval(loadWinners, 5 * 60000);

  // ---------- Rankings ----------
  const RANKINGS = {
    level: {
      path: "/rankings/level?limit=50",
      head: ["#", "Personaje", "Clase", "MR", "Resets", "Nivel", "Master"],
      row: r => [r.masterResets ?? 0, r.resets, r.level, r.masterLevel],
      podium: r => [r.masterResets ? `${r.masterResets} MR` : "", r.resets ? `${r.resets} RR` : "", `Nivel ${r.level}`].filter(Boolean).join(" · "),
    },
    guilds: {
      path: "/rankings/guilds?limit=50",
      head: ["#", "Guild", "Miembros", "Puntaje", "Nivel total"],
      row: r => [r.score, r.totalLevel],
      cls: r => `${r.members} miembros`,
      podium: r => `${r.score} puntos`,
    },
    pvp: {
      path: "/rankings/pvp?limit=50",
      head: ["#", "Personaje", "Clase", "Asesinatos", "Nivel"],
      row: r => [r.kills, r.level],
      podium: r => `${r.kills} asesinatos`,
    },
  };
  let current = "level";

  async function loadRanking(kind) {
    const def = RANKINGS[kind];
    $("#ranking-head").innerHTML = `<tr>${def.head.map((h, i) => `<th class="${i > 2 ? "num" : ""}">${h}</th>`).join("")}</tr>`;
    $("#ranking-body").innerHTML = `<tr><td colspan="${def.head.length}" class="skeleton">Cargando…</td></tr>`;
    $("#podium").innerHTML = "";
    $("#ranking-note").textContent = "";
    try {
      const rows = await api(def.path);
      if (current !== kind) return;
      if (!rows.length) {
        $("#ranking-body").innerHTML = `<tr><td colspan="${def.head.length}" class="skeleton">Todavía no hay nadie aquí. ¡Sé el primero!</td></tr>`;
        return;
      }
      const medals = ["🥇", "🥈", "🥉"];
      const top = rows.slice(0, 3);
      // En pantalla: 2do, 1ro, 3ro
      $("#podium").innerHTML = [top[1], top[0], top[2]]
        .map((r, i) => (r ? `
          <div class="card place p${r.rank}">
            <div class="medal">${medals[r.rank - 1]}</div>
            <div class="name">${esc(r.name)}</div>
            <div class="cls">${esc(def.cls ? def.cls(r) : className(r.class))}</div>
            <div class="value">${esc(def.podium(r))}</div>
          </div>` : "<div></div>"))
        .join("");
      $("#ranking-body").innerHTML = rows
        .map(r => `
          <tr>
            <td class="rank">${r.rank}</td>
            <td><strong>${esc(r.name)}</strong></td>
            <td>${def.cls ? `<span class="num">${r.members}</span>` : `<span class="class-tag">${esc(className(r.class))}</span>`}</td>
            ${def.row(r).map(v => `<td class="num">${esc(v)}</td>`).join("")}
          </tr>`)
        .join("");
      $("#ranking-note").textContent = "Se actualiza cada minuto.";
    } catch {
      $("#ranking-body").innerHTML = `<tr><td colspan="${def.head.length}" class="skeleton">El servidor está fuera de línea. Vuelve en un rato.</td></tr>`;
    }
  }

  document.querySelectorAll(".tab").forEach(tab =>
    tab.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach(t => t.classList.toggle("is-active", t === tab));
      current = tab.dataset.ranking;
      loadRanking(current);
    }),
  );
  loadRanking(current);
})();
