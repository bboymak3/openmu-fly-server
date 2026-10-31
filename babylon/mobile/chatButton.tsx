import { observer } from 'mobx-react-lite';
import { Social } from '@/modules/social/social';
import { MobileButton, ScaledFrame } from './mobileButton';
import { SLOT_SCALE, SKILLBOX_SPRITE, SKILLBOX_USE_SPRITE, BOX_WIDTH, BOX_HEIGHT } from './consts';

/**
 * BarrioMU: the chat box, one thumb away. A phone has no Enter key, which is
 * what opens it on a keyboard; this opens and closes the same box.
 */
export const ChatButton = observer(() => {
  const open = Social.chatInputOpen;

  return (
    <MobileButton
      className="mobile-chat-button"
      title="Chat"
      onTap={() => {
        if (Social.chatInputOpen) Social.closeChatInput();
        else Social.openChatInput();
      }}
    >
      {pressed => (
        <ScaledFrame
          file={pressed || open ? SKILLBOX_USE_SPRITE : SKILLBOX_SPRITE}
          width={BOX_WIDTH}
          height={BOX_HEIGHT}
          scale={SLOT_SCALE}
        >
          <div className="mobile-chat-glyph">💬</div>
        </ScaledFrame>
      )}
    </MobileButton>
  );
});
