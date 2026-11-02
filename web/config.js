// Ajustes de la landing de BarrioMU. Cambia aqui los links y textos sin tocar
// el resto de la pagina.
window.BARRIOMU = {
  // API de la tablet (estado, rankings, eventos)
  api: "https://mu-api.makeseo.app",

  // Links principales
  play: "https://mu.makeseo.app",
  register: "https://mu-registro.makeseo.app",
  // Instalador para Windows con los graficos completos (workflow build-pc.yml)
  pc: "https://github.com/bboymak3/openmu-fly-server/releases/download/barriomu-pc/BarrioMU-Setup.exe",

  // Comunidad: deja "" para ocultar el boton
  discord: "",
  whatsapp: "",

  // Tarjetas de caracteristicas del servidor
  features: [
    { icon: "⚔️", title: "Season 6 Episodio 3", text: "La version clasica, con 3ra clase, alas de 3ra y master level." },
    { icon: "🌐", title: "Sin descargar nada", text: "Se juega desde el navegador, en celular o PC." },
    { icon: "🏘️", title: "MIJAGUA", text: "Servidor con PvP. Caza con riesgo." },
    { icon: "💎", title: "ALTOBARINAS", text: "Sin PvP y con doble drop. Farmea tranquilo." },
    { icon: "🎁", title: "Premio diario", text: "5.000.000 de zen al entrar cada dia." },
    { icon: "🔁", title: "Resets", text: "Nivel 400, sin limite. Stats a cero y 1.500 puntos x reset." },
    { icon: "⭐", title: "Master Reset", text: "Con 50 resets: vuelves a 0 y cada reset te da 10.000 puntos extra, para siempre." },
    { icon: "🗡️", title: "Guerrero", text: "NPC en Lorencia: +20% de ataque y magia por 30 minutos, gratis." },
    { icon: "🍀", title: "Fortuna", text: "NPC en Lorencia: doble EXP y doble drop por 45 minutos, cada 3 horas." },
  ],

  // Reglas del servidor (una por linea)
  rules: [
    "Respeta a todos los jugadores: nada de insultos, racismo ni acoso.",
    "Prohibido usar hacks, bots o programas de terceros.",
    "Prohibido aprovechar errores del juego: si encuentras uno, avisa al staff.",
    "Una cuenta por persona para eventos y rankings.",
    "No se venden items ni cuentas por dinero real.",
    "El staff nunca te pedira tu contrasena.",
  ],
};
