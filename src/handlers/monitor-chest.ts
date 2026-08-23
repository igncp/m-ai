import { goals } from "mineflayer-pathfinder";
import { Vec3 } from "vec3";

import { type Context, GoalName } from "../base";

const handleMonitorChest = async (context: Context): Promise<Context> => {
  const [nextState] = context;
  const { bot, constantGoal, currentGoal } = nextState;
  const goal = constantGoal || currentGoal;

  if (
    typeof goal !== "object" ||
    goal?.name !== GoalName.MonitorChest ||
    goal.opts.isGoing
  ) {
    return context;
  }

  const { world } = nextState;

  const chest = (() => {
    const { chestIndex, chestType } = goal.opts;

    switch (chestType) {
      case "digging":
        return world.diggingChests[chestIndex];
      case "farm":
        return world.farms.map((farm) => farm.chest)[chestIndex];
      default:
        chestType satisfies never;
    }
  })();

  if (!chest) {
    bot.chat("No known chests");

    process.exit(1);
  }

  goal.opts.isGoing = true;

  let isFirstTime = true;

  const asyncAction = () => {
    const recursiveAction = () =>
      bot.pathfinder
        .goto(new goals.GoalNear(chest[0], chest[1], chest[2], 4))
        .then(async (): Promise<void> => {
          const chestVec = new Vec3(chest[0], chest[1], chest[2]);
          const block = bot.blockAt(chestVec);

          if (!block) {
            bot.chat("I cannot find the chest");

            throw new Error("Cannot find the chest");
          }

          const chestObj = await bot.openChest(block);

          if (isFirstTime)
            bot.chat(`Monitoring the chest at ${chest.toString()}`);

          isFirstTime = false;

          goal.opts.chest = chestObj;

          await new Promise((resolve) => setTimeout(resolve, 1_000));

          return recursiveAction();
        })
        .catch(async (): Promise<void> => {
          bot.chat(
            "Error while going to the chest for monitoring, waiting 10 seconds",
          );

          await new Promise((resolve) => setTimeout(resolve, 10_000));

          return recursiveAction();
        });

    return recursiveAction();
  };

  await asyncAction();

  return context;
};

export { handleMonitorChest };
