// BarrioMU — Cash Shop (WCoinC). Catalogo publico (/cashshop); con sesion iniciada compra
// directo (/me/cashshop/comprar). La sesion es la misma de Mi cuenta (sessionStorage).
(() => {
  const cfg = window.BARRIOMU || {};
  const $ = s => document.querySelector(s);
  const TOKEN_KEY = "barriomu.token";
  const esc = s =>
    String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const fmt = n => Number(n ?? 0).toLocaleString("es");

  document.querySelectorAll("[data-link]").forEach(a => {
    a.href = cfg[a.dataset.link] || "#";
    if (a.dataset.link === "play") a.target = "_blank";
  });

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
      res = await fetch(cfg.api + path, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15000) });
    } catch {
      throw new Error("El servidor no responde ahora mismo (apagado o actualizándose). Vuelve en un rato.");
    }
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && path !== "/auth/login") { store.clear(); me = null; renderAccount(); }
    if (!res.ok) throw new Error(data.error || "Algo salió mal.");
    return data;
  }

  let toastTimer;
  function toast(msg, bad = false) {
    const el = $("#toast");
    el.textContent = msg;
    el.classList.toggle("is-bad", bad);
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (el.hidden = true), 8000);
    el.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  const LINE_ICON = { alas: "🪽", mision: "📜", cofre: "🎁" };
  let shop = { lines: [], items: [], wcoinc: null };
  let me = null; // { account, online }
  let line = "todo";
  let loadError = "";

  function renderAccount() {
    $("#cs-guest").hidden = !!me;
    $("#cs-user").hidden = !me;
    if (me) {
      $("#cs-name").textContent = me.account;
      $("#cs-wcoinc").textContent = shop.wcoinc == null ? "—" : fmt(shop.wcoinc);
      $("#cs-online").hidden = me.online !== true;
    }
  }

  function renderLines() {
    const tabs = [{ id: "todo", label: "Todo" }, ...shop.lines];
    $("#cs-lines").innerHTML = tabs
      .map(t => `<button class="tab ${t.id === line ? "is-active" : ""}" data-line="${t.id}" type="button">${LINE_ICON[t.id] ?? "✨"} ${esc(t.label)}</button>`)
      .join("");
  }

  function card(it) {
    const left = it.boughtToday == null ? it.dailyCap : Math.max(it.dailyCap - it.boughtToday, 0);
    const canPay = shop.wcoinc == null || shop.wcoinc >= it.price;
    const locked = !!me && (me.online === true || !left || !canPay);
    const icon = it.icon
      ? `<img class="cs-icon" src="assets/items/${esc(it.icon)}.webp" alt="" loading="lazy" />`
      : `<span class="cs-icon cs-icon-emoji">${LINE_ICON[it.line] ?? "✨"}</span>`;
    const why = !me ? "" : me.online ? "Sal del juego" : !left ? "Límite de hoy alcanzado" : !canPay ? `Te faltan ${fmt(it.price - shop.wcoinc)} WCoinC` : "";
    return `
      <div class="ref-reward shop-item cs-item ${it.line === "cofre" ? "is-chest" : ""} ${locked ? "is-locked" : "is-ready"}">
        ${icon}
        <div class="ref-reward-at">${esc(it.label)}</div>
        <div class="ref-reward-what">💎 ${fmt(it.price)} WCoinC</div>
        <div class="cs-cap">Máx. ${it.dailyCap} por día${me ? ` · te quedan ${left}` : ""}</div>
        <div class="shop-buy">
          ${it.dailyCap > 1 && left > 1 ? `<input type="number" class="shop-qty" min="1" max="${left}" value="1" inputmode="numeric" aria-label="Cantidad" data-qty="${it.id}" />` : ""}
          <button class="btn btn-gold btn-small" data-buy="${it.id}" type="button" ${locked ? "disabled" : ""}>${it.line === "cofre" ? "Abrir" : "Comprar"}</button>
        </div>
        ${why ? `<div class="cs-why">${esc(why)}</div>` : ""}
      </div>`;
  }

  function renderItems() {
    const list = shop.items.filter(it => line === "todo" || it.line === line);
    $("#cs-items").innerHTML = list.length
      ? list.map(card).join("")
      : `<p class="skeleton">${esc(loadError || "Nada a la venta aquí por ahora.")}</p>`;
  }

  function render() {
    renderAccount();
    renderLines();
    renderItems();
  }

  async function load() {
    // Primero la cuenta; si el Cash Shop con sesion falla, igual se ve el catalogo publico.
    if (store.get()) {
      try {
        const who = await call("/me");
        me = { account: who.account, online: who.online };
      } catch (e) {
        me = null;
        if (store.get()) $("#cs-login-msg").textContent = e.message;
      }
    }
    loadError = "";
    try {
      shop = me ? await call("/me/cashshop") : { ...(await call("/cashshop")), wcoinc: null };
    } catch (e) {
      try {
        shop = { ...(await call("/cashshop")), wcoinc: null };
      } catch {
        // sin catalogo: se dice abajo
      }
      if (!shop.items.length) loadError = "El Cash Shop todavía no está listo en el servidor (se está actualizando). Vuelve en un rato.";
      else toast(e.message, true);
    }
    render();
  }

  $("#cs-lines").addEventListener("click", e => {
    const b = e.target.closest("[data-line]");
    if (!b) return;
    line = b.dataset.line;
    renderLines();
    renderItems();
  });

  $("#cs-items").addEventListener("click", async e => {
    const btn = e.target.closest("[data-buy]");
    if (!btn) return;
    if (!me) {
      $("#cs-login").scrollIntoView({ behavior: "smooth", block: "center" });
      $("#cs-login").username.focus();
      $("#cs-login-msg").textContent = "Entra con tu cuenta para comprar.";
      return;
    }
    const it = shop.items.find(i => i.id === Number(btn.dataset.buy));
    if (!it) return;
    const qty = Math.max(1, Number(document.querySelector(`[data-qty="${it.id}"]`)?.value || 1));
    const total = it.price * qty;
    const what = it.line === "cofre" ? `abrir ${qty === 1 ? "1 cofre sorpresa" : `${qty} cofres sorpresa`}` : `comprar ${qty} x ${it.label}`;
    if (!confirm(`¿Quieres ${what} por ${fmt(total)} WCoinC?\n\nDebes estar fuera del juego. Llega a tu baúl.`)) return;
    btn.disabled = true;
    try {
      const res = await call("/me/cashshop/comprar", { method: "POST", body: { id: it.id, qty } });
      showResult(res);
      toast(res.message);
      await load();
    } catch (err) {
      toast(err.message, true);
      btn.disabled = false;
    }
  });

  function showResult(res) {
    const box = $("#cs-result");
    if (!res.results?.length) { box.hidden = true; return; }
    box.innerHTML = `
      <div class="ref-head"><h2>🎁 ¡Te salió!</h2></div>
      ${res.results.map(r => `
        <div class="cs-roll tier-${esc(r.tier).normalize("NFD").replace(/[^a-z]/gi, "").toLowerCase()}">
          <span class="cs-tier">${esc(r.tier)}</span>
          <b>${esc(r.name)}</b>
          ${r.options.length ? `<ul>${r.options.map(o => `<li>${esc(o)}</li>`).join("")}</ul>` : ""}
        </div>`).join("")}
      <p class="ref-rule small">Ya está en tu baúl.</p>`;
    box.hidden = false;
  }

  $("#cs-login").addEventListener("submit", async e => {
    e.preventDefault();
    const f = e.target;
    const btn = f.querySelector("button");
    btn.disabled = true;
    $("#cs-login-msg").textContent = "";
    try {
      const res = await call("/auth/login", { method: "POST", body: { username: f.username.value.trim(), password: f.password.value } });
      if (!res.token) throw new Error("No se pudo entrar. Intenta de nuevo.");
      store.set(res.token);
      f.reset();
      await load();
      if (me) toast(`¡Hola ${me.account}! Ya puedes comprar.`);
    } catch (err) {
      $("#cs-login-msg").textContent = err.message;
    } finally {
      btn.disabled = false;
    }
  });

  $("#cs-logout").addEventListener("click", () => {
    call("/auth/logout", { method: "POST" }).catch(() => {});
    store.clear();
    me = null;
    load();
  });

  load();
})();
