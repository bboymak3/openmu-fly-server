// BarrioMU — panel admin. Habla con la API de la tablet (babylon/api/admin.ts).
(() => {
  const cfg = window.BARRIOMU;
  const $ = sel => document.querySelector(sel);
  const TOKEN_KEY = "barriomu.admin";

  const esc = s =>
    String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const num = n => (n == null ? "—" : Number(n).toLocaleString("es"));
  const gb = b => (b == null ? "—" : b >= 1e9 ? `${(b / 1e9).toLocaleString("es", { maximumFractionDigits: 1 })} GB` : `${Math.round(b / 1e6).toLocaleString("es")} MB`);

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
      res = await fetch(cfg.api + path, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30000) });
    } catch {
      throw new Error("No se pudo conectar con la tablet. ¿Está prendida?");
    }
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && path !== "/admin/login") {
      store.clear();
      showLogin(data.error);
    }
    if (!res.ok) throw new Error(data.error || "Algo salió mal.");
    return data;
  }

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
    toastTimer = setTimeout(() => (el.hidden = true), 9000);
    el.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  // ---------- Paises ----------
  let regionNames = null;
  try { regionNames = new Intl.DisplayNames(["es"], { type: "region" }); } catch {}
  const flag = code =>
    /^[A-Z]{2}$/.test(code) ? String.fromCodePoint(...[...code].map(c => 0x1f1e6 + c.charCodeAt(0) - 65)) : "🌐";
  const countryName = code => {
    if (!/^[A-Z]{2}$/.test(code)) return "Desconocido";
    try { return regionNames?.of(code) ?? code; } catch { return code; }
  };

  // ---------- Graficos de barras (una serie: sin leyenda, el titulo la nombra) ----------
  const tip = $("#chart-tip");
  const dayFmt = new Intl.DateTimeFormat("es", { day: "numeric", month: "short", timeZone: "UTC" });
  const longFmt = new Intl.DateTimeFormat("es", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });

  function barChart(el, title, rows, key) {
    const max = Math.max(1, ...rows.map(r => r[key]));
    const total = rows.reduce((s, r) => s + r[key], 0);
    // Rejilla en numeros redondos.
    const step = max <= 4 ? 1 : Math.ceil(max / 4);
    const top = step * Math.ceil(max / step);
    const lines = [];
    for (let v = 0; v <= top; v += step) lines.push(v);
    const peak = rows.reduce((b, r, i) => (r[key] > rows[b][key] ? i : b), 0);
    el.innerHTML = `
      <figcaption><strong>${esc(title)}</strong><span>${num(total)} en 14 días</span></figcaption>
      <div class="bars" role="img" aria-label="${esc(title)}: ${num(total)} en 14 días">
        <div class="bars-grid">${lines.map(v => `<span style="bottom:${(v / top) * 100}%"><i>${v}</i></span>`).join("")}</div>
        ${rows
          .map((r, i) => {
            const v = r[key];
            const label = (i === peak && v > 0) || i === rows.length - 1 ? `<b>${v}</b>` : "";
            return `<div class="bar-col" data-day="${r.day}" data-value="${v}" tabindex="0">
              <div class="bar" style="height:${(v / top) * 100}%">${label}</div>
            </div>`;
          })
          .join("")}
      </div>
      <div class="bars-x">${rows.map((r, i) => `<span>${i % 2 === rows.length % 2 ? "" : esc(dayFmt.format(new Date(r.day + "T12:00:00Z")))}</span>`).join("")}</div>
      <details class="chart-table"><summary>Ver tabla</summary>
        <table><thead><tr><th>Día</th><th class="num">${esc(title)}</th></tr></thead>
        <tbody>${rows.map(r => `<tr><td>${esc(dayFmt.format(new Date(r.day + "T12:00:00Z")))}</td><td class="num">${r[key]}</td></tr>`).join("")}</tbody></table>
      </details>`;
    const show = col => {
      const r = col.getBoundingClientRect();
      tip.innerHTML = `<span>${esc(longFmt.format(new Date(col.dataset.day + "T12:00:00Z")))}</span><strong>${col.dataset.value}</strong>`;
      tip.hidden = false;
      const w = tip.offsetWidth;
      tip.style.left = `${Math.min(window.innerWidth - w - 8, Math.max(8, r.left + r.width / 2 - w / 2))}px`;
      tip.style.top = `${r.top + window.scrollY - tip.offsetHeight - 8}px`;
      el.querySelectorAll(".bar-col").forEach(c => c.classList.toggle("is-hover", c === col));
    };
    const hide = () => {
      tip.hidden = true;
      el.querySelectorAll(".bar-col").forEach(c => c.classList.remove("is-hover"));
    };
    el.querySelectorAll(".bar-col").forEach(col => {
      col.addEventListener("pointerenter", () => show(col));
      col.addEventListener("focus", () => show(col));
      col.addEventListener("pointerleave", hide);
      col.addEventListener("blur", hide);
    });
  }

  function countryList(title, data) {
    if (!data || !data.countries.length) {
      return `<div class="card countries"><h3>${esc(title)}</h3><p class="muted">Sin visitas en las últimas 24 horas.</p></div>`;
    }
    const max = Math.max(...data.countries.map(c => c.count));
    return `<div class="card countries">
      <h3>${esc(title)} <span>${num(data.total)}</span></h3>
      <ol>${data.countries
        .slice(0, 12)
        .map(c => `<li title="${esc(countryName(c.country))}: ${c.count}">
          <span class="c-name">${flag(c.country)} ${esc(countryName(c.country))}</span>
          <span class="c-bar"><i style="width:${(c.count / max) * 100}%"></i></span>
          <span class="c-num">${num(c.count)}</span>
        </li>`)
        .join("")}</ol>
    </div>`;
  }

  // ---------- Render ----------
  function render(d) {
    $("#login-view").hidden = true;
    $("#panel-view").hidden = false;
    $("#admin-name").textContent = d.account;
    $("#updated").textContent = "Actualizado: " + new Date(d.updated).toLocaleString("es");

    const g = d.game;
    const servers = (g.servers ?? []).map(s => `<small>${esc(s.name)}: ${g.online ? num(s.players) : "—"}</small>`).join("");
    const cache = d.cloudflare?.cache;
    const hitPct = cache && cache.requests ? Math.round((cache.cached / cache.requests) * 100) : null;
    const tiles = [
      { label: "Jugando ahora", value: g.online ? num(g.players) : "Apagado", sub: servers, state: g.online ? "ok" : "bad" },
      { label: "Cuentas", value: num(g.accounts), sub: `<small>Hoy: ${num(g.accountsToday)}</small><small>7 días: ${num(g.accounts7d)}</small>` },
      { label: "Personajes", value: num(g.characters), sub: `<small>Hoy: ${num(g.charactersToday)}</small><small>Baneadas: ${num(g.banned)}</small>` },
      { label: "Descargas PC", value: num(d.downloads?.total), sub: "<small>BarrioMU-Setup.exe</small>" },
      {
        label: "Caché (24 h)",
        value: hitPct == null ? "—" : `${hitPct}%`,
        sub: cache ? `<small>${gb(cache.bytesCached)} desde Cloudflare</small><small>${gb(cache.bytes - cache.bytesCached)} desde la tablet</small>` : "<small>Sin datos de Cloudflare</small>",
      },
    ];
    $("#tiles").innerHTML = tiles
      .map(t => `<div class="card tile ${t.state ? "is-" + t.state : ""}"><span class="tile-label">${esc(t.label)}</span><strong>${t.value}</strong><div class="tile-sub">${t.sub}</div></div>`)
      .join("");

    barChart($("#chart-accounts"), "Cuentas nuevas", g.days, "accounts");
    barChart($("#chart-characters"), "Personajes nuevos", g.days, "characters");

    const cf = d.cloudflare ?? {};
    if (!cf.configured) {
      $("#cf-box").innerHTML = `<div class="card cf-setup">
        <h3>Falta conectar Cloudflare</h3>
        <ol>
          <li>En <b>dash.cloudflare.com</b> → tu perfil (arriba a la derecha) → <b>Mi perfil → Tokens de API → Crear token</b> → <b>Crear token personalizado</b>.</li>
          <li>Permisos (3 filas): <b>Zona · Zona · Leer</b>, <b>Zona · Analytics · Leer</b> y <b>Zona · Purgar caché · Purgar</b>.</li>
          <li>Recursos de zona: <b>Incluir · Zona específica · makeseo.app</b>. Crea el token y cópialo.</li>
          <li>En Termius (Termux normal): <code>bash ~/barriomu.sh cloudflare</code> y pega el token. <b>No se lo mandes a nadie.</b></li>
          <li>Vuelve aquí y toca <b>↻ Actualizar</b>.</li>
        </ol>
      </div>`;
    } else if (cf.error) {
      $("#cf-box").innerHTML = `<div class="card cf-setup is-bad"><h3>Cloudflare respondió con un error</h3><p class="muted">${esc(cf.error)}</p>
        <p class="muted">Revisa que el token tenga los 3 permisos para makeseo.app y vuelve a guardarlo con <code>bash ~/barriomu.sh cloudflare</code>.</p></div>`;
    } else {
      $("#cf-box").innerHTML = `<div class="countries-grid">
        ${countryList("Visitas a la landing", cf.landing)}
        ${countryList("Entradas al juego", cf.game)}
      </div>`;
    }

    $("#cache-stats").innerHTML = cache
      ? `<p><strong>${hitPct}%</strong> de los archivos del juego salieron de Cloudflare en las últimas 24 horas (${num(cache.cached)} de ${num(cache.requests)}).</p>`
      : `<p class="muted">Conecta Cloudflare para ver cuánto ahorra la caché.</p>`;
    $("#purge").disabled = !cf.configured;

    $("#top").innerHTML = g.top.length
      ? g.top.map((r, i) => `<tr><td class="rank">${i + 1}</td><td><strong>${esc(r.name)}</strong></td><td class="num">${r.masterResets}</td><td class="num">${r.resets}</td><td class="num">${r.level}</td></tr>`).join("")
      : `<tr><td colspan="5" class="skeleton">Todavía no hay jugadores.</td></tr>`;
  }

  async function load() {
    $("#refresh").disabled = true;
    try {
      const stats = call("/admin/stats");
      loadShop();
      loadCash();
      loadSabio();
      loadEconomy();
      loadAudit();
      render(await stats);
    } catch (e) {
      if (!$("#panel-view").hidden) toast(e.message, true);
      else showLogin(store.get() ? e.message : "");
    } finally {
      $("#refresh").disabled = false;
    }
  }

  // ---------- Acciones ----------
  $("#login-form").addEventListener("submit", async e => {
    e.preventDefault();
    const form = e.target;
    const btn = form.querySelector("button");
    btn.disabled = true;
    $("#login-msg").textContent = "";
    try {
      const res = await call("/admin/login", { method: "POST", body: { username: form.username.value.trim(), password: form.password.value } });
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
    await call("/admin/logout", { method: "POST" }).catch(() => {});
    store.clear();
    showLogin();
  });

  $("#refresh").addEventListener("click", load);

  async function purge(everything) {
    const ask = everything
      ? "¿Borrar la caché de TODO makeseo.app?\n\nNo rompe nada: Cloudflare la vuelve a llenar sola a medida que la gente entra."
      : "¿Borrar la caché del juego (mu.makeseo.app)?\n\nHazlo después de actualizar el cliente del celular.";
    if (!confirm(ask)) return;
    const btn = everything ? $("#purge-all") : $("#purge");
    btn.disabled = true;
    try {
      const res = await call("/admin/purge", { method: "POST", body: { everything } });
      toast(res.message, !res.ok);
      $("#purge-all").hidden = !res.canPurgeEverything;
    } catch (e) {
      toast(e.message, true);
    } finally {
      btn.disabled = false;
    }
  }
  $("#purge").addEventListener("click", () => purge(false));
  $("#purge-all").addEventListener("click", () => purge(true));


  // ---------- El Sabio del Barrio (IA) ----------
  async function loadSabio() {
    try {
      const d = await call("/admin/sabio");
      const f = $("#sabio-form");
      f.on.checked = d.on;
      f.waOn.checked = d.waOn !== false;
      if (![...f.daily.options].some(o => Number(o.value) === d.daily)) f.daily.add(new Option(String(d.daily), String(d.daily)));
      f.daily.value = String(d.daily);
      f.periodo.value = d.hourly ? "hora" : "dia";
      $("#sabio-state").textContent = `${d.configured ? "✅ Configurado" : "⚠️ Falta configurarlo en la tablet: bash ~/barriomu.sh ia"} · Preguntas hoy (juego + WhatsApp): ${d.today}`;
      $("#sabio-recent").innerHTML = d.recent.length
        ? d.recent.map(r => `<tr><td><small>${new Date(r.at).toLocaleString("es", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</small><br />${esc(r.character)}</td><td><b>${esc(r.question)}</b><br /><small class="muted">${esc(r.answer ?? "")}</small></td></tr>`).join("")
        : '<tr><td class="skeleton">Nadie le ha preguntado todavía.</td></tr>';
    } catch (e) {
      $("#sabio-state").textContent = e.message;
    }
  }

  $("#sabio-form").addEventListener("submit", async e => {
    e.preventDefault();
    const f = e.target;
    const btn = f.querySelector("button");
    btn.disabled = true;
    try {
      toast((await call("/admin/sabio/guardar", { method: "POST", body: { on: f.on.checked, waOn: f.waOn.checked, daily: Number(f.daily.value), periodo: f.periodo.value } })).message);
      await loadSabio();
    } catch (err) {
      toast(err.message, true);
    } finally {
      btn.disabled = false;
    }
  });

  // ---------- Cash Shop ----------
  const LINE_NAME = { alas: "🪽 Alas", mision: "📜 Misión", cofre: "🎁 Cofre" };
  async function loadCash() {
    try {
      const d = await call("/admin/cashshop");
      $("#cash-items").innerHTML = d.items.map(it => `
        <tr data-id="${it.id}">
          <td><input type="checkbox" class="cash-on" ${it.enabled ? "checked" : ""} aria-label="A la venta" /></td>
          <td><strong>${esc(it.label)}</strong><br /><small class="muted">${LINE_NAME[it.line] ?? esc(it.line)}</small></td>
          <td class="num"><input type="number" class="cash-price" min="1" value="${it.price}" inputmode="numeric" /></td>
          <td class="num"><input type="number" class="cash-cap" min="1" max="1000" value="${it.dailyCap}" inputmode="numeric" /></td>
        </tr>`).join("");
      $("#cash-recent").innerHTML = d.recent.length
        ? d.recent.map(r => `<tr><td><small>${new Date(r.at).toLocaleString("es", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</small></td><td>${esc(r.login ?? "—")}</td><td>${esc(r.detail)}</td><td class="num">💎 ${r.price}</td></tr>`).join("")
        : '<tr><td class="skeleton">Nadie compró todavía.</td></tr>';
    } catch (e) {
      $("#cash-items").innerHTML = `<tr><td colspan="4" class="skeleton">${esc(e.message)}</td></tr>`;
    }
  }

  $("#cash-save").addEventListener("click", async e => {
    const items = [...document.querySelectorAll("#cash-items tr[data-id]")].map(tr => ({
      id: Number(tr.dataset.id),
      enabled: tr.querySelector(".cash-on").checked,
      price: Number(tr.querySelector(".cash-price").value),
      dailyCap: Number(tr.querySelector(".cash-cap").value),
    }));
    e.target.disabled = true;
    try {
      toast((await call("/admin/cashshop/guardar", { method: "POST", body: { items } })).message);
      await loadCash();
    } catch (err) {
      toast(err.message, true);
    } finally {
      e.target.disabled = false;
    }
  });

  // ---------- Tienda de puntos ----------
  let shopData = null;
  const when = iso => new Date(iso).toLocaleString("es", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

  function renderShop(d) {
    shopData = d;
    $("#shop-items").innerHTML = d.items.length
      ? d.items.map(it => `
        <tr data-id="${it.id}">
          <td><input type="checkbox" class="shop-on" ${it.enabled ? "checked" : ""} aria-label="A la venta" /></td>
          <td><strong>${esc(it.label)}</strong><br /><small class="muted">${it.group}/${it.number}${it.level ? " +" + it.level : ""}</small></td>
          <td class="num"><input type="number" class="shop-price" min="1" value="${it.price}" inputmode="numeric" /></td>
          <td><select class="shop-currency ref-select"><option value="puntos" ${it.currency !== "wcoinc" ? "selected" : ""}>🪙 Puntos</option><option value="wcoinc" ${it.currency === "wcoinc" ? "selected" : ""}>💎 WCoinC</option></select></td>
          <td class="num"><input type="number" class="shop-max" min="1" max="50" value="${it.maxQty}" inputmode="numeric" /></td>
          <td><button class="btn btn-ghost btn-small shop-del" type="button" title="Quitar de la tienda">✕</button></td>
        </tr>`).join("")
      : '<tr><td colspan="6" class="skeleton">La tienda está vacía.</td></tr>';
    $("#shop-monsters").innerHTML = d.monsters.map(m => `
      <tr data-number="${m.number}">
        <td><strong>${esc(m.name)}</strong> <small class="muted">#${m.number}</small></td>
        <td>${esc(m.kind)}</td>
        <td class="num"><input type="number" class="monster-points" min="0" value="${m.points}" inputmode="numeric" /></td>
      </tr>`).join("");
    $("#shop-top").innerHTML = d.top.length
      ? d.top.map(r => `<tr><td>${esc(r.account)}</td><td class="num">🪙 ${r.points}</td><td class="num">💎 ${r.wcoinc}</td><td class="num">🔷 ${r.wcoinp}</td></tr>`).join("")
      : '<tr><td class="skeleton">Nadie tiene puntos todavía.</td></tr>';
    $("#shop-log").innerHTML = d.log.length
      ? d.log.map(r => `<tr><td><small>${when(r.at)}</small></td><td>${esc(r.account ?? "—")}</td><td>${esc(r.detail ?? r.kind)}</td><td class="num ${r.points < 0 ? "bad" : "ok"}">${r.points > 0 ? "+" : ""}${r.points} ${{ puntos: "🪙", wcoinc: "💎", wcoinp: "🔷" }[r.currency] ?? ""}</td></tr>`).join("")
      : '<tr><td class="skeleton">Sin movimientos.</td></tr>';
  }

  async function loadShop() {
    try {
      renderShop(await call("/admin/tienda"));
    } catch (e) {
      $("#shop-items").innerHTML = `<tr><td colspan="6" class="skeleton">${esc(e.message)}</td></tr>`;
    }
  }

  async function shopCall(path, body, btn) {
    if (btn) btn.disabled = true;
    try {
      const res = await call(path, { method: "POST", body });
      toast(res.message);
      await loadShop();
      return true;
    } catch (e) {
      toast(e.message, true);
      return false;
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  $("#shop-save").addEventListener("click", e => {
    const items = [...document.querySelectorAll("#shop-items tr[data-id]")].map(tr => ({
      id: Number(tr.dataset.id),
      enabled: tr.querySelector(".shop-on").checked,
      price: Number(tr.querySelector(".shop-price").value),
      maxQty: Number(tr.querySelector(".shop-max").value),
      currency: tr.querySelector(".shop-currency").value,
    }));
    shopCall("/admin/tienda/guardar", { items }, e.target);
  });

  $("#shop-items").addEventListener("click", e => {
    const btn = e.target.closest(".shop-del");
    if (!btn) return;
    const tr = btn.closest("tr");
    const label = tr.querySelector("strong").textContent;
    if (confirm(`¿Quitar "${label}" de la tienda?\n\nSi solo quieres dejar de venderlo, desmarca "A la venta".`)) {
      shopCall("/admin/tienda/quitar", { id: Number(tr.dataset.id) });
    }
  });

  $("#shop-add").addEventListener("submit", async e => {
    e.preventDefault();
    const f = e.target;
    const ok = await shopCall("/admin/tienda/agregar", {
      group: Number(f.group.value), number: Number(f.number.value), level: Number(f.level.value || 0),
      price: Number(f.price.value), maxQty: Number(f.maxQty.value || 1), label: f.label.value, currency: f.currency.value,
    }, f.querySelector("button"));
    if (ok) f.reset();
  });

  $("#monsters-save").addEventListener("click", e => {
    const table = {};
    document.querySelectorAll("#shop-monsters tr[data-number]").forEach(tr => {
      table[tr.dataset.number] = Number(tr.querySelector(".monster-points").value) || 0;
    });
    shopCall("/admin/puntos/monstruos", { table }, e.target);
  });

  $("#give-points").addEventListener("submit", async e => {
    e.preventDefault();
    const f = e.target;
    const points = Number(f.points.value);
    const coin = f.currency.options[f.currency.selectedIndex].text;
    if (!confirm(`¿${points < 0 ? "Quitar" : "Dar"} ${Math.abs(points)} ${coin} a ${f.account.value}?`)) return;
    const ok = await shopCall("/admin/puntos/dar", { account: f.account.value.trim(), points, currency: f.currency.value }, f.querySelector("button"));
    if (ok) f.reset();
  });


  // ---------- Economia / mercado ----------
  async function loadEconomy() {
    try {
      const d = await call("/admin/economia");
      const f = $("#eco-form");
      f.rate.value = d.rate;
      f.tax.value = d.tax;
      const tile = (label, value) => `<div class="card tile"><span>${label}</span><b>${Number(value).toLocaleString("es")}</b></div>`;
      $("#eco-tiles").innerHTML = tile("🟢 A la venta", d.stats.active) + tile("✅ Ventas", d.stats.sold) + tile("🔷 Movido", d.stats.volume) + tile("🏛 Impuestos", d.stats.taxes);
      $("#eco-recent").innerHTML = d.recent.length
        ? d.recent.map(r => `<tr><td>${esc(r.label)}</td><td>${esc(r.seller ?? "—")}</td><td>${esc(r.buyer ?? "—")}</td><td class="num">${r.price}</td><td class="num">${r.tax}</td></tr>`).join("")
        : '<tr><td colspan="5" class="skeleton">Todavía no hay ventas en la Plaza.</td></tr>';
    } catch (e) {
      $("#eco-recent").innerHTML = `<tr><td colspan="5" class="skeleton">${esc(e.message)}</td></tr>`;
    }
  }

  $("#eco-form").addEventListener("submit", async e => {
    e.preventDefault();
    const f = e.target;
    const btn = f.querySelector("button");
    btn.disabled = true;
    try {
      const res = await call("/admin/economia/guardar", { method: "POST", body: { rate: Number(f.rate.value), tax: Number(f.tax.value) } });
      toast(res.message);
      await loadEconomy();
    } catch (err) {
      toast(err.message, true);
    } finally {
      btn.disabled = false;
    }
  });


  // ---------- Registro del admin ----------
  async function loadAudit() {
    try {
      const rows = await call("/admin/registro");
      $("#audit-log").innerHTML = rows.length
        ? rows.map(r => `<tr><td><small>${when(r.at)}</small></td><td>${esc(r.account ?? "—")}</td><td>${esc(r.action)}</td><td><small class="muted">${esc(r.ip ?? "")}</small></td></tr>`).join("")
        : '<tr><td class="skeleton">Sin acciones todavía.</td></tr>';
    } catch {}
  }

  if (store.get()) load();
  else showLogin();
})();
