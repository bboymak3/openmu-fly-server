// BarrioMU — panel de usuario. Habla con la API de la tablet (babylon/api/panel.ts).
(() => {
  const cfg = window.BARRIOMU;
  const $ = sel => document.querySelector(sel);
  const TOKEN_KEY = "barriomu.token";

  const CLASSES = {
    0: "Dark Wizard", 2: "Soul Master", 3: "Grand Master",
    4: "Dark Knight", 6: "Blade Knight", 7: "Blade Master",
    8: "Fairy Elf", 10: "Muse Elf", 11: "High Elf",
    12: "Magic Gladiator", 13: "Duel Master",
    16: "Dark Lord", 17: "Lord Emperor",
    20: "Summoner", 22: "Bloody Summoner", 23: "Dimension Master",
    24: "Rage Fighter", 25: "Fist Master",
  };
  const MAPS = {
    0: "Lorencia", 1: "Dungeon", 2: "Devias", 3: "Noria", 4: "Lost Tower", 6: "Arena", 7: "Atlans",
    8: "Tarkan", 10: "Icarus", 30: "Valle de Loren", 33: "Aida", 34: "Crywolf", 37: "Kanturu",
    38: "Kanturu", 39: "Kanturu", 51: "Elbeland", 56: "Swamp of Calmness", 57: "Raklion",
    58: "Raklion", 63: "Vulcanus", 79: "Loren Market", 80: "Karutan", 81: "Karutan",
  };
  const STAT_LABELS = { str: "Fuerza", agi: "Agilidad", vit: "Vitalidad", ene: "Energía", cmd: "Comando" };

  const esc = s =>
    String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

  document.querySelectorAll("[data-link]").forEach(a => (a.href = cfg[a.dataset.link]));

  const store = {
    get: () => { try { return sessionStorage.getItem(TOKEN_KEY); } catch { return null; } },
    set: v => { try { sessionStorage.setItem(TOKEN_KEY, v); } catch {} },
    clear: () => { try { sessionStorage.removeItem(TOKEN_KEY); } catch {} },
  };

  async function call(path, { method = "GET", body } = {}) {
    const headers = { "Content-Type": "application/json" };
    const token = store.get();
    if (token) headers.Authorization = "Bearer " + token;
    let res;
    try {
      res = await fetch(cfg.api + path, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(15000),
      });
    } catch {
      throw new Error("No se pudo conectar con el servidor. ¿Está en mantenimiento?");
    }
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && path !== "/auth/login") {
      store.clear();
      showLogin(data.error);
    }
    if (!res.ok) throw new Error(data.error || "Algo salió mal.");
    return data;
  }

  // ---------- Vistas ----------
  function showLogin(message = "") {
    $("#panel-view").hidden = true;
    $("#login-view").hidden = false;
    $("#login-msg").textContent = message;
  }

  let toastTimer;
  function toast(message, bad = false) {
    const el = $("#toast");
    el.textContent = message;
    el.className = "toast" + (bad ? " is-bad" : "");
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (el.hidden = true), 7000);
    el.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  let data = null;

  const zenFmt = n => Number(n).toLocaleString("es");

  function canReset(c) {
    const r = data.reset;
    return !!(r && c.nextReset && c.level >= r.requiredLevel && Number(c.zen) >= c.nextReset.zen && !(r.limit && c.nextReset.next > r.limit));
  }

  /** Lo que pide y da el proximo reset de este personaje. */
  function resetInfo(c) {
    const r = data.reset;
    if (!r || !c.nextReset) return "";
    const lvl = c.level >= r.requiredLevel ? "ok" : "bad";
    const zen = Number(c.zen) >= c.nextReset.zen ? "ok" : "bad";
    return `
      <div class="reset-box">
        <strong>Reset ${c.nextReset.next}</strong>
        <span class="${lvl}">Nivel ${r.requiredLevel}</span>
        <span class="${zen}">${zenFmt(c.nextReset.zen)} zen</span>
        <span>→ ${zenFmt(c.nextReset.points)} puntos</span>
        ${r.panel ? "" : '<em>Se hace dentro del juego: escribe /reset</em>'}
      </div>`;
  }

  function render() {
    $("#login-view").hidden = true;
    $("#panel-view").hidden = false;
    $("#account-name").textContent = data.account;
    $("#online-notice").hidden = data.online !== true;
    const locked = data.online === true;

    $("#chars").innerHTML = data.characters.length
      ? data.characters
          .map((c, i) => `
        <article class="card char">
          <div class="char-head">
            <div>
              <h3>${esc(c.name)}</h3>
              <span class="class-tag">${esc(CLASSES[c.class] ?? "—")}</span>
              ${c.isPk ? '<span class="badge pvp">PK</span>' : ""}
            </div>
            <div class="char-level"><b>${c.level}</b><small>nivel</small></div>
          </div>
          <dl class="char-stats">
            <div><dt>Master</dt><dd>${c.masterLevel}</dd></div>
            <div><dt>Resets</dt><dd>${c.resets}</dd></div>
            <div><dt>Asesinatos</dt><dd>${c.kills}</dd></div>
            <div><dt>Mapa</dt><dd>${esc(MAPS[c.map] ?? (c.map == null ? "—" : "Mapa " + c.map))}</dd></div>
            <div><dt>Fuerza</dt><dd>${c.str}</dd></div>
            <div><dt>Agilidad</dt><dd>${c.agi}</dd></div>
            <div><dt>Vitalidad</dt><dd>${c.vit}</dd></div>
            <div><dt>Energía</dt><dd>${c.ene}</dd></div>
            ${c.cmd != null ? `<div><dt>Comando</dt><dd>${c.cmd}</dd></div>` : ""}
            <div><dt>Puntos libres</dt><dd class="gold">${c.points}</dd></div>
            <div><dt>Zen</dt><dd>${Number(c.zen).toLocaleString("es")}</dd></div>
          </dl>
          ${resetInfo(c)}
          <div class="char-actions">
            <button class="btn btn-gold btn-small" data-act="points" data-i="${i}" ${locked || !c.points ? "disabled" : ""}>➕ Add Points</button>
            <button class="btn btn-ghost btn-small" data-act="pk" data-i="${i}" ${locked || !c.isPk ? "disabled" : ""}>🕊 PK Clear</button>
            <button class="btn btn-ghost btn-small" data-act="unstuck" data-i="${i}" ${locked ? "disabled" : ""}>🆘 Desbloquear</button>
            ${data.reset?.panel ? `<button class="btn btn-gold btn-small" data-act="reset" data-i="${i}" ${locked || !canReset(c) ? "disabled" : ""}>🔁 Reset</button>` : ""}
          </div>
        </article>`)
          .join("")
      : '<p class="skeleton">Esta cuenta todavía no tiene personajes. Entra al juego y crea uno.</p>';

    $("#password-form").querySelector("button").disabled = locked;
  }

  async function load() {
    try {
      data = await call("/me");
      render();
    } catch (e) {
      if (!$("#panel-view").hidden) toast(e.message, true);
      else showLogin(store.get() ? e.message : "");
    }
  }

  // ---------- Login / salir ----------
  $("#login-form").addEventListener("submit", async e => {
    e.preventDefault();
    const form = e.target;
    const btn = form.querySelector("button");
    btn.disabled = true;
    $("#login-msg").textContent = "";
    try {
      const res = await call("/auth/login", {
        method: "POST",
        body: { username: form.username.value.trim(), password: form.password.value },
      });
      store.set(res.token);
      form.reset();
      await load();
    } catch (err) {
      $("#login-msg").textContent = err.message;
    } finally {
      btn.disabled = false;
    }
  });

  $("#logout").addEventListener("click", async () => {
    await call("/auth/logout", { method: "POST" }).catch(() => {});
    store.clear();
    data = null;
    showLogin();
  });

  // ---------- Acciones de personaje ----------
  async function act(path, character, body = {}) {
    try {
      const res = await call(path, { method: "POST", body: { character, ...body } });
      toast(res.message);
      await load();
    } catch (e) {
      toast(e.message, true);
    }
  }

  $("#chars").addEventListener("click", e => {
    const btn = e.target.closest("button[data-act]");
    if (!btn) return;
    const c = data.characters[Number(btn.dataset.i)];
    if (btn.dataset.act === "pk") {
      if (confirm(`¿Limpiar el estado PK de ${c.name}?`)) act("/me/pk-clear", c.name);
    } else if (btn.dataset.act === "unstuck") {
      if (confirm(`¿Mandar a ${c.name} a su ciudad de inicio?`)) act("/me/unstuck", c.name);
    } else if (btn.dataset.act === "reset") {
      const n = c.nextReset;
      if (confirm(`¿Hacer el reset ${n.next} de ${c.name}?\n\nCuesta ${zenFmt(n.zen)} zen. Vuelve a nivel inicial, las estadísticas vuelven a cero y recibe ${zenFmt(n.points)} puntos para repartir.`)) {
        act("/me/reset", c.name);
      }
    } else if (btn.dataset.act === "points") {
      openPoints(c);
    }
  });

  // ---------- Repartir puntos ----------
  const dialog = $("#points-dialog");
  let pointsChar = null;

  function openPoints(c) {
    pointsChar = c;
    $("#points-char").textContent = c.name;
    const keys = ["str", "agi", "vit", "ene", ...(c.cmd != null ? ["cmd"] : [])];
    $("#points-grid").innerHTML = keys
      .map(k => `
        <label>${STAT_LABELS[k]} <small>(${c[k]})</small>
          <input type="number" name="${k}" min="0" max="${c.points}" step="1" value="0" inputmode="numeric" />
        </label>`)
      .join("");
    updateLeft();
    dialog.showModal();
  }

  function updateLeft() {
    const used = [...$("#points-grid").querySelectorAll("input")].reduce((s, i) => s + (parseInt(i.value, 10) || 0), 0);
    const left = pointsChar.points - used;
    $("#points-left").textContent = left;
    $("#points-left").classList.toggle("bad", left < 0);
    $("#points-ok").disabled = left < 0 || used === 0;
  }

  $("#points-grid").addEventListener("input", updateLeft);

  $("#points-form").addEventListener("submit", e => {
    if (e.submitter?.value !== "ok") return;
    const body = {};
    $("#points-grid").querySelectorAll("input").forEach(i => {
      const n = parseInt(i.value, 10) || 0;
      if (n > 0) body[i.name] = n;
    });
    act("/me/add-points", pointsChar.name, body);
  });

  // ---------- Cambiar clave ----------
  $("#password-form").addEventListener("submit", async e => {
    e.preventDefault();
    const f = e.target;
    if (f.next.value !== f.again.value) return toast("Las claves nuevas no coinciden.", true);
    const btn = f.querySelector("button");
    btn.disabled = true;
    try {
      const res = await call("/me/password", { method: "POST", body: { current: f.current.value, next: f.next.value } });
      f.reset();
      toast(res.message);
    } catch (err) {
      toast(err.message, true);
    } finally {
      btn.disabled = false;
    }
  });

  // ---------- Inicio ----------
  if (store.get()) load();
  else showLogin();
})();
