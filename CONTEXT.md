# MMO

Browser-based MMO action RPG inspired by Lost Ark and Diablo 2. Shared persistent world with channeled zones and instanced dungeons.

## Language

**Zone**:
A discrete area of the game world — a town, an open-world map, or a dungeon. The atomic unit of player location.
_Avoid_: Map, area, level

**Channel**:
A parallel copy of a shared zone, used to keep player density bounded. Players in different channels of the same zone don't see each other but can switch channels at will.
_Avoid_: Shard, server, realm

**Instance**:
A private copy of a zone created for one player or party. Used for dungeons and any non-shared content.
_Avoid_: Game, session, run

**Open world**:
Persistent shared zones where players from the same channel meet by default. The opposite of instanced content.
_Avoid_: Overworld, public zone

### Character build

**Discipline**:
A themed skill set learned from a trainer. The replacement for "class." Each character has exactly 2 equipped disciplines. The six launch disciplines are **Pyromancy** (INT ranged, Fire/Burn burst-AoE caster), **Cryomancy** (INT ranged, Cold/Frostbite control caster), **Blademaster** (STR melee, Physical/Bleed sustain DPS), **Marksman** (DEX ranged, Physical precision archer), **Sentinel** (STR/VIT melee, Physical defender / tank), and **Shadowblade** (DEX melee, Physical/Poison stealth assassin). All six follow the design template in ADR-0018. See [`/docs/disciplines/`](../docs/disciplines/) for full reference.
_Avoid_: Class, school, profession, job

**Trainer**:
An NPC in a town who teaches a discipline. Initial access is gated by a short quest, not gold.
_Avoid_: Master, mentor

**Archetype**:
The implicit identity that emerges from a player's combination of 2 disciplines. Named by the community, not the system (e.g., "Fire Sword Berserker" = Pyromancy + Blademaster).
_Avoid_: Build (build refers to the full configuration including tripods, items, and passives)

**Tripod**:
A per-skill modifier tree of 2 tiers × 3 mutually-exclusive choices that transforms how a skill behaves. Borrowed from Lost Ark; canonical in our domain.
_Avoid_: Skill mod, augment

**Passive tree**:
A per-discipline tree of ~20 nodes (boosts, synergies, keystones) where players allocate passive points earned per character level. Prerequisite-gated so paths create build identity.
_Avoid_: Passive skills, talent tree

**Synergy**:
A passive node whose effect scales with the player's investment elsewhere — either with points spent in the same discipline tree (cross-skill synergy) or with the count of same-discipline skills equipped (loadout synergy). The D2-flavored depth mechanic.
_Avoid_: Scaling bonus

**Keystone**:
A high-impact passive node that fundamentally alters how a discipline plays, with significant upsides and downsides. Build-defining.
_Avoid_: Capstone, ultimate passive

**Spirit**:
The regenerating fast resource. Regenerates passively (~1.5%/sec out of combat, ~0.5%/sec in combat) and from right-click weapon attacks. Powers small-to-medium skills. Capped at 100 baseline; INT raises the cap. The "spam budget" resource.
_Avoid_: Mana, energy, focus

**Wrath**:
The combat-built ultimate resource. Builds only from dealing damage; decays slowly out of combat. Powers elite "moment" skills (1–2 per discipline). Capped at 100, empty at fight start, full after ~20 seconds of sustained combat. The "save for the big one" resource.
_Avoid_: Rage, fury, identity gauge

**Elite skill**:
A skill that costs Wrath (sometimes also Spirit). Each discipline has 1–2 elite skills — the screen-clearing, fight-defining "moment" abilities. Distinct from baseline Spirit-costed skills.
_Avoid_: Ultimate, ult, finisher

### Itemization

**Affix**:
A randomized modifier on an item — either stat-flavored ("+15 to Strength") or skill-flavored ("+1 to Pyromancy skills", "Fireball deals +12% damage"). Drops mix stat and skill affixes ~60/40.
_Avoid_: Mod, prefix, suffix (those are sub-categories internal to affix design)

**Unique**:
A named, fixed-stat item with distinct visual identity (e.g., Stone of Jordan). Aspirational chase drop with predictable stats.
_Avoid_: Legendary, exotic

**Refinement**:
An item upgrade level (+0 to +10) gained by **tapping** the item. Acts as a multiplier on all numeric stats on the item. Affix identity unchanged, only magnitude. Refinement cap is bounded by the item's base tier.
_Avoid_: Enhancement, honing, upgrade level, quality (Quality is a separate term — Superior/Normal — inherited from D2)

**Tapping**:
The act of attempting to raise an item's Refinement level by consuming materials. Failure consumes materials but never destroys the item. A pity counter guarantees eventual success at any level.
_Avoid_: Honing, enhancement, upgrading

**Magic Find** (character stat, not gear affix):
A character-level statistic that improves the rarity quality of items dropped to that character. Accumulated via achievements, consumables, and zone modifiers — explicitly *not* a stat that rolls on gear. Decoupling MF from gear is deliberate: it prevents "MF outfit vs combat outfit" splits.
_Avoid_: Item Find, Drop Rate

