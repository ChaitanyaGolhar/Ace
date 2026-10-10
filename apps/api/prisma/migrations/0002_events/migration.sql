-- Product events (M4): append-only, synced like review logs, never containing card text.
CREATE TABLE "events" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "occurred_at" BIGINT NOT NULL,
    "device_id" TEXT NOT NULL,
    "props" JSONB NOT NULL,
    "server_seq" BIGINT NOT NULL,

    CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "events_user_id_server_seq_idx" ON "events"("user_id", "server_seq");
CREATE INDEX "events_type_idx" ON "events"("type");
