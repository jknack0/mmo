# Pyromancy — worked example

**Identity:** Burst-AoE nuker. INT-scaling, robe + caster off-hand. Cooldown-rhythm play with two emergent sub-archetypes (burn-stacker and direct-burst) selectable via tripod + passive tree choices.

This document is the canonical worked example for the [discipline skill design template](../adr/0018-discipline-skill-design-template.md). The other 5 disciplines follow the same scaffolding.

---

## Skills (12)

Anatomy: 1 mobility / 3 spammable / 3 mid-cd burst / 2 heavy nuke / 1 utility / 2 elite.

| # | Category | Name | Effect | Cost / CD |
|---|---|---|---|---|
| 1 | Mobility | **Ember Step** | Short forward dash (~5m), leaves fire trail applying 1 Burn stack to enemies passed through | Spirit low / 8s |
| 2 | Spammable | **Spark** | Instant single-target bolt. Pre-cast filler | Spirit low / 0s |
| 3 | Spammable | **Cinder Spray** | Short-range cone, 1 Burn stack to all hit | Spirit low / 3s |
| 4 | Spammable | **Heat Wave** | PBAOE ring around caster | Spirit low / 5s |
| 5 | Mid-cd burst | **Fireball** | Targeted projectile, explodes on impact (radius) | Spirit med / 8s |
| 6 | Mid-cd burst | **Flame Lance** | Long-range piercing line projectile | Spirit med / 10s |
| 7 | Mid-cd burst | **Combust** | Detonates all Burn stacks on enemies in radius for massive single-tick damage | Spirit med / 12s |
| 8 | Heavy nuke | **Meteor** | Telegraphed delayed ground AoE drop (~1s wind-up). High damage | Spirit high / 30s |
| 9 | Heavy nuke | **Firestorm** | Ground patch 6s, ticks Burn on enemies inside. Wave-clear | Spirit high / 35s |
| 10 | Utility | **Wall of Flame** | Line wall on ground for 4s; pass-through = damage + 1 Burn; body-blocks pathing | Spirit med / 25s |
| 11 | Elite | **Pyroclasm** | Massive single-target column. Applies max-stack Burn | Wrath full / 50s |
| 12 | Elite | **Cataclysm** | Screen-clear AoE. Multiple meteors rain over large radius, ignite ground | Wrath full / 60s |

---

## Tripods (12 × 2 tiers × 3 choices = 72)

T1 = vector tradeoff. T2 = archetype lean ([B]urn / [D]irect / [U]tility).

| # | Skill | T1 (vector) | T2 (archetype) |
|---|---|---|---|
| 1 | Ember Step | Long (+dist) / Quick (cd 8→5s) / Searing (+1 Burn trail) | Phoenix (i-frames during dash) [U] · Detonate (boom on land) [D] · Smoldering (trail persists 3s ticking Burn) [B] |
| 2 | Spark | Heavy (+30% dmg, +0.2s cd) / Twin (chains 1) / Ignite (50% Burn) | Crit (+15% crit) [D] · Ember (free cast vs Burned target) [B] · Stun (3% stun 0.5s) [U] |
| 3 | Cinder Spray | Wide (+angle) / Long (+range) / Hot (+1 Burn) | Cleaving (+25% dmg, no Burn) [D] · Smoldering (2s patch in cone) [B] · Pushing (knockback) [U] |
| 4 | Heat Wave | Wider / Hotter / Lingering (3s patch at feet) | Burn (2 Burn, -20% dmg) [B] · Crit (+30% crit) [D] · Cleansing (clears 1 debuff) [U] |
| 5 | Fireball | Concussive (+25% dmg, +cast) / Greater Range / Searing (+radius +1 Burn) | Triple (3-cone, 50% each) [D-AoE] · Detonate-on-Burn (+dmg per consumed stack) [B] · Shrapnel (2s patch on impact) [B/D] |
| 6 | Flame Lance | Heavy (+30% dmg) / Long (+range) / Searing (+1 Burn/hit) | Twin (2 lances cone) [D] · Igniting (3s fire trail) [B] · Anchoring (1st hit slow 50%/2s) [U] |
| 7 | Combust | Wider (+radius) / Hotter (+15%/stack) / Faster (cd 12→8s) | Chain (spreads Burn before consuming) [B] · Pure (flat dmg, smaller, works w/o Burn) [D] · Snuffing (consumed stack heals 1% HP, cap 10%) [U/B] |
| 8 | Meteor | Greater (+radius +cast) / Hotter (+30% dmg) / Searing (+3 Burn) | Twin (2 smaller meteors) [D] · Cratering (4s patch) [B] · Stunning (1s stun) [U] |
| 9 | Firestorm | Larger / Longer / Hotter (+30% dmg, no Burn) | Pulsing (2s mini-boom pulses) [D] · Pyroclastic (+1 Burn/tick) [B] · Mobile (follows caster) [U] |
| 10 | Wall of Flame | Long / Tall (+duration) / Hot (+dmg/tick) | Crushing (blocks projectiles+LoS) [U] · Cremating (+2 Burn/tick) [B] · Detonating (explodes on expire) [D] |
| 11 | Pyroclasm | Wider / Sustained (+duration channel 2s) / Searing (instant max Burn) | Annihilating (+40% dmg, no Burn) [D] · Vaporizing (consume Burn +dmg/stack) [B] · Radiant (heals allies in column 5%/s) [U] |
| 12 | Cataclysm | Greater (+area) / Hotter (+25% dmg/meteor) / Searing (+3 Burn/meteor) | Apocalyptic (2× count, -30% dmg ea) [D-AoE] · Smoldering (each leaves 3s patch) [B] · Ascending (invuln during 2s cast) [U] |

