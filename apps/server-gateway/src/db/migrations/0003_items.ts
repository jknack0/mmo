import { Kysely, sql } from 'kysely';

// S13 (#15) — itemization tables, per ADR-0013 (server-issued UUID items;
// an item exists iff a Postgres row exists). Whites only at this slice; the
// affixes JSONB + refinement/pity columns are present now so S14/S15 add data,
// not schema.
export async function up(db: Kysely<unknown>): Promise<void> {
  // ── items: the canonical item instance. owner null = lying on the ground. ──
  await db.schema
    .createTable('items')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`uuid_generate_v4()`))
    .addColumn('owner_character_id', 'uuid', (col) =>
      col.references('characters.id').onDelete('cascade')
    )
    .addColumn('base_id', 'text', (col) => col.notNull())
    .addColumn('affixes', 'jsonb', (col) => col.notNull().defaultTo(sql`'[]'::jsonb`))
    .addColumn('refinement', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('pity_counter', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute();

  await db.schema
    .createIndex('items_owner_idx')
    .on('items')
    .column('owner_character_id')
    .execute();

  // ── inventory: carried items in a grid slot. One item is in exactly one
  //    place, enforced by the unique item_id across inventory + equipped. ──
  await db.schema
    .createTable('inventory')
    .addColumn('character_id', 'uuid', (col) =>
      col.notNull().references('characters.id').onDelete('cascade')
    )
    .addColumn('slot', 'integer', (col) => col.notNull())
    .addColumn('item_id', 'uuid', (col) =>
      col.notNull().unique().references('items.id').onDelete('cascade')
    )
    .addPrimaryKeyConstraint('inventory_pk', ['character_id', 'slot'])
    .execute();

  // ── equipped: items in a gear slot (weapon, off-hand, head … ring-1/2, neck). ──
  await db.schema
    .createTable('equipped')
    .addColumn('character_id', 'uuid', (col) =>
      col.notNull().references('characters.id').onDelete('cascade')
    )
    .addColumn('gear_slot', 'text', (col) => col.notNull())
    .addColumn('item_id', 'uuid', (col) =>
      col.notNull().unique().references('items.id').onDelete('cascade')
    )
    .addPrimaryKeyConstraint('equipped_pk', ['character_id', 'gear_slot'])
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('equipped').execute();
  await db.schema.dropTable('inventory').execute();
  await db.schema.dropTable('items').execute();
}
