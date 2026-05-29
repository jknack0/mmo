// Affix model (S14 #16) — layered onto the white base items from S13 per
// ADR-0005. Affixes are split ~60% stat / ~40% skill; rarity is a function of
// affix count (white 0, blue 1–2, yellow 3–5) plus the unique (gold) tier,
// which is a fixed-stat chase item keyed by base id (handled in items.ts).
//
// Stat affixes carry a `stat` the engine folds into combat (StatCalculator);
// skill affixes are descriptive at this slice (rendered in tooltips, no live
// combat effect yet) but live in the same pool so drops mix 60/40.

export type Rarity = 'white' | 'blue' | 'yellow' | 'gold';

/** Rarity ordering, weakest → strongest. (Set/green is reserved, post-alpha.) */
export const RARITY_ORDER: Rarity[] = ['white', 'blue', 'yellow', 'gold'];

export type AffixKind = 'stat' | 'skill';

/** Stat targets a stat-affix can feed. `firePct` adds to fire damage %. */
export type AffixStat = 'str' | 'dex' | 'int' | 'vit' | 'armor' | 'weaponDamage' | 'firePct';

export interface AffixTemplate {
  id: string;
  kind: AffixKind;
  /** Present for stat affixes the engine understands. */
  stat?: AffixStat;
  /** Inclusive rolled-value range. Skill affixes with a fixed value use min===max. */
  min: number;
  max: number;
  /** Render a rolled value into a tooltip line. */
  render: (value: number) => string;
}

const stat = (id: string, s: AffixStat, min: number, max: number, render: (v: number) => string): AffixTemplate =>
  ({ id, kind: 'stat', stat: s, min, max, render });

export const AFFIX_TEMPLATES: AffixTemplate[] = [
  // ── Stat affixes (engine-applied) ──
  stat('str-flat', 'str', 3, 10, (v) => `+${v} Strength`),
  stat('dex-flat', 'dex', 3, 10, (v) => `+${v} Dexterity`),
  stat('int-flat', 'int', 3, 10, (v) => `+${v} Intelligence`),
  stat('vit-flat', 'vit', 3, 10, (v) => `+${v} Vitality`),
  stat('armor-flat', 'armor', 2, 8, (v) => `+${v} Armor`),
  stat('fire-pct', 'firePct', 5, 15, (v) => `+${v}% Fire damage`),
  // ── Skill affixes (descriptive this slice) ──
  { id: 'plus-pyro-skills', kind: 'skill', min: 1, max: 1, render: () => `+1 to Pyromancy skills` },
  { id: 'fireball-pct', kind: 'skill', min: 8, max: 20, render: (v) => `Fireball deals +${v}% damage` },
  { id: 'spark-pct', kind: 'skill', min: 8, max: 20, render: (v) => `Spark deals +${v}% damage` },
];

export const STAT_AFFIXES = AFFIX_TEMPLATES.filter((a) => a.kind === 'stat');
export const SKILL_AFFIXES = AFFIX_TEMPLATES.filter((a) => a.kind === 'skill');

const AFFIX_BY_ID = new Map(AFFIX_TEMPLATES.map((a) => [a.id, a]));
export function getAffixTemplate(id: string): AffixTemplate | undefined {
  return AFFIX_BY_ID.get(id);
}

/** A concrete affix instance stored on an item + rendered in tooltips. */
export interface RolledAffix {
  templateId: string;
  kind: AffixKind;
  stat?: AffixStat;
  value: number;
  text: string;
}

/** Roll a template's value from a uniform `r01` in [0,1). Inclusive integer range. */
export function rollAffixValue(t: AffixTemplate, r01: number): number {
  const span = t.max - t.min + 1;
  return t.min + Math.min(span - 1, Math.floor(r01 * span));
}

export function rollAffix(t: AffixTemplate, r01: number): RolledAffix {
  const value = rollAffixValue(t, r01);
  return { templateId: t.id, kind: t.kind, stat: t.stat, value, text: t.render(value) };
}

/** Affix-count band per non-unique rarity (inclusive). */
export const RARITY_AFFIX_COUNT: Record<'white' | 'blue' | 'yellow', [number, number]> = {
  white: [0, 0],
  blue: [1, 2],
  yellow: [3, 5],
};

/** Map a non-unique item's affix count to its rarity (gold is decided elsewhere). */
export function rarityForAffixCount(n: number): 'white' | 'blue' | 'yellow' {
  if (n <= 0) return 'white';
  if (n <= 2) return 'blue';
  return 'yellow';
}

/** Globally-constant rarity colors (CONTEXT glossary, D2-faithful). */
export const RARITY_COLOR: Record<Rarity, string> = {
  white: '#e8e8e8',
  blue: '#6a9bff',
  yellow: '#ffe04a',
  gold: '#ff9f1a',
};
