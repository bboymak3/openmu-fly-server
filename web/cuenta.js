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
        <span>→ ${zenFmt(c.nextReset.points)} puntos${c.nextReset.bonus ? ` (${zenFmt(c.nextReset.bonus)} de Master Reset)` : ""}</span>
        ${r.panel ? "" : '<em>Se hace dentro del juego: escribe /reset</em>'}
      </div>`;
  }

  function canMasterReset(c) {
    const m = data.masterReset;
    return !!(m && c.resets >= m.requiredResets && c.level >= m.requiredLevel);
  }

  /** Lo que pide y da el proximo Master Reset. */
  function masterResetInfo(c) {
    const m = data.masterReset;
    if (!m) return "";
    const next = c.masterResets + 1;
    return `
      <div class="reset-box master">
        <strong>Master Reset ${next}</strong>
        <span class="${c.resets >= m.requiredResets ? "ok" : "bad"}">${m.requiredResets} resets (tienes ${c.resets})</span>
        <span class="${c.level >= m.requiredLevel ? "ok" : "bad"}">Nivel ${m.requiredLevel}</span>
        <span>→ +${zenFmt(next * m.bonus)} puntos en cada reset</span>
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
            <div><dt>Master Reset</dt><dd class="gold">${c.masterResets}</dd></div>
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
          ${masterResetInfo(c)}
          <div class="char-actions">
            <button class="btn btn-gold btn-small" data-act="points" data-i="${i}" ${locked || !c.points ? "disabled" : ""}>➕ Add Points</button>
            <button class="btn btn-ghost btn-small" data-act="pk" data-i="${i}" ${locked || !c.isPk ? "disabled" : ""}>🕊 PK Clear</button>
            <button class="btn btn-ghost btn-small" data-act="unstuck" data-i="${i}" ${locked ? "disabled" : ""}>🆘 Desbloquear</button>
            ${data.reset?.panel ? `<button class="btn btn-gold btn-small" data-act="reset" data-i="${i}" ${locked || !canReset(c) ? "disabled" : ""}>🔁 Reset</button>` : ""}
            ${data.masterReset ? `<button class="btn btn-gold btn-small" data-act="master" data-i="${i}" ${locked || !canMasterReset(c) ? "disabled" : ""}>⭐ Master Reset</button>` : ""}
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
      loadRef();
      loadShop();
      loadMarket();
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
    } else if (btn.dataset.act === "master") {
      const m = data.masterReset;
      const next = c.masterResets + 1;
      if (confirm(`¿Hacer el Master Reset ${next} de ${c.name}?\n\nLos resets vuelven a 0, el nivel y las estadísticas al inicio. Recibe ${zenFmt(next * m.bonus)} puntos ahora, y desde entonces cada reset le da ${zenFmt(next * m.bonus)} puntos extra.`)) {
        act("/me/master-reset", c.name);
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


  // ---------- Referidos ----------
  const REF_KEY = "barriomu.ref";
  const savedRef = () => { try { return localStorage.getItem(REF_KEY) || ""; } catch { return ""; } };
  const forgetRef = () => { try { localStorage.removeItem(REF_KEY); } catch {} };
  // Si llego con ?ref=CODIGO a esta pagina, tambien se guarda.
  try {
    const fromUrl = new URLSearchParams(location.search).get("ref");
    if (fromUrl) localStorage.setItem(REF_KEY, fromUrl.trim().toUpperCase());
  } catch {}
  $("#ref-login-hint").hidden = !savedRef();

  let ref = null;
  const STATE = {
    cuenta: '<span class="badge ok">✅ Cuenta</span>',
    espera: '<span class="badge wait">⏳ Mes que viene</span>',
    jugando: '<span class="badge">🎮 Jugando</span>',
  };

  function renderRef() {
    const r = ref;
    document.querySelectorAll('[data-ref="goal"]').forEach(el => (el.textContent = r.goalLevel));
    $("#ref-link").value = r.link;
    $("#ref-code").textContent = r.code;
    const msg = `¡Juega MU conmigo en BarrioMU! Season 6 en el celular o la PC. Entra con mi link y los dos ganamos premios: ${r.link}`;
    $("#ref-whatsapp").href = "https://wa.me/?text=" + encodeURIComponent(msg);
    $("#ref-share").hidden = !navigator.share;
    $("#ref-share").onclick = () => navigator.share({ title: "BarrioMU", text: msg, url: r.link }).catch(() => {});

    $("#ref-count").textContent = r.counted;
    $("#ref-month").textContent = `· ${r.monthCounted} de ${r.monthLimit} este mes`;
    const max = r.milestones[r.milestones.length - 1].at;
    $("#ref-bar").style.width = Math.min(100, (r.counted / max) * 100) + "%";
    $("#ref-marks").innerHTML = r.milestones
      .map(m => `<b class="${r.counted >= m.at ? "on" : ""}" style="left:${(m.at / max) * 100}%">${m.at}</b>`)
      .join("");

    const locked = data?.online === true;
    const card = (m, title, lockText) => {
      const state = m.claimed ? "claimed" : m.unlocked ? "ready" : "locked";
      const action = m.claimed
        ? `<span class="ref-done">✔ Entregado${m.claimed.detail ? ": " + esc(m.claimed.detail) : ""}</span>`
        : m.unlocked
          ? `<button class="btn btn-gold btn-small" data-claim="${m.key}" data-wings="${m.wings ?? ""}" ${locked ? "disabled" : ""}>🎁 Pedir premio</button>`
          : `<span class="ref-lock">🔒 ${lockText ?? `Te faltan ${m.at - r.counted}`}</span>`;
      return `<div class="ref-reward is-${state}"><div class="ref-reward-at">${title}</div><div class="ref-reward-what">${esc(m.label)}</div>${action}</div>`;
    };
    $("#ref-rewards").innerHTML = r.milestones
      .map(m => card(m, `${m.at} ${m.at === 1 ? "amigo" : "amigos"}`))
      .join("");

    // ¿Me invito alguien?
    let invited = "";
    if (r.invitedBy) {
      const w = r.welcome;
      invited = `
        <h3 class="ref-sub">Tu invitación</h3>
        <p class="ref-rule">Entraste invitado por <b>${esc(r.invitedBy.name)}</b>. Al llegar a nivel ${r.goalLevel}, tú también ganas:</p>
        <div class="ref-rewards">${card({ ...w, wings: null }, "Tu premio de bienvenida", `Llega a nivel ${r.goalLevel} (vas en ${r.own.level})`)}</div>`;
    } else if (r.canLink) {
      const days = Math.max(0, Math.ceil((new Date(r.linkDeadline).getTime() - Date.now()) / 86400000));
      invited = `
        <h3 class="ref-sub">¿Te invitó un amigo?</h3>
        <form class="ref-enter" id="ref-enter">
          <input name="code" maxlength="6" placeholder="Código de 6 letras" value="${esc(savedRef())}" autocapitalize="characters" spellcheck="false" />
          <button class="btn btn-gold" type="submit">Activar invitación</button>
        </form>
        <p class="ref-rule small">Solo se pone una vez, antes de llegar a nivel ${r.goalLevel}. Te quedan ${days} ${days === 1 ? "día" : "días"}. Cuando llegues a nivel ${r.goalLevel}, tú y tu amigo ganan premios.</p>`;
    }
    $("#ref-invited").innerHTML = invited;

    $("#ref-friends").innerHTML = r.friends.length
      ? r.friends
          .map(f => `<tr><td><strong>${esc(f.name)}</strong></td><td class="num">${f.level}</td><td class="num">${f.resets}</td><td>${STATE[f.state] ?? ""}</td></tr>`)
          .join("")
      : '<tr><td colspan="4" class="skeleton">Todavía no invitaste a nadie. ¡Comparte tu link!</td></tr>';
    $("#ref-limits").textContent = `Cuenta cuando tu amigo llega a nivel ${r.goalLevel} (o hace un reset). Máximo ${r.monthLimit} amigos por mes y ${r.houseLimit} cuentas por casa.`;
  }

  async function loadRef() {
    try {
      ref = await call("/me/referidos");
      renderRef();
      // Codigo guardado del link: se activa solo si se puede.
      const code = savedRef();
      if (code && ref.canLink) {
        try {
          const res = await call("/me/referidos/codigo", { method: "POST", body: { code } });
          forgetRef();
          toast(res.message);
          ref = await call("/me/referidos");
          renderRef();
        } catch (e) {
          toast(e.message, true);
        }
      } else if (code && !ref.canLink) {
        forgetRef();
      }
    } catch (e) {
      $("#ref-link").value = "No se pudo cargar. Recarga la página.";
    }
  }

  $("#ref-copy").addEventListener("click", async () => {
    const input = $("#ref-link");
    try {
      await navigator.clipboard.writeText(input.value);
    } catch {
      input.select();
      document.execCommand("copy");
    }
    $("#ref-copy").textContent = "✔ ¡Copiado!";
    setTimeout(() => ($("#ref-copy").textContent = "📋 Copiar link"), 2500);
  });

  $("#referidos").addEventListener("submit", async e => {
    if (e.target.id !== "ref-enter") return;
    e.preventDefault();
    const btn = e.target.querySelector("button");
    btn.disabled = true;
    try {
      const res = await call("/me/referidos/codigo", { method: "POST", body: { code: e.target.code.value } });
      forgetRef();
      toast(res.message);
      await loadRef();
    } catch (err) {
      toast(err.message, true);
    } finally {
      btn.disabled = false;
    }
  });

  async function claim(reward, character) {
    try {
      const res = await call("/me/referidos/reclamar", { method: "POST", body: { reward, character } });
      toast(res.message);
      await loadRef();
    } catch (e) {
      toast(e.message, true);
    }
  }

  const wingsDialog = $("#wings-dialog");
  let wingsReward = null;
  $("#referidos").addEventListener("click", e => {
    const btn = e.target.closest("button[data-claim]");
    if (!btn) return;
    const reward = btn.dataset.claim;
    if (btn.dataset.wings) {
      if (!ref.characters.length) return toast("Crea un personaje primero: las alas son de su clase.", true);
      wingsReward = reward;
      $("#wings-char").innerHTML = ref.characters
        .map(c => `<option value="${esc(c.name)}">${esc(c.name)} · ${esc(CLASSES[c.class] ?? "")}</option>`)
        .join("");
      wingsDialog.showModal();
      return;
    }
    if (confirm("¿Pedir el premio ahora?\n\nRecuerda: fuera del juego y con el baúl vacío. Llega a tu baúl.")) claim(reward);
  });
  $("#wings-form").addEventListener("submit", e => {
    if (e.submitter?.value !== "ok") return;
    claim(wingsReward, $("#wings-char").value);
  });


  // ---------- Tienda de puntos ----------
  let shop = null;
  const COINS = {
    puntos: { key: "points", icon: "🪙", name: "puntos" },
    wcoinc: { key: "wcoinc", icon: "💎", name: "WCoinC" },
    wcoinp: { key: "wcoinp", icon: "🔷", name: "WCoinP" },
  };

  function renderShop() {
    const locked = data?.online === true;
    $("#shop-points").textContent = Number(shop.points).toLocaleString("es");
    $("#shop-wcoinc").textContent = Number(shop.wcoinc).toLocaleString("es");
    $("#shop-wcoinp").textContent = Number(shop.wcoinp).toLocaleString("es");
    $("#convert-form button").disabled = locked || !shop.wcoinc;
    $("#rate-label").textContent = `(1 = ${shop.rate ?? 2})`;
    $("#shop-items").innerHTML = shop.items.length
      ? shop.items.map(it => {
          const coin = COINS[it.currency] ?? COINS.puntos;
          const can = (shop[coin.key] ?? 0) >= it.price;
          return `
        <div class="ref-reward shop-item ${can ? "is-ready" : "is-locked"}" data-id="${it.id}">
          <div class="ref-reward-at">${esc(it.label)}</div>
          <div class="ref-reward-what">${coin.icon} ${Number(it.price).toLocaleString("es")} ${coin.name}</div>
          <div class="shop-buy">
            ${it.maxQty > 1 ? `<input type="number" class="shop-qty" min="1" max="${it.maxQty}" value="1" inputmode="numeric" aria-label="Cantidad" />` : ""}
            <button class="btn btn-gold btn-small" data-buy="${it.id}" ${locked || !can ? "disabled" : ""}>Comprar</button>
          </div>
        </div>`;
        }).join("")
      : '<p class="skeleton">La tienda está vacía por ahora.</p>';
    $("#shop-monsters").innerHTML = shop.monsters
      .map(m => `<tr><td>${esc(m.name)}</td><td class="num">🪙 ${m.points}</td></tr>`)
      .join("");
  }

  async function loadShop() {
    try {
      shop = await call("/me/tienda");
      renderShop();
    } catch (e) {
      $("#shop-items").innerHTML = `<p class="skeleton">${esc(e.message)}</p>`;
    }
  }

  $("#convert-form").addEventListener("submit", async e => {
    e.preventDefault();
    const amount = Number(e.target.amount.value);
    if (!amount || amount < 1) return toast("Escribe cuántas WCoinC quieres cambiar.", true);
    const rate = shop?.rate ?? 2;
    if (!confirm(`¿Cambiar ${amount} WCoinC por ${amount * rate} WCoinP?\n\nNo se puede deshacer: WCoinP no vuelve a WCoinC. Debes estar fuera del juego.`)) return;
    const btn = e.target.querySelector("button");
    btn.disabled = true;
    try {
      const res = await call("/me/monedas/convertir", { method: "POST", body: { amount } });
      e.target.reset();
      toast(res.message);
      await loadShop();
    } catch (err) {
      toast(err.message, true);
      btn.disabled = false;
    }
  });

  $("#shop-items").addEventListener("click", async e => {
    const btn = e.target.closest("button[data-buy]");
    if (!btn) return;
    const box = btn.closest(".shop-item");
    const item = shop.items.find(i => i.id === Number(btn.dataset.buy));
    const qty = Number(box.querySelector(".shop-qty")?.value || 1);
    if (!item || qty < 1) return;
    const coinName = (COINS[item.currency] ?? COINS.puntos).name;
    if (!confirm(`¿Comprar ${qty} x ${item.label} por ${(item.price * qty).toLocaleString("es")} ${coinName}?\n\nLlega a tu baúl. Recuerda estar fuera del juego.`)) return;
    btn.disabled = true;
    try {
      const res = await call("/me/tienda/comprar", { method: "POST", body: { id: item.id, qty } });
      toast(res.message);
      await loadShop();
    } catch (err) {
      toast(err.message, true);
      btn.disabled = false;
    }
  });


  // ---------- Mercado ----------
  let mk = null;
  const fmt = n => Number(n).toLocaleString("es");
  const STATES = { active: "🟢 A la venta", sold: "✅ Vendido", cancelled: "↩️ Retirado" };

  function renderMarket() {
    const locked = data?.online === true;
    $("#mk-wcoinp").textContent = fmt(mk.wcoinp);
    $("#mk-tax").textContent = mk.tax;
    const q = $("#mk-search").value.trim().toLowerCase();
    const list = mk.listings.filter(l => !q || l.label.toLowerCase().includes(q));
    $("#mk-listings").innerHTML = list.length
      ? list.map(l => `
        <div class="ref-reward shop-item ${mk.wcoinp >= l.price && !l.mine ? "is-ready" : "is-locked"}">
          <div class="ref-reward-at">${esc(l.label)}</div>
          <div class="ref-reward-what">🔷 ${fmt(l.price)} WCoinP<br /><small class="muted">Vende ${esc(l.seller ?? "—")}</small></div>
          ${l.mine ? '<span class="ref-lock">Es tuyo</span>' : `<button class="btn btn-gold btn-small" data-mk-buy="${l.id}" ${locked || mk.wcoinp < l.price ? "disabled" : ""}>Comprar</button>`}
        </div>`).join("")
      : `<p class="skeleton">${q ? "Nada con ese nombre." : "Todavía nadie vende nada en la Plaza. ¡Sé el primero!"}</p>`;
    $("#mk-vault").innerHTML = mk.vault.length
      ? mk.vault.map(v => `<option value="${v.id}">${esc(v.label)}</option>`).join("")
      : '<option value="">Tu baúl está vacío</option>';
    $("#mk-sell button").disabled = locked || !mk.vault.length;
    updateNet();
    $("#mk-collect").hidden = !mk.pending;
    $("#mk-pending").textContent = fmt(mk.pending);
    $("#mk-collect-btn").disabled = locked;
    $("#mk-mine").innerHTML = mk.mine.length
      ? mk.mine.map(m => `
        <tr>
          <td><strong>${esc(m.label)}</strong><br /><small class="muted">${STATES[m.state] ?? m.state}${m.state === "sold" ? ` · recibes ${fmt(m.proceeds)} (impuesto ${fmt(m.tax)})${m.paid ? " · cobrado" : ""}` : ""}</small></td>
          <td class="num">🔷 ${fmt(m.price)}</td>
          <td>${m.state === "active" ? `<button class="btn btn-ghost btn-small" data-mk-withdraw="${m.id}" ${locked ? "disabled" : ""}>Retirar</button>` : ""}</td>
        </tr>`).join("")
      : '<tr><td class="skeleton">Todavía no vendiste nada.</td></tr>';
  }

  function updateNet() {
    const price = Number($("#mk-sell").price.value) || 0;
    const tax = Math.floor((price * (mk?.tax ?? 25)) / 100);
    $("#mk-net").textContent = price ? `Si se vende recibes ${fmt(price - tax)} WCoinP (impuesto ${fmt(tax)}).` : "";
  }

  async function loadMarket() {
    try {
      mk = await call("/me/mercado");
      renderMarket();
    } catch (e) {
      $("#mk-listings").innerHTML = `<p class="skeleton">${esc(e.message)}</p>`;
    }
  }

  async function mkAct(path, body, btn) {
    if (btn) btn.disabled = true;
    try {
      const res = await call(path, { method: "POST", body });
      toast(res.message);
      await Promise.all([loadMarket(), loadShop()]);
      return true;
    } catch (e) {
      toast(e.message, true);
      if (btn) btn.disabled = false;
      return false;
    }
  }

  document.querySelectorAll("[data-mk]").forEach(tab =>
    tab.addEventListener("click", () => {
      document.querySelectorAll("[data-mk]").forEach(t => t.classList.toggle("is-active", t === tab));
      document.querySelectorAll(".mk-pane").forEach(p => (p.hidden = p.dataset.pane !== tab.dataset.mk));
    }),
  );
  $("#mk-search").addEventListener("input", () => mk && renderMarket());
  $("#mk-sell").price.addEventListener("input", updateNet);

  $("#mk-listings").addEventListener("click", e => {
    const btn = e.target.closest("button[data-mk-buy]");
    if (!btn) return;
    const l = mk.listings.find(x => x.id === Number(btn.dataset.mkBuy));
    if (l && confirm(`¿Comprar ${l.label} por ${fmt(l.price)} WCoinP?\n\nLlega a tu baúl. Debes estar fuera del juego.`)) {
      mkAct("/me/mercado/comprar", { id: l.id }, btn);
    }
  });

  $("#mk-sell").addEventListener("submit", async e => {
    e.preventDefault();
    const f = e.target;
    const item = f.item.value;
    const price = Number(f.price.value);
    const label = f.item.options[f.item.selectedIndex]?.text ?? "";
    if (!item || !price) return;
    if (!confirm(`¿Publicar ${label} por ${fmt(price)} WCoinP?\n\nSale de tu baúl mientras está a la venta. Puedes retirarlo cuando quieras.`)) return;
    if (await mkAct("/me/mercado/vender", { item, price }, f.querySelector("button"))) f.reset();
  });

  $("#mk-mine").addEventListener("click", e => {
    const btn = e.target.closest("button[data-mk-withdraw]");
    if (btn && confirm("¿Retirar este item de la Plaza? Vuelve a tu baúl.")) mkAct("/me/mercado/retirar", { id: Number(btn.dataset.mkWithdraw) }, btn);
  });
  $("#mk-collect-btn").addEventListener("click", e => mkAct("/me/mercado/cobrar", {}, e.target));

  // ---------- Inicio ----------
  if (store.get()) load();
  else showLogin();
})();
