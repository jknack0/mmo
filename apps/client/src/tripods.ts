// Tripod metadata mirrored on the client purely for UI rendering. The
// SERVER is canonical for skill resolution — client only needs labels +
// descriptions to populate the selector panel.

export interface TripodChoice {
  id: string;
  label: string;
  description: string;
  archetype?: 'burn' | 'direct' | 'utility';
}

export interface SkillTripod {
  /** Display label for the player-facing skill name. */
  skillLabel: string;
  t1: [TripodChoice, TripodChoice, TripodChoice];
  t2: [TripodChoice, TripodChoice, TripodChoice];
}

export interface TripodSelection {
  t1: number;
  t2: number;
}

export type TripodLoadout = Record<string, TripodSelection>;

const T = (c: TripodChoice): TripodChoice => c;

export const PYROMANCY_TRIPODS_UI: Record<string, SkillTripod> = {
  'ember-step': {
    skillLabel: 'Ember Step',
    t1: [
      T({ id: 'long-step', label: 'Long Step', description: '+50% dash distance.' }),
      T({ id: 'quick-step', label: 'Quick Step', description: 'Cooldown 8s → 5s.' }),
      T({ id: 'searing-step', label: 'Searing Step', description: '+1 Burn stack along trail.' }),
    ],
    t2: [
      T({ id: 'phoenix-step', label: 'Phoenix Step', description: 'i-frames during the dash.', archetype: 'utility' }),
      T({ id: 'detonating-step', label: 'Detonating Step', description: '+50% damage on landing tile, no Burn.', archetype: 'direct' }),
      T({ id: 'smoldering-step', label: 'Smoldering Step', description: 'Trail persists 3s ticking Burn.', archetype: 'burn' }),
    ],
  },
  spark: {
    skillLabel: 'Spark',
    t1: [
      T({ id: 'heavy-spark', label: 'Heavy Spark', description: '+30% damage, +0.2s cooldown.' }),
      T({ id: 'twin-spark', label: 'Twin Spark', description: 'Chains to one nearby enemy at -25% damage.' }),
      T({ id: 'igniting-spark', label: 'Igniting Spark', description: '50% chance to apply 1 Burn.' }),
    ],
    t2: [
      T({ id: 'crit-spark', label: 'Critical Spark', description: '+15% crit chance with Fire damage.', archetype: 'direct' }),
      T({ id: 'ember-spark', label: 'Ember Spark', description: 'Free cast vs Burned targets.', archetype: 'burn' }),
      T({ id: 'stun-spark', label: 'Stun Spark', description: '3% chance to stun for 0.5s.', archetype: 'utility' }),
    ],
  },
  'cinder-spray': {
    skillLabel: 'Cinder Spray',
    t1: [
      T({ id: 'wide-spray', label: 'Wide Spray', description: '+50% cone angle.' }),
      T({ id: 'long-spray', label: 'Long Spray', description: '+50% cone range.' }),
      T({ id: 'hot-spray', label: 'Hot Spray', description: '+1 Burn stack applied.' }),
    ],
    t2: [
      T({ id: 'cleaving-spray', label: 'Cleaving Spray', description: '+25% damage but no Burn.', archetype: 'direct' }),
      T({ id: 'smoldering-spray', label: 'Smoldering Spray', description: '2s ground patch in the cone.', archetype: 'burn' }),
      T({ id: 'pushing-spray', label: 'Pushing Spray', description: 'Small knockback on hit.', archetype: 'utility' }),
    ],
  },
  'heat-wave': {
    skillLabel: 'Heat Wave',
    t1: [
      T({ id: 'wider-wave', label: 'Wider Wave', description: '+30% radius.' }),
      T({ id: 'hotter-wave', label: 'Hotter Wave', description: '+30% damage.' }),
      T({ id: 'lingering-wave', label: 'Lingering Wave', description: '3s ground patch at caster.' }),
    ],
    t2: [
      T({ id: 'burn-wave', label: 'Burn Wave', description: '+2 Burn stacks, -20% damage.', archetype: 'burn' }),
      T({ id: 'crit-wave', label: 'Crit Wave', description: '+30% crit chance.', archetype: 'direct' }),
      T({ id: 'cleansing-wave', label: 'Cleansing Wave', description: 'Clears 1 debuff from caster.', archetype: 'utility' }),
    ],
  },
  fireball: {
    skillLabel: 'Fireball',
    t1: [
      T({ id: 'concussive-fireball', label: 'Concussive Fireball', description: '+25% damage, +0.3s cast.' }),
      T({ id: 'greater-range', label: 'Greater Range', description: '+50% range, faster travel.' }),
      T({ id: 'searing-fireball', label: 'Searing Fireball', description: '+20% radius, +1 Burn.' }),
    ],
    t2: [
      T({ id: 'triple-fireball', label: 'Triple Fireball', description: '3 fireballs in cone, 50% damage each.', archetype: 'direct' }),
      T({ id: 'detonate-on-burn', label: 'Detonate on Burn', description: 'Consumes Burn for +15 damage per stack.', archetype: 'burn' }),
      T({ id: 'shrapnel-fireball', label: 'Shrapnel Fireball', description: '2s lingering ground patch on explosion.', archetype: 'burn' }),
    ],
  },
  'flame-lance': {
    skillLabel: 'Flame Lance',
    t1: [
      T({ id: 'heavy-lance', label: 'Heavy Lance', description: '+30% damage, +0.4s cast.' }),
      T({ id: 'long-lance', label: 'Long Lance', description: '+50% range.' }),
      T({ id: 'searing-lance', label: 'Searing Lance', description: '+1 Burn on each pierced enemy.' }),
    ],
    t2: [
      T({ id: 'twin-lance', label: 'Twin Lance', description: '2 lances at 60% damage each.', archetype: 'direct' }),
      T({ id: 'igniting-lance', label: 'Igniting Lance', description: 'Leaves a 3s fire trail.', archetype: 'burn' }),
      T({ id: 'anchoring-lance', label: 'Anchoring Lance', description: 'First hit slowed 50% for 2s.', archetype: 'utility' }),
    ],
  },
  combust: {
    skillLabel: 'Combust',
    t1: [
      T({ id: 'wider-combust', label: 'Wider Combust', description: '+40% detonation radius.' }),
      T({ id: 'hotter-combust', label: 'Hotter Combust', description: '+15% damage per Burn stack consumed.' }),
      T({ id: 'faster-combust', label: 'Faster Combust', description: 'Cooldown 12s → 8s.' }),
    ],
    t2: [
      T({ id: 'chain-combust', label: 'Chain Combust', description: 'Spreads Burn to nearby first.', archetype: 'burn' }),
      T({ id: 'pure-combust', label: 'Pure Combust', description: 'Works without Burn, +20% flat damage.', archetype: 'direct' }),
      T({ id: 'snuffing-combust', label: 'Snuffing Combust', description: 'Each consumed stack heals 1% HP, cap 10%.', archetype: 'utility' }),
    ],
  },
  meteor: {
    skillLabel: 'Meteor',
    t1: [
      T({ id: 'greater-meteor', label: 'Greater Meteor', description: '+25% radius, +0.5s wind-up.' }),
      T({ id: 'hotter-meteor', label: 'Hotter Meteor', description: '+30% damage.' }),
      T({ id: 'searing-meteor', label: 'Searing Meteor', description: '+3 Burn stacks on impact.' }),
    ],
    t2: [
      T({ id: 'twin-meteor', label: 'Twin Meteor', description: '2 smaller meteors at 60% damage each.', archetype: 'direct' }),
      T({ id: 'cratering-meteor', label: 'Cratering Meteor', description: '4s fire patch on impact.', archetype: 'burn' }),
      T({ id: 'stunning-meteor', label: 'Stunning Meteor', description: 'Stuns enemies in radius for 1s.', archetype: 'utility' }),
    ],
  },
  firestorm: {
    skillLabel: 'Firestorm',
    t1: [
      T({ id: 'larger-firestorm', label: 'Larger Firestorm', description: '+30% radius.' }),
      T({ id: 'longer-firestorm', label: 'Longer Firestorm', description: '+50% duration.' }),
      T({ id: 'hotter-firestorm', label: 'Hotter Firestorm', description: '+30% damage, no Burn applied.' }),
    ],
    t2: [
      T({ id: 'pulsing-firestorm', label: 'Pulsing Firestorm', description: 'Every 2s, mini-boom from center.', archetype: 'direct' }),
      T({ id: 'pyroclastic-firestorm', label: 'Pyroclastic Firestorm', description: '+1 Burn stack per tick.', archetype: 'burn' }),
      T({ id: 'mobile-firestorm', label: 'Mobile Firestorm', description: 'Follows the caster.', archetype: 'utility' }),
    ],
  },
  'wall-of-flame': {
    skillLabel: 'Wall of Flame',
    t1: [
      T({ id: 'long-wall', label: 'Long Wall', description: '+50% length.' }),
      T({ id: 'tall-wall', label: 'Tall Wall', description: '+50% duration.' }),
      T({ id: 'hot-wall', label: 'Hot Wall', description: '+30% damage per tick.' }),
    ],
    t2: [
      T({ id: 'crushing-wall', label: 'Crushing Wall', description: 'Blocks projectiles + LoS.', archetype: 'utility' }),
      T({ id: 'cremating-wall', label: 'Cremating Wall', description: '+2 Burn stacks per tick.', archetype: 'burn' }),
      T({ id: 'detonating-wall', label: 'Detonating Wall', description: 'Explodes for damage on expire.', archetype: 'direct' }),
    ],
  },
  pyroclasm: {
    skillLabel: 'Pyroclasm',
    t1: [
      T({ id: 'wider-pyroclasm', label: 'Wider Pyroclasm', description: '+50% column radius.' }),
      T({ id: 'sustained-pyroclasm', label: 'Sustained Pyroclasm', description: '+50% channel duration.' }),
      T({ id: 'searing-pyroclasm', label: 'Searing Pyroclasm', description: 'Applies max Burn instantly.' }),
    ],
    t2: [
      T({ id: 'annihilating-pyroclasm', label: 'Annihilating Pyroclasm', description: '+40% damage but no Burn.', archetype: 'direct' }),
      T({ id: 'vaporizing-pyroclasm', label: 'Vaporizing Pyroclasm', description: 'Consumes Burn for +25 damage per stack.', archetype: 'burn' }),
      T({ id: 'radiant-pyroclasm', label: 'Radiant Pyroclasm', description: 'Heals allies in column 5% HP/s.', archetype: 'utility' }),
    ],
  },
  cataclysm: {
    skillLabel: 'Cataclysm',
    t1: [
      T({ id: 'greater-cataclysm', label: 'Greater Cataclysm', description: '+25% area.' }),
      T({ id: 'hotter-cataclysm', label: 'Hotter Cataclysm', description: '+25% damage per meteor.' }),
      T({ id: 'searing-cataclysm', label: 'Searing Cataclysm', description: '+3 Burn stacks per meteor hit.' }),
    ],
    t2: [
      T({ id: 'apocalyptic-cataclysm', label: 'Apocalyptic Cataclysm', description: '2× meteors at -30% damage each.', archetype: 'direct' }),
      T({ id: 'smoldering-cataclysm', label: 'Smoldering Cataclysm', description: 'Each meteor leaves a 3s ground patch.', archetype: 'burn' }),
      T({ id: 'ascending-cataclysm', label: 'Ascending Cataclysm', description: 'Invulnerable during 2s cast.', archetype: 'utility' }),
    ],
  },
};

// ─── HTTP helpers ──────────────────────────────────────────────

const GATEWAY_URL = import.meta.env.VITE_GATEWAY_URL ?? 'http://localhost:8080';

export async function fetchTripods(
  token: string,
  characterId: string
): Promise<TripodLoadout> {
  const res = await fetch(`${GATEWAY_URL}/characters/${characterId}/tripods`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) return {};
  const body = (await res.json()) as { loadout: TripodLoadout };
  return body.loadout ?? {};
}

export async function saveTripods(
  token: string,
  characterId: string,
  loadout: TripodLoadout
): Promise<boolean> {
  const res = await fetch(`${GATEWAY_URL}/characters/${characterId}/tripods`, {
    method: 'PUT',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ loadout }),
  });
  return res.ok;
}
