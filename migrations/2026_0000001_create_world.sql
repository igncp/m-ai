CREATE TABLE IF NOT EXISTS "World" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "mainPlayer" TEXT,

    CONSTRAINT "World_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "DiggingChest" (
    "id" SERIAL NOT NULL,
    "worldId" INTEGER NOT NULL,
    "position" INTEGER NOT NULL,
    "x" DOUBLE PRECISION NOT NULL,
    "y" DOUBLE PRECISION NOT NULL,
    "z" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "DiggingChest_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Farm" (
    "id" SERIAL NOT NULL,
    "worldId" INTEGER NOT NULL,
    "position" INTEGER NOT NULL,
    "chestX" DOUBLE PRECISION NOT NULL,
    "chestY" DOUBLE PRECISION NOT NULL,
    "chestZ" DOUBLE PRECISION NOT NULL,
    "trees" JSONB NOT NULL,
    "wheat" JSONB NOT NULL,

    CONSTRAINT "Farm_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "DiggingChest_worldId_position_key" ON "DiggingChest"("worldId", "position");
CREATE UNIQUE INDEX IF NOT EXISTS "Farm_worldId_position_key" ON "Farm"("worldId", "position");

DO $$ BEGIN
  ALTER TABLE "DiggingChest" ADD CONSTRAINT "DiggingChest_worldId_fkey" FOREIGN KEY ("worldId") REFERENCES "World"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "Farm" ADD CONSTRAINT "Farm_worldId_fkey" FOREIGN KEY ("worldId") REFERENCES "World"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
