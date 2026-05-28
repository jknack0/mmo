# Disciplines

The six disciplines. Every character picks any 2 (ADR-0004) and learns each from a trainer in Hold Veridian. All six follow the [discipline skill design template](../adr/0018-discipline-skill-design-template.md): 12 skills with anatomy 1·3·3·2·1·2, 6-of-24 free-pick loadout, tripod T1=vector / T2=archetype, 20-node passive tree.

Only [Pyromancy](./pyromancy.md) has the full skill enumeration locked. The other five are identity-locked here; their full slates are downstream design work that follows the same scaffolding.

---

## Overview

| Name | Stat | Range | Primary dmg | DoT | One-line identity | 3 archetype paths |
|---|---|---|---|---|---|---|
| **Pyromancy** ✅ | INT | Ranged | Fire | Burn | Burst-AoE caster — cooldown-rhythm explosive moments | [B]urn-stacker · [D]irect-burst · [U]tility |
| **Cryomancy** | INT | Ranged | Cold | Frostbite | Control caster — slow, freeze, brittle, stack-detonate | [F]rostbite-stacker · [S]hatter-burst · [C]ontrol |
| **Blademaster** | STR | Melee | Physical | Bleed | Sustained DPS bruiser — mobility, weapon flow, bleed stacks | [B]leed-stacker · [F]low/sustain · [E]xecute |
| **Marksman** | DEX | Ranged | Physical | — | Precision archer — single-target crit, pierce, headshots | [P]recision-crit · [V]olley-AoE · [T]rap/utility |
| **Sentinel** | STR / VIT | Melee | Physical | Bleed (incidental) | Defender — threat, damage reduction, party shields | [T]hreat-tank · [V]itality-bruiser · [G]uardian-support |
| **Shadowblade** | DEX | Melee | Physical | Poison | Stealth assassin — backstab burst, poison stacks, evasion | [P]oison-stacker · [E]xecute-stealth · [E]vasion-mobility |

---

## Per-discipline notes

### Cryomancy — INT ranged control caster
Cold damage, Frostbite stacking DoT. Identity: slow → freeze → shatter loop. Key skills implied by template: an Ice Lance line nuke, a Blizzard ground patch, a Frost Nova PBAOE freeze, Cone of Cold spammable, a Frozen Orb projectile (heavy nuke), Glacial Spike (elite), Absolute Zero screen-clear (elite). Sub-archetypes via [F]/[S]/[C] paths: Frostbite-stacker mirrors Pyro's Burn-stacker; Shatter-burst detonates Frostbite stacks for big crits; Control leans into CC duration + slow strength.

### Blademaster — STR melee sustain
Physical damage, Bleed stacking. Identity: weapon-flow combos, animation chains, dash-strikes. Skills: a charge mobility, multiple low-cd weapon strikes (slashes, thrusts), mid-cd cleaves and whirlwinds, heavy nuke executes, a defensive stance utility, elite "blade storm" + elite "decisive strike" execute. Sub-archetypes via [B]/[F]/[E]: Bleed-stacker accumulates and detonates; Flow leans into combo-string sustained DPS; Execute deals bonus damage to low-HP targets.

### Marksman — DEX ranged precision
Physical damage, no DoT. Identity: single-target single-shot precision, with situational AoE. Skills: a roll mobility, basic rapid shot (spammable), aimed shot, piercing shot, multi-shot fan, snipe (heavy nuke), volley (heavy nuke ground patch), a trap utility, elite "perfect shot" massive single hit + elite "rain of arrows" screen-clear. Sub-archetypes via [P]/[V]/[T]: Precision-crit goes full single-target, Volley-AoE leans into multi-shot/rain-of-arrows, Trap/utility is control-flavored.

### Sentinel — STR/VIT melee defender
Physical damage, defensive identity. Identity: tank-flavored damage scaling with HP/threat; party-protection utilities. Skills: a shield-charge mobility, taunting strikes (low-cd), shield bashes (mid-cd), banner/aura utility, shield-throw and ground slam (heavy nukes), elite "bulwark" massive damage-reduction + elite "unbreakable" team-wide barrier. Sub-archetypes via [T]/[V]/[G]: Threat-tank scales damage with threat held; Vitality-bruiser converts max HP into damage; Guardian-support shields allies and grants party defenses.

### Shadowblade — DEX melee assassin
Physical + Poison damage. Identity: stealth, mobility, backstab crits, poison stacking. Skills: a teleport/shadowstep mobility, low-cd quick stabs, poison daggers (applies stacks), mid-cd backstab (positional bonus), shuriken volley, heavy nuke "assassinate" (execute) and "venom bomb" (poison AoE), an evasion/stealth utility, elite "shadow dance" multi-strike + elite "death mark" mark-target-and-execute. Sub-archetypes via [P]/[E]/[E]: Poison-stacker mirrors Pyro/Cryo DoT detonation; Execute-stealth leans into backstab + low-HP burst; Evasion-mobility is the dodge-tank flavor (DEX-scaled damage reduction via evade chance).

---

## Pair examples (Archetype emergence per ADR-0004 glossary)

A few archetype names that emerge from 2-discipline combinations:

| Combination | Community name |
|---|---|
| Pyromancy + Blademaster | Fire Sword Berserker |
| Cryomancy + Marksman | Frost Archer |
| Pyromancy + Sentinel | Magma Knight |
| Blademaster + Shadowblade | Twin-blade Reaper |
| Cryomancy + Sentinel | Frost Wall |
| Marksman + Shadowblade | Death Hunter |
| Cryomancy + Shadowblade | Frostbite Assassin |
| Pyromancy + Shadowblade | Venomous Pyromancer |
| Sentinel + Marksman | Bastion Ranger |
| (15 total pairings = C(6,2)) |

15 base pairings × tripod combinations × passive tree allocation × itemization = the design space ADR-0004 set out to create.
