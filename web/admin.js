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
      render(await call("/admin/stats"));
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

  if (store.get()) load();
  else showLogin();
})();
