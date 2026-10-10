-- M8 paid decks (BUILD_BRIEF_M6_M8 §8.1). Additive only: three new tables. Nothing
-- existing changes, so the previous API build keeps working on this schema.

-- Unlock codes. Only a hash of each code is stored, never the code itself.
CREATE TABLE "unlock_code" (
    "id" TEXT NOT NULL,
    "code_hash" TEXT NOT NULL,
    "slugs" TEXT[] NOT NULL,
    "max_redemptions" INTEGER NOT NULL DEFAULT 1,
    "redemption_count" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMP(3),
    "note" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "disabled_at" TIMESTAMP(3),

    CONSTRAINT "unlock_code_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "unlock_code_slugs_check" CHECK (cardinality("slugs") >= 1),
    CONSTRAINT "unlock_code_max_check" CHECK ("max_redemptions" >= 1),
    CONSTRAINT "unlock_code_count_check" CHECK ("redemption_count" >= 0 AND "redemption_count" <= "max_redemptions")
);
CREATE UNIQUE INDEX "unlock_code_code_hash_key" ON "unlock_code"("code_hash");

-- Who redeemed which code (one row per user and code: re-redeeming is idempotent).
CREATE TABLE "unlock_redemption" (
    "code_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "unlock_redemption_pkey" PRIMARY KEY ("code_id", "user_id"),
    CONSTRAINT "unlock_redemption_code_id_fkey" FOREIGN KEY ("code_id") REFERENCES "unlock_code"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "unlock_redemption_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- What a user may download: one row per user and paid deck.
CREATE TABLE "entitlement" (
    "user_id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'code',
    "code_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "entitlement_pkey" PRIMARY KEY ("user_id", "slug"),
    CONSTRAINT "entitlement_source_check" CHECK ("source" IN ('code')),
    CONSTRAINT "entitlement_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "entitlement_code_id_fkey" FOREIGN KEY ("code_id") REFERENCES "unlock_code"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