**Inscription** (punted to post-launch):
Reserved name for a future runeword-equivalent system. Not in launch scope.

### Stats

**Primary stat**:
One of the four foundational character attributes: Strength, Dexterity, Intelligence, Vitality. Sourced entirely from gear, passive tree, and discipline level — never allocated manually on level-up.
_Avoid_: Attribute, ability score

**Strength (STR)**:
Boosts physical damage. Gates heavy weapons and heavy armor.

**Dexterity (DEX)**:
Boosts attack speed and crit chance. Gates ranged weapons and light armor.

**Intelligence (INT)**:
Boosts magic damage and Spirit pool size. Gates caster off-hands and robes.

**Vitality (VIT)**:
Boosts HP and Spirit regen rate. Gates no gear (universally desirable, opportunity cost is missing damage-flavor stats).

**Damage type**:
A tag carried by skills and by item affixes (Fire, Cold, Physical, Bleed, Burn, etc.). Damage-type-flavored affixes ("+15% Fire damage") are the primary build-defining item affix, not raw primary stats.
_Avoid_: Element, school

**Burn**:
A damage-over-time damage type, the Fire-flavored counterpart to Bleed. Applied by some Pyromancy skills as stacking debuffs that tick Fire damage over time. Affixes scale Burn damage and Burn duration independently of base Fire damage, enabling a "burn-stacker" archetype distinct from a "fireball-nuker" archetype within Pyromancy.
_Avoid_: Ignite, scorch, DoT (Burn is the canonical term; "DoT" is a category, not a damage type)

**Frostbite**:
A damage-over-time damage type, the Cold-flavored DoT. Applied by some Cryomancy skills as stacking debuffs that tick Cold damage over time. Mirrors Burn's role for Pyromancy: enables a Frostbite-stacker sub-archetype that scales with stack count and detonation effects.
_Avoid_: Chill (Chill, if used, is a separate slow-effect debuff, not a damage type)

**Poison**:
A damage-over-time damage type distinct from Bleed, applied primarily by Shadowblade. Scales with DEX. Affixes scale Poison damage / duration independently of physical and Bleed damage, enabling a "poison-stacker" Shadowblade archetype distinct from a pure-physical execute-assassin. Lore: alchemical / venomous, not magical.
_Avoid_: Toxin, venom (Poison is the canonical term)

### Endgame

**Rift**:
The core endgame loop content. An instanced two-phase run: a wave-clear phase (dense trash pulls until a kill quota) followed by a mini-boss encounter. ~10–15 min total. Solo or PUG party. Tiered (T1–T10). The replacement for D2 farming runs and the merger of Lost Ark's Chaos Dungeon + Guardian Raid into one loop.
_Avoid_: Dungeon (Dungeon is the architectural term for any instanced zone; Rift is the specific endgame content type)

**Trial**:
A scheduled, group-required (4–8 players), mechanics-heavy boss instance. Harder than Rift bosses. 30–45 min. Weekly lockout on guaranteed-best rewards; runs themselves are unlimited. The Lost Ark abyssal/legion raid analog.
_Avoid_: Raid, abyssal

**World Activity**:
Shared-world content in open zones — world bosses, invasions, scheduled public events. The content that justifies the shared-world architecture; if everything were instanced, the architecture would be a tax with no return.
_Avoid_: World event (too generic), world quest

**Vigor**:
A per-character catchup currency that accumulates while offline or while doing non-Rift content, capped at 7 days' worth. Spending Vigor on a Rift run grants bonus rewards (2× materials, increased unique-drop chance on the boss). Empty Vigor doesn't gate Rifts — base rewards continue indefinitely. The explicit replacement for daily-quest obligation systems.
_Avoid_: Rested, rest bonus, aura of resonance

**Season** (planned):
A D2-ladder-style fresh-economy event. Optional, additive. Seasonal characters merge into the normal realm at season end with gear intact. Lets the economy refresh without obsoleting existing characters. Not in launch scope but reserved as a term.

**Hardcore** (planned):
An opt-in permadeath mode with a separate ladder and economy. Not in launch scope but reserved as a term; the orthogonal design is intentionally easy to add later.

**PvP** (deferred):
Not in launch scope. No dueling, arena, or world PvP planned. The classless 2-discipline system makes PvP balance combinatorially hard, so PvP is deferred until the PvE meta has matured. See ADR-0009.

### Visual conventions

**Rarity color**:
A globally-constant color that signals an item's rarity, never overridden by zone palette: **white** (base), **blue** (magic), **yellow** (rare), **green** (set), **gold** (unique). D2-faithful. The convention is load-bearing — "I dropped a yellow" must be instantly readable in any zone.
_Avoid_: Quality color, tier color

**Zone palette**:
The ~32-color local palette that defines a zone's environmental look. Each zone owns its palette; UI rarity colors are exempt and constant.
_Avoid_: Theme, mood colors

### World & lore

**Vael** (tentative):
The name of the world. Placeholder — finalize before launch but commit to the act of naming it.
_Avoid_: The world (in dialogue/lore), the realm

