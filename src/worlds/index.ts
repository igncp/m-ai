import { daemonClient } from "../daemon-client";
import { type World } from "./types";

const saveDiggingChest = async (
  world: World,
  coords: [number, number, number],
): Promise<"exists" | "new"> => {
  if (
    world.diggingChests.some((chest) =>
      [0, 1, 2].every((index) => chest[index] === coords[index]),
    )
  )
    return "exists";

  await daemonClient.saveWorld({
    ...world,
    diggingChests: world.diggingChests.concat([coords]),
  });

  return "new";
};

const getMainUsername = (world: World): string => {
  if (!world.mainPlayer) throw new Error("world.json mainPlayer is not set");

  return world.mainPlayer;
};

export { getMainUsername, saveDiggingChest };
