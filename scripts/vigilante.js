// BarrioMU: el vigilante de afuera.
//
// Entra al juego por el link público como un jugador de verdad (Cloudflare,
// túnel, tablet, OpenMU), elige BarrioMU, inicia sesión con la cuenta del
// vigilante, entra con su personaje, mira quién hay alrededor (NPCs), camina
// unos pasos y se va. Si algo falla, termina con error y deja capturas.
//
// Lo corre .github/workflows/vigilante.yml cada hora. Para probarlo a mano:
//   VIGIA_USUARIO=... VIGIA_CLAVE=... node scripts/vigilante.js
//
// Variables:
//   VIGIA_USUARIO, VIGIA_CLAVE  la cuenta del vigilante (secretos del repo)
//   VIGIA_URL       por defecto https://mu.makeseo.app/
//   VIGIA_MUNDO     el mundo de la lista, por defecto BarrioMU
//   VIGIA_MINUTOS   cuánto se queda paseando en la ciudad, por defecto 1
//   VIGIA_CAPTURAS  carpeta de las capturas, por defecto vigilante-capturas

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const URL = process.env.VIGIA_URL || 'https://mu.makeseo.app/';
const MUNDO = (process.env.VIGIA_MUNDO || 'BarrioMU').toLowerCase();
const USUARIO = process.env.VIGIA_USUARIO || '';
const CLAVE = process.env.VIGIA_CLAVE || '';
const MINUTOS = Math.min(20, Math.max(0, Number(process.env.VIGIA_MINUTOS || 1)));
const CAPTURAS = process.env.VIGIA_CAPTURAS || 'vigilante-capturas';

const UI = { Preloader: 0, Servers: 1, Login: 2, Characters: 3, LoadingWorld: 4, World: 5 };

const reporte = [];
function anotar(linea) {
  const hora = new Date().toISOString().slice(11, 19);
  console.log(`[${hora}] ${linea}`);
  reporte.push(`- ${linea}`);
}

function guardarReporte(ok, motivo) {
  const titulo = ok ? '✅ BarrioMU funciona' : `🔴 BarrioMU: ${motivo}`;
  const texto = `## ${titulo}\n\n${reporte.join('\n')}\n`;
  fs.writeFileSync(path.join(CAPTURAS, 'reporte.md'), texto);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, texto);
  if (!ok) fs.writeFileSync(path.join(CAPTURAS, 'motivo.txt'), motivo);
}

