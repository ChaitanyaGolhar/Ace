-- M7 deck store (BUILD_BRIEF_M6_M8 §7.3, §7.5). Additive only: new nullable columns and
-- new tables. Existing decks keep NULL catalog fields (they are user or ready-made decks),
-- so there is nothing to backfill, and the previous API build keeps working on this
-- schema (it never reads or writes these columns).

-- A student's copy of a catalog deck remembers where it came from (synced fields).
ALTER TABLE "decks" ADD COLUMN "catalog_slug" TEXT;
ALTER TABLE "decks" ADD COLUMN "catalog_version" INTEGER;

-- Catalog decks, published by the owner with the `pnpm deck` CLI. No API writes them.
CREATE TABLE "catalog_deck" (
    "slug" TEXT NOT NULL,
    "latest_version" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'published',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "catalog_deck_pkey" PRIMARY KEY ("slug"),
    CONSTRAINT "catalog_deck_status_check" CHECK ("status" IN ('published', 'unlisted'))
);

-- One row per published version: the full validated ace-deck@2 file. Immutable.
CREATE TABLE "catalog_deck_version" (
    "slug" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "content" JSONB NOT NULL,
    "checksum" TEXT NOT NULL,
    "card_count" INTEGER NOT NULL,
    "type_counts" JSONB NOT NULL,
    "published_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "catalog_deck_version_pkey" PRIMARY KEY ("slug", "version"),
    CONSTRAINT "catalog_deck_version_slug_fkey" FOREIGN KEY ("slug") REFERENCES "catalog_deck"("slug") ON DELETE RESTRICT ON UPDATE RESTRICT
);

-- Published versions can never change: students' copies and update diffs depend on them.
CREATE FUNCTION "catalog_deck_version_immutable"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'catalog_deck_version rows are immutable (publish a new version instead)';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "catalog_deck_version_no_change"
  BEFORE UPDATE OR DELETE ON "catalog_deck_version"
  FOR EACH ROW EXECUTE FUNCTION "catalog_deck_version_immutable"();