**The Sundering**:
The reality-warping catastrophe ~30 years ago that shattered the southern continent and opened the Veil. Capitalized; always "the Sundering," never "a sundering."
_Avoid_: The Cataclysm, the Fall, the Break

**The Veil**:
The boundary between the mortal realm and what lies beneath. The Sundering tore holes in it; high-tier Rifts and Trials happen *across* the Veil in adjacent realms.
_Avoid_: The Rift (Rift means endgame content — do not overload), the boundary

**The Wastes**:
The corruption-claimed southern lands abandoned after the Sundering. Where most overworld zones live. Distinct from the Hold(s) (safe) and from the Veil-realms (endgame).
_Avoid_: The wilds, the south, the badlands

**Hold**:
A fortified post-Sundering city that survived. The architectural unit of safe civilization. Multiple Holds exist; the game launches with one playable.
_Avoid_: City, town, settlement (Hold is the canonical term for the safe-zone city archetype)

**Hold Veridian**:
The single launch Hold and main town hub. Home to all 6 discipline trainers, the auction house, vendors, and the primary social/trading space.
_Avoid_: Veridian alone (always "Hold Veridian" on first mention in dialogue)

**The Awakened**:
The player-character archetype. A generation born post-Sundering with the **Mark**, granting the latent ability to learn any combination of magical disciplines from any tradition. The in-world reason the classless system works.
_Avoid_: Adventurer, hero, champion (those are colloquial; "Awakened" is the system-level term)

**The Mark**:
The latent magical sign that identifies an Awakened. Mechanically: the reason a player can learn any 2 disciplines while NPCs cannot.
_Avoid_: The Gift, the Blessing

### Social

**Order**:
The setting-appropriate name for a player guild. A named group of up to 100 Awakened with a 4-character tag shown next to character names. Three ranks (Founder, Officer, Member). Launch features: member list, recruitment notes, Order chat. Deferred: Order bank, Order hall, Order quests, Order-vs-Order.
_Avoid_: Guild (in player-facing UI/dialogue), clan, faction

**Party**:
A temporary group of 2–8 players sharing loot and Rift/Trial entry. Per-character (not per-account). Persists across zone transitions when members move together. The leader controls invites, loot rules, and kicks.
_Avoid_: Group, fireteam

**Party finder**:
A searchable, cross-channel list of parties looking for members for specific content (Rift T7+, Trial-X, etc.). Joining a party warps you to the party leader's channel. The load-bearing solo-friendly feature for group content access.
_Avoid_: LFG, group finder (Party finder is canonical)

**Mailbox**:
Per-account durable message+item+gold inbox. Auction house wins and refunds land here. Items expire after 30 days (returned to sender). Cap 50 messages.
_Avoid_: Inbox, post, courier

## Example dialogue

> **Dev:** A player enters the Ashen Plains. What do they see?
> **Designer:** They land in a channel of the Ashen Plains — let's say channel 3, with maybe 40 other players visible. If channel 3 is full, they get put in channel 4 automatically.
> **Dev:** And when they enter the dungeon at the north end?
> **Designer:** That's an instance — just them and their party. The dungeon doesn't belong to a channel; it's spun up fresh for them.

> **Dev:** A player tells me they're playing a "Frost Archer." Is that a class?
> **Designer:** No — there are no classes. They've equipped two disciplines, probably Cryomancy and Marksman. "Frost Archer" is just the archetype name the community gave that combination.
> **Dev:** And if they want to switch to a Fire Sword Berserker?
> **Designer:** They visit a Blademaster trainer to learn Blademaster, then a Pyromancy trainer. Switching a discipline costs a chunk of gold and they lose their passive tree allocation in the dropped discipline. Skills themselves they re-learn, but the tripod and passive customizations on the old discipline are gone — meaningful weight, not punishing.

> **Dev:** A player just dropped a great rare helmet. What's their next move?
> **Designer:** Three phases. First, they're happy about the affix roll — it's got "+1 Pyromancy skills" and four other useful affixes. That's the find-phase joy. Second, they keep playing and farming better bases — maybe a higher-tier helmet base drops that they'd want to re-roll affixes on. Third, once they're attached to a specific helmet, they start tapping it for Refinement. Late-game players have a +10 favorite item they've been tapping for months.
> **Dev:** What if their +8 helmet fails the +9 tap?
> **Designer:** The materials are gone, but the helmet is fine — it stays at +8. They try again. After enough consecutive failures, a pity counter forces success. No item destruction, ever — that's a deliberate divergence from BDO.

> **Dev:** A new player asks "why can I learn Pyromancy AND Blademaster, but the NPC merchant can't even cast a single spell?"
> **Designer:** Because they're an Awakened. They were born with the Mark. The merchant wasn't. NPCs in lore can sometimes learn a single discipline through years of study; the Awakened can mix two from the start. That's the in-world explanation for why the player is special.
> **Dev:** And the Sundering ties into this how?
> **Designer:** The Awakened started being born in the generation after the Sundering. Some scholars think the Veil tearing changed something about how magic works in mortals; others think the dying gods sowed the Mark as a last act. The game doesn't pick a canonical answer — that ambiguity is part of the setting.
