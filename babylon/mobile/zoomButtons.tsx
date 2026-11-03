import { zoomCamera } from '@/controllers/camera';
import { MobileButton, ScaledFrame } from './mobileButton';
import { SMALL_SCALE, SKILLBOX_SPRITE, SKILLBOX_USE_SPRITE, BOX_WIDTH, BOX_HEIGHT } from './consts';

/**
 * BarrioMU: alejar y acercar la camara en el celular, donde no hay Ctrl+rueda.
 * Van a la derecha del boton de pantalla completa.
 */
const ZoomButton = ({ step, className, glyph, title }: { step: number; className: string; glyph: string; title: string }) => (
  <MobileButton className={`mobile-zoom-button ${className}`} title={title} onTap={() => zoomCamera(step)}>
    {pressed => (
      <ScaledFrame
        file={pressed ? SKILLBOX_USE_SPRITE : SKILLBOX_SPRITE}
        width={BOX_WIDTH}
        height={BOX_HEIGHT}
        scale={SMALL_SCALE}
      >
        <div className="mobile-zoom-glyph">{glyph}</div>
      </ScaledFrame>
    )}
  </MobileButton>
);

export const ZoomButtons = () => (
  <>
    <ZoomButton step={1} className="mobile-zoom-out" glyph="−" title="Alejar la cámara" />
    <ZoomButton step={-1} className="mobile-zoom-in" glyph="+" title="Acercar la cámara" />
  </>
);
