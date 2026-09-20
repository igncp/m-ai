import { pool } from "./database";
import { type Farm, type World, worldSchema } from "./types";

type FarmRow = {
  chestX: number;
  chestY: number;
  chestZ: number;
  trees: Farm["trees"];
  wheat: Farm["wheat"];
};

type Point3DRow = { x: number; y: number; z: number };

type WorldRow = { id: number; mainPlayer: null | string };

const createEmptyWorld = (): World => ({
  diggingChests: [],
  farms: [],
  mainPlayer: process.env.MAIN_PLAYER || undefined,
});

const getWorld = async (minecraftWorldId: string): Promise<null | World> => {
  const world = await pool.query<WorldRow>(
    'SELECT "id", "mainPlayer" FROM "World" WHERE "minecraftWorldId" = $1',
    [minecraftWorldId],
  );

  if (!world.rowCount) return null;

  const worldId = world.rows[0].id;

  const [diggingChests, farms] = await Promise.all([
    pool.query<Point3DRow>(
      'SELECT "x", "y", "z" FROM "DiggingChest" WHERE "worldId" = $1 ORDER BY "position"',
      [worldId],
    ),
    pool.query<FarmRow>(
      'SELECT "chestX", "chestY", "chestZ", "trees", "wheat" FROM "Farm" WHERE "worldId" = $1 ORDER BY "position"',
      [worldId],
    ),
  ]);

  return worldSchema.parse({
    diggingChests: diggingChests.rows.map(({ x, y, z }) => [x, y, z]),
    farms: farms.rows.map(({ chestX, chestY, chestZ, trees, wheat }) => ({
      chest: [chestX, chestY, chestZ],
      trees,
      wheat,
    })),
    mainPlayer: world.rows[0].mainPlayer || undefined,
  });
};

const saveWorld = async (
  minecraftWorldId: string,
  world: World,
): Promise<void> => {
  worldSchema.parse(world);

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const result = await client.query<WorldRow>(
      'INSERT INTO "World" ("minecraftWorldId", "mainPlayer") VALUES ($1, $2) ON CONFLICT ("minecraftWorldId") DO UPDATE SET "mainPlayer" = EXCLUDED."mainPlayer" RETURNING "id", "mainPlayer"',
      [minecraftWorldId, world.mainPlayer || null],
    );

    const worldId = result.rows[0].id;

    await client.query('DELETE FROM "DiggingChest" WHERE "worldId" = $1', [
      worldId,
    ]);

    await client.query('DELETE FROM "Farm" WHERE "worldId" = $1', [worldId]);

    for (const [position, [x, y, z]] of world.diggingChests.entries()) {
      await client.query(
        'INSERT INTO "DiggingChest" ("worldId", "position", "x", "y", "z") VALUES ($1, $2, $3, $4, $5)',
        [worldId, position, x, y, z],
      );
    }

    for (const [position, { chest, trees, wheat }] of world.farms.entries()) {
      await client.query(
        'INSERT INTO "Farm" ("worldId", "position", "chestX", "chestY", "chestZ", "trees", "wheat") VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [
          worldId,
          position,
          ...chest,
          JSON.stringify(trees),
          JSON.stringify(wheat),
        ],
      );
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

const ensureWorld = async (minecraftWorldId: string): Promise<boolean> => {
  const legacyWorld = await pool.query(
    'UPDATE "World" SET "minecraftWorldId" = $1 WHERE "id" = 1 AND "minecraftWorldId" IS NULL',
    [minecraftWorldId],
  );

  if (legacyWorld.rowCount) return true;

  const result = await pool.query(
    'INSERT INTO "World" ("minecraftWorldId", "mainPlayer") VALUES ($1, $2) ON CONFLICT ("minecraftWorldId") DO NOTHING',
    [minecraftWorldId, createEmptyWorld().mainPlayer || null],
  );

  return result.rowCount === 1;
};

export { ensureWorld, getWorld, saveWorld };