const esperar = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  fs.mkdirSync(CAPTURAS, { recursive: true });
  if (!USUARIO || !CLAVE) {
    throw new Error('faltan los secretos VIGIA_USUARIO y VIGIA_CLAVE en el repositorio');
  }

  const browser = await chromium.launch({
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'],
  });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 BarrioMU-Vigilante',
    locale: 'es-ES',
  });
  const page = await context.newPage();
  const errores = [];
  page.on('pageerror', e => errores.push(e.message));

  let paso = 0;
  const captura = async nombre => {
    paso++;
    const archivo = path.join(CAPTURAS, `${String(paso).padStart(2, '0')}-${nombre}.png`);
    await page.screenshot({ path: archivo }).catch(() => {});
  };

  /** La pantalla en la que está el juego (con el cliente nuevo), o por lo que se ve. */
  const pantalla = () =>
    page.evaluate(UI => {
      const b = window.__barrio;
      if (b) return b.AppState.uiState;
      if (window.__world?.playerEntity && !document.querySelector('.characters-page')) return UI.World;
      if (document.querySelector('.characters-page')) return UI.Characters;
      if (document.querySelector('.login-page')) return UI.Login;
      if (document.querySelector('.servers-page')) return UI.Servers;
      return UI.Preloader;
    }, UI);

  const esperarPantalla = async (quiero, segundos, que) => {
    const hasta = Date.now() + segundos * 1000;
    while (Date.now() < hasta) {
      const ahora = await pantalla().catch(() => -1);
      if (quiero.includes(ahora)) return ahora;
      await esperar(1000);
    }
    await captura(`atascado-${que}`);
    throw new Error(`no pasó de ${que} en ${segundos} s`);
  };

  const fallar = async motivo => {
    await captura('error');
    throw new Error(motivo);
  };

  try {
    // 1. La página.
    const t0 = Date.now();
    const res = await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    if (!res || !res.ok()) await fallar(`la página respondió ${res ? res.status() : 'nada'}`);
    anotar(`Página abierta (${res.status()}) en ${((Date.now() - t0) / 1000).toFixed(1)} s`);

    // 2. La lista de mundos: BarrioMU y "Entrar".
    // Primero carga y muestra el botón "Empezar" (.ws-start); al tocarlo se abre la lista.
    await page.waitForSelector('.ws-start, .ws-world, .servers-page, .login-page', { timeout: 120000 }).catch(() => {});
    if (await page.locator('.ws-start').count()) {
      await captura('empezar');
      // El boton tiene una animacion que no para: Playwright nunca lo ve "quieto". Se toca directo.
      await page.waitForTimeout(1500);
      await page.locator('.ws-start').click({ force: true, timeout: 15000 }).catch(() => page.evaluate(() => document.querySelector('.ws-start')?.click()));
      anotar('Botón Empezar tocado');
    }
    await page.waitForSelector('.ws-world, .servers-page, .login-page', { timeout: 60000 }).catch(() => {});
    if ((await pantalla()) === UI.Preloader) {
      const tarjeta = page.locator('.ws-world', { hasText: new RegExp(MUNDO, 'i') }).first();
      if (!(await tarjeta.count())) await fallar(`no aparece el mundo ${MUNDO} en la lista`);
      if (await tarjeta.evaluate(el => el.classList.contains('is-off'))) {
        await captura('mundo-apagado');
        await fallar(`el mundo ${MUNDO} sale como no disponible (servidor apagado o sin conexión)`);
      }
      await tarjeta.click({ force: true });
      await page.waitForSelector('.ws-enter:not([disabled])', { timeout: 30000 });
      await captura('mundos');
      await page.locator('.ws-enter').click({ force: true });
      anotar(`Mundo ${MUNDO} elegido`);
    }

    // 3. El servidor (canal).
    const tras = await esperarPantalla([UI.Servers, UI.Login], 90, 'la lista de servidores');
    if (tras === UI.Servers) {
      await page.waitForTimeout(2000);
      await captura('servidores');
      const punto = await page.evaluate(() => {
        const win = document.querySelector('.server-sel-win');
        if (!win) return null;
        for (const div of win.querySelectorAll('div')) {
          const st = div.style;
          if (st.width === '0px' && st.height === '0px' && div.firstElementChild) {
            const r = div.firstElementChild.getBoundingClientRect();
            return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
          }
        }
        return null;
      });
      if (!punto) await fallar('la lista de servidores está vacía (OpenMU no responde)');
      await page.mouse.click(punto.x, punto.y);
      anotar('Servidor elegido');
    }

    // 4. El login.
    await esperarPantalla([UI.Login], 60, 'el login');
    await page.waitForSelector('.login-input[type=password]', { timeout: 30000 });
    await page.fill('.login-input[type=text]', USUARIO);
    await page.fill('.login-input[type=password]', CLAVE);
    await page.keyboard.press('Enter');
    const tLogin = Date.now();
    const hasta = Date.now() + 45000;
    while (Date.now() < hasta && (await pantalla()) === UI.Login) {
      const error = await page.locator('.login-error').textContent().catch(() => null);
      if (error && error.trim()) await fallar(`el login dijo: ${error.trim()}`);
      await esperar(500);
    }
    if ((await pantalla()) === UI.Login) await fallar('el login no respondió en 45 s');
    anotar(`Sesión iniciada en ${((Date.now() - tLogin) / 1000).toFixed(1)} s`);

    // 5. El personaje.
    await esperarPantalla([UI.Characters, UI.LoadingWorld, UI.World], 60, 'la selección de personaje');
    if ((await pantalla()) === UI.Characters) {
      await page.waitForFunction(() => window.__barrio?.CharSelect.charactersList.length > 0, null, { timeout: 60000 }).catch(() => {});
      await captura('personajes');
      const nombre = await page.evaluate(() => {
        const cs = window.__barrio?.CharSelect;
        const pj = cs?.charactersList[0];
        if (!pj) return null;
        cs.focusedChar = pj.Name;
        cs.selectCharacterRequest(pj.Name);
        return pj.Name;
      });
      if (!nombre) await fallar('la cuenta del vigilante no tiene personaje (o el cliente es viejo)');
      anotar(`Entrando con ${nombre}`);
    }

    // 6. El mundo.
    await esperarPantalla([UI.World], 240, 'la carga del mundo');
    await page.waitForFunction(() => !!window.__world?.playerEntity?.transform, null, { timeout: 60000 });
    await page.waitForTimeout(8000);
    const estado = () =>
      page.evaluate(() => {
        const w = window.__world;
        const h = w.playerEntity;
        const otros = [...w.netObjsQuery.entities].filter(e => !e.localPlayer && e.transform);
        const npcs = otros.filter(e => e.npcType !== undefined);
        return {
          mapa: w.mapIndex,
          x: Math.round(h.transform.pos.x),
          y: Math.round(h.transform.pos.z),
          npcs: npcs.length,
          jugadores: otros.length - npcs.length,
          nombres: [...new Set(npcs.map(e => (e.objectNameInWorld || '').trim()).filter(Boolean))].slice(0, 12),
        };
      });
    const inicio = await estado();
    await captura('mundo');
    anotar(`En el mundo: mapa ${inicio.mapa}, posición ${inicio.x},${inicio.y}`);
    anotar(`Alrededor: ${inicio.npcs} NPCs/monstruos, ${inicio.jugadores} jugadores`);
    if (inicio.nombres.length) anotar(`NPCs vistos: ${inicio.nombres.join(', ')}`);
    if (inicio.mapa === 0 && inicio.npcs === 0) await fallar('en Lorencia no se ve ningún NPC');

    // 7. Caminar: un clic en el piso hacia varios lados hasta que se mueva.
    const centro = { x: 640, y: 360 };
    const vueltas = [
      [160, 0], [0, 120], [-160, 0], [0, -120], [120, 90], [-120, -90],
    ];
    let camino = 0;
    const fin = Date.now() + Math.max(20000, MINUTOS * 60000);
    let i = 0;
    while (Date.now() < fin) {
      const antes = await estado();
      const [dx, dy] = vueltas[i++ % vueltas.length];
      await page.mouse.click(centro.x + dx, centro.y + dy);
      await page.waitForTimeout(3500);
      const despues = await estado();
      camino += Math.hypot(despues.x - antes.x, despues.y - antes.y);
    }
    await captura('paseo');
    if (camino < 1) await fallar('el personaje no se movió al hacer clic en el piso');
    anotar(`Caminó ${Math.round(camino)} pasos`);

    if (errores.length) anotar(`Errores de la página: ${errores.slice(0, 3).join(' | ')}`);
    anotar('Se desconecta');
    guardarReporte(true);
  } finally {
    await browser.close().catch(() => {});
  }
}

main().catch(err => {
  anotar(`FALLÓ: ${err.message}`);
  try {
    fs.mkdirSync(CAPTURAS, { recursive: true });
    guardarReporte(false, err.message);
  } catch {}
  process.exit(1);
});
