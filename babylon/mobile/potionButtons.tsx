import { observer } from 'mobx-react-lite';
import { Bag } from '@/modules/inventory';
import { Hero } from '@/modules/hero';
import { countHotkeyItems, findHotkeyItem } from '@/modules/inventory/itemHotkeys';
import { ItemIcon } from '@/controllers/interface/components/item_icon';

/**
 * BarrioMU: the Q and W potions as two big buttons beside the joystick, with
 * what is left. A tap drinks, exactly like the key or a right click on the
 * bar slot (`Bag.useItemHotkey`); the bar slots stay where they are.
 */
const PotionButton = observer(({ index, className, title }: { index: number; className: string; title: string }) => {
  const items = Hero.items;
  const hotkey = Bag.itemHotkeys[index];
  const slot = findHotkeyItem(items, index, hotkey);
  const item = slot >= 0 ? items[slot] : null;
  const count = slot >= 0 ? countHotkeyItems(items, index, hotkey) : 0;

  return (
    <div
      className={`barrio-potion ${className}${item ? '' : ' is-empty'}`}
      title={title}
      onPointerDown={e => e.stopPropagation()}
      onPointerUp={e => {
        e.stopPropagation();
        Bag.useItemHotkey(index);
      }}
      onContextMenu={e => e.preventDefault()}
    >
      {item && <ItemIcon item={item} />}
      <span className="barrio-potion-count">{count}</span>
    </div>
  );
});

export const PotionButtons = () => (
  <>
    <PotionButton index={0} className="barrio-potion-q" title="Poción (Q)" />
    <PotionButton index={1} className="barrio-potion-w" title="Poción (W)" />
  </>
);
