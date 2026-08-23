import fs from "fs/promises";
import path from "path";

import { type World, worldSchema } from "./types";

const worldFilePath = path.resolve(
  __dirname,
  "..",
  "..",
  "server",
  "world.json",
);

const emptyWorld = {
  diggingChests: [],
  farms: [],
  mainPlayer: undefined,
} satisfies World;

const getWorld = async (): Promise<null | World> => {
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

  await fs.writeFile(worldFilePath, JSON.stringify(world, null, 2));
};

const ensureWorldFile = async (): Promise<boolean> => {
  try {
    const handle = await fs.open(worldFilePath, "wx");

    try {
      await handle.writeFile(JSON.stringify(emptyWorld, null, 2));
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
