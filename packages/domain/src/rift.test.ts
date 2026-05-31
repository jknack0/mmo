import { describe, it, expect } from 'vitest';
import {
  createRiftState,
  recordRiftKill,
  riftComplete,
  RIFT_KILL_QUOTA,
  RIFT_BOSS,
  RIFT_TRASH,
} from './rift.js';

describe('Rift phase machine', () => {
  it('starts in wave-clear with no kills', () => {
    const s = createRiftState();
    expect(s.phase).toBe('wave-clear');
    expect(s.kills).toBe(0);
    expect(s.quota).toBe(RIFT_KILL_QUOTA);
  });

  it('banks trash kills until the quota flips to the mini-boss', () => {
    let s = createRiftState(3);
    s = recordRiftKill(s, false);
    expect(s).toMatchObject({ phase: 'wave-clear', kills: 1 });
    s = recordRiftKill(s, false);
    expect(s).toMatchObject({ phase: 'wave-clear', kills: 2 });
    s = recordRiftKill(s, false);
    expect(s.phase).toBe('mini-boss');
    expect(s.kills).toBe(3);
  });

  it('ignores trash kills once in the mini-boss phase', () => {
    let s = createRiftState(1);
    s = recordRiftKill(s, false); // → mini-boss
    s = recordRiftKill(s, false); // trash during boss phase: no-op
    expect(s.phase).toBe('mini-boss');
  });

  it('completes when the boss dies in the mini-boss phase', () => {
    let s = createRiftState(1);
    s = recordRiftKill(s, false); // → mini-boss
    expect(riftComplete(s)).toBe(false);
    s = recordRiftKill(s, true); // boss down
    expect(s.phase).toBe('complete');
    expect(riftComplete(s)).toBe(true);
  });

  it('a boss kill during wave-clear does not complete (boss not up yet)', () => {
    const s = recordRiftKill(createRiftState(5), true);
    expect(s.phase).toBe('wave-clear');
  });

  it('the boss is much tankier than trash', () => {
    expect(RIFT_BOSS.maxHp).toBeGreaterThan(RIFT_TRASH.maxHp * 5);
  });
});
