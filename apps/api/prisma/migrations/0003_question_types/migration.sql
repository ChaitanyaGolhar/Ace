-- M6 question types (BUILD_BRIEF_M6_M8 §6.2, §6.4). Additive only: no column is
-- dropped or renamed, so the pre-M6 API keeps working if it has to be rolled back.

-- Cards: type and structured content. Every existing card becomes a basic card with
-- the same front/back. `content` stays nullable and `type` defaults to 'basic', so
-- pre-M6 code can still insert cards; the API reads a NULL content as basic.
ALTER TABLE "cards" ADD COLUMN "type" TEXT NOT NULL DEFAULT 'basic';
ALTER TABLE "cards" ADD COLUMN "content" JSONB;
ALTER TABLE "cards" ADD COLUMN "unit" INTEGER;
ALTER TABLE "cards" ADD COLUMN "source_key" TEXT;
ALTER TABLE "cards" ADD COLUMN "source_hash" TEXT;

-- Backfill without touching server_seq: the data clients already hold doesn't change.
UPDATE "cards"
SET "content" = jsonb_build_object('type', 'basic', 'front', "front", 'back', "back")
WHERE "content" IS NULL;

-- Review logs: what happened in the review (never typed text). NULL for older logs.
ALTER TABLE "review_logs" ADD COLUMN "outcome" JSONB;
