import { describe, it, expect } from 'vitest';
import { resolveLootClick } from './loot-click.js';

const at = (x: number, y: number) => ({ x, y });

describe('resolveLootClick (pure)', () => {
  it('clicking a far ground item walks the player toward it (approach)', () => {
    const items = [{ id: 'i1', pos: at(10, 10) }];
    // player far away, clicked tile lands on the item
    const action = resolveLootClick(at(10, 10), items, at(0, 0));
    expect(action).toEqual({ kind: 'approach', target: at(10, 10) });
  });

  it('clicking a ground item already within pickup range grabs it instantly', () => {
    const items = [{ id: 'i1', pos: at(10, 10) }];
    // player one tile away → within PICKUP_RADIUS (1.5)
    const action = resolveLootClick(at(10, 10), items, at(10, 11));
    expect(action).toEqual({ kind: 'pickup', itemId: 'i1' });
  });

  it('returns null when the click is not near any ground item (falls through to move/attack)', () => {
    const items = [{ id: 'i1', pos: at(10, 10) }];
    // clicked far from the only item → not a loot click
    expect(resolveLootClick(at(2, 2), items, at(0, 0))).toBeNull();
    expect(resolveLootClick(at(2, 2), [], at(0, 0))).toBeNull();
  });

  it('picks the ground item nearest the clicked tile when several overlap', () => {
    const items = [
      { id: 'far', pos: at(11, 11) },
      { id: 'near', pos: at(10, 10) },
    ];
    // click at (10,10), player far → approach the nearer item
    expect(resolveLootClick(at(10, 10), items, at(0, 0))).toEqual({
      kind: 'approach',
      target: at(10, 10),
    });
  });
});
