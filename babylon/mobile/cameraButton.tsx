import { useState } from 'react';
import { MobileButton, ScaledFrame } from './mobileButton';
import { SMALL_SCALE, SKILLBOX_SPRITE, SKILLBOX_USE_SPRITE, BOX_WIDTH, BOX_HEIGHT } from './consts';

/**
 * BarrioMU: el modo camara libre del celular. Encendido, un dedo que arrastra
 * gira e inclina la vista y dos dedos la pellizcan para acercar o alejar
 * (los gestos los inventa patch-client.py dentro de installCameraControl).
 * Apagado, arrastrar vuelve a caminar como siempre y la vista se queda como
 * la dejaste.
 */
export const CameraButton = () => {
  const [on, setOn] = useState(false);

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
