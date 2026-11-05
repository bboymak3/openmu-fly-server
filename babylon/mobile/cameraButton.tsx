import { useEffect, useState } from 'react';
import { MobileButton, ScaledFrame } from './mobileButton';
import { SMALL_SCALE, SKILLBOX_SPRITE, SKILLBOX_USE_SPRITE, BOX_WIDTH, BOX_HEIGHT } from './consts';

// BarrioMU: al entrar al juego, pantalla completa sin botones. El navegador
// solo la permite con un gesto del jugador: se pide al montar (por si acaso)
// y con el primer toque que dé en la pantalla. Sale con el botón atrás del
// teléfono y el siguiente toque la vuelve a poner.
const barrioGoFullscreen = () => {
  const root = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => Promise<void> };
  try {
    if (document.fullscreenElement) return;
    (root.requestFullscreen?.() ?? root.webkitRequestFullscreen?.() ?? Promise.resolve())
      .then(() => {
        // De paso fija la vista en horizontal (falla tranquilo si no se puede).
        try { (screen.orientation as any)?.lock?.('landscape'); } catch {}
      })
      .catch(() => {});
  } catch {}
};

/**
 * BarrioMU: el modo camara libre del celular. Encendido, un dedo que arrastra
 * gira e inclina la vista y dos dedos la pellizcan para acercar o alejar
 * (los gestos los inventa patch-client.py dentro de installCameraControl).
 * Apagado, arrastrar vuelve a caminar como siempre y la vista se queda como
 * la dejaste.
 */
export const CameraButton = () => {
  const [on, setOn] = useState(false);

  // Pantalla completa: intento inmediato y con cada toque (no-op si ya está).
  useEffect(() => {
    barrioGoFullscreen();
    window.addEventListener('pointerdown', barrioGoFullscreen);
    return () => window.removeEventListener('pointerdown', barrioGoFullscreen);
  }, []);

  return (
    <MobileButton
      className={`mobile-camera-button${on ? ' is-on' : ''}`}
      title="Cámara: girar y acercar con los dedos"
      onTap={() => {
        setOn(prev => {
          (window as any).barrioCameraOn = !prev;
          (window as any).barrioCameraDrag = false;
          return !prev;
        });
      }}
    >
      {pressed => (
        <ScaledFrame
          file={pressed || on ? SKILLBOX_USE_SPRITE : SKILLBOX_SPRITE}
          width={BOX_WIDTH}
          height={BOX_HEIGHT}
          scale={SMALL_SCALE}
        >
          <div className="mobile-camera-glyph">📷</div>
        </ScaledFrame>
      )}
    </MobileButton>
  );
};
