import { useEffect, useState } from 'react';
import { MobileButton, ScaledFrame } from './mobileButton';
import { SLOT_SCALE, SKILLBOX_SPRITE, SKILLBOX_USE_SPRITE, BOX_WIDTH, BOX_HEIGHT } from './consts';

/**
 * BarrioMU: full screen on a phone, where there is no F11. The browser only
 * allows it from a tap, which is what this button is for. Hidden where the
 * page cannot go full screen (an iPhone, or already installed as an app).
 */
export const FullscreenButton = () => {
  const [full, setFull] = useState(() => !!document.fullscreenElement);

  useEffect(() => {
    const onChange = () => setFull(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  if (!document.fullscreenEnabled) return null;

  return (
    <MobileButton
      className="mobile-fullscreen-button"
      title="Pantalla completa"
      onTap={() => {
        if (document.fullscreenElement) {
          void document.exitFullscreen().catch(() => {});
        } else {
          void document.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
        }
      }}
    >
      {pressed => (
        <ScaledFrame
          file={pressed || full ? SKILLBOX_USE_SPRITE : SKILLBOX_SPRITE}
          width={BOX_WIDTH}
          height={BOX_HEIGHT}
          scale={SLOT_SCALE}
        >
          <div className={`mobile-fullscreen-glyph${full ? ' is-full' : ''}`} />
        </ScaledFrame>
      )}
    </MobileButton>
  );
};