---

## Passive tree (20 nodes)

Structure: 2 shared root + 3 archetype paths × 6 nodes (3 boost → 1–2 synergy → 1 keystone). Reach 1 keystone in 8 points; 2 keystones with sacrifice in 14; 3 mechanically self-defeating (Flashburn vs Inferno conflict).

### Root (2 nodes — entry to all paths)

1. **Embered Soul** — +5% Fire damage / +5% Burn damage.
2. **Inner Furnace** — +5% max Spirit / +5% Wrath gen from Pyro skills.

### Path [D] — Direct Burst

3. **Sharpened Flame** — +8% Fire damage.
4. **Critical Heat** — +5% crit chance with Fire.
5. **Detonation** — +10% damage to explosion-type skills (Fireball, Combust, Meteor, Cataclysm).
6. **Overcast** — -10% cd on heavy nukes (Meteor, Firestorm).
7. **Annihilator** *(loadout synergy)* — +2% Fire damage per Pyro skill equipped (max +12% at 6/6).
8. **KEYSTONE — Flashburn** — Pyro skills no longer apply Burn. All Pyro damage +40%. Crits leave 1s ground patch.

### Path [B] — Burn Stacker

9. **Lingering Heat** — +20% Burn duration.
10. **Searing Touch** — +1 to max Burn stack cap (default cap TBD).
11. **Smoldering Application** — 10% chance Pyro damage applies a bonus Burn stack.
12. **Combustion Engineer** *(cross-skill synergy)* — +15% damage per Burn stack consumed by detonators (Combust, Vaporizing Pyroclasm).
13. **Wildfire** *(synergy + chain)* — Enemy dying with 5+ Burn stacks explodes for 50% of max HP as Fire damage, spreads 1 Burn to nearby enemies.
14. **KEYSTONE — Inferno** — Burn stack cap removed. Stacks beyond default cap deal half damage. Detonators scale linearly with count.

### Path [U] — Utility / Control

15. **Heat Mirage** — +10% move speed for 3s after any Pyro skill.
16. **Smoldering Form** — On hit taken, attacker gets 1 Burn stack (10s cd).
17. **Pyric Conduit** *(synergy)* — Wall + Firestorm +25% duration; allies passing through gain +5% Fire damage for 5s.
18. **Cremator** *(synergy / CC)* — Heat Wave / Ember Step / Wall of Flame interrupt enemy casts in their AoE.
19. **Phoenix Resilience** — Once/fight at <20% HP: invulnerable 2s + explode for moderate Fire damage.
20. **KEYSTONE — Pyromancer's Ward** — -20% damage taken while ≥1 Burn stack is active on an enemy within 5m.

---

## Sub-archetype emergence

The free 6-of-24 slot model + tripod T2 + tree paths produces two natural Pyromancy archetypes (and many mixed builds):

**Burn-Stacker** — Cinder Spray (Hot/Smoldering), Wall (Cremating), Firestorm (Pyroclastic), Combust (Chain), Pyroclasm (Vaporizing), Cataclysm (Smoldering). Tree: [B] keystone Inferno. Itemization: +Burn damage, +Burn duration, +max Burn stacks affixes.

**Direct-Burst** — Spark (Crit), Fireball (Triple), Flame Lance (Twin), Meteor (Twin), Pyroclasm (Annihilating), Cataclysm (Apocalyptic). Tree: [D] keystone Flashburn. Itemization: +Fire damage, +crit, +cast speed affixes.

Both archetypes use only 6 of the 12 Pyro skills, leaving room for a second discipline (the 6+0 case is rare; 4+2 and 3+3 mixes are expected to dominate).
