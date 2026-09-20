CREATE SEQUENCE IF NOT EXISTS "World_id_seq";

ALTER TABLE "World" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "World" ALTER COLUMN "id" SET DEFAULT nextval('"World_id_seq"');
SELECT setval('"World_id_seq"', COALESCE((SELECT MAX("id") FROM "World"), 1));

ALTER TABLE "World" ADD COLUMN IF NOT EXISTS "minecraftWorldId" UUID;
CREATE UNIQUE INDEX IF NOT EXISTS "World_minecraftWorldId_key" ON "World"("minecraftWorldId");
