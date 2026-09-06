import fs from "fs/promises";
import path from "path";
import { createClient } from "redis";

import { type World, worldSchema } from "./types";

const worldFilePath = path.resolve(__dirname, "..", "..", "world.json");
const worldRedisKey = "m-ai:world";
const redisHost = process.env.STORAGE_REDIS_HOST;

const redisClient = redisHost
  ? createClient({
      url: redisHost.includes("://") ? redisHost : `redis://${redisHost}`,
    })
  : null;

let redisConnection: Promise<unknown> | undefined;

const createEmptyWorld = (): World => ({
  diggingChests: [],
  farms: [],
  mainPlayer: process.env.MAIN_PLAYER || undefined,
});

const getRedisClient = async () => {
  if (!redisClient) throw new Error("Redis storage is not configured");

  if (!redisConnection) {
    redisConnection = redisClient.connect().catch((error: unknown) => {
      redisConnection = undefined;
      throw error;
    });
  }

  await redisConnection;

  return redisClient;
};

const getWorld = async (): Promise<null | World> => {
  if (redisClient) {
    const value = await (await getRedisClient()).get(worldRedisKey);

    return value === null ? null : worldSchema.parse(JSON.parse(value));
  }

  try {
    const parsed: unknown = JSON.parse(
      await fs.readFile(worldFilePath, "utf8"),
    );

    return worldSchema.parse(parsed);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;

    throw error;
  }
};

const saveWorld = async (world: World): Promise<void> => {
  worldSchema.parse(world);

  if (redisClient) {
    await (await getRedisClient()).set(worldRedisKey, JSON.stringify(world));

    return;
  }

  await fs.writeFile(worldFilePath, JSON.stringify(world, null, 2));
};

const ensureWorldFile = async (): Promise<boolean> => {
  if (redisClient) {
    const result = await (
      await getRedisClient()
    ).set(worldRedisKey, JSON.stringify(createEmptyWorld()), { NX: true });

    return result === "OK";
  }

  try {
    const handle = await fs.open(worldFilePath, "wx");

    try {
      await handle.writeFile(JSON.stringify(createEmptyWorld(), null, 2));
    } finally {
      await handle.close();
    }

    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;

    throw error;
  }
};

export { ensureWorldFile, getWorld, saveWorld };
