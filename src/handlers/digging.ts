import { goals } from "mineflayer-pathfinder";
import notifier from "node-notifier";
import { Vec3 } from "vec3";

import {
  type BotState,
  type Context,
  DISTANCE_BETWEEN_TORCHES_RANGE,
} from "../base";
import {
  chatDebug,
  ensureItem,
  equipBestToolForBlock,
  getDefaultMovements,
  getDiggableBlocks,
  getDiggingUpdateEvent,
  sortByInitialBlock,
} from "../utils";

const getShouldPlaceTorch = (nextState: BotState) => {
  const { bot } = nextState;

  if (!nextState.addTorches) {
    return false;
  }

  const closestTorch = bot
    .findBlocks({
      count: 100000000,
      matching: (block) => block.name === "torch",
      maxDistance: 20,
    })
    .sort((a, b) => {
      const distanceA = bot.entity.position.distanceTo(a);
      const distanceB = bot.entity.position.distanceTo(b);

      return distanceA - distanceB;
    })[0];

  const closestTorchDistance = closestTorch
    ? closestTorch.distanceTo(bot.entity.position)
    : Infinity;

  return closestTorchDistance >= DISTANCE_BETWEEN_TORCHES_RANGE;
};

const placeTorch = async (context: Context): Promise<Context> => {
  const [nextState] = context;
  const { bot, currentGoal, focusRange, initialBlock } = nextState;

  if (!focusRange || !initialBlock) {
    nextState.currentGoal = null;
    bot.chat("I don't have a focus range, stopping");

    return context;
  }

  const { world } = nextState;

  const { item: torch, switchReturn: torchSwitchReturn } = ensureItem(context, {
    chests: world.diggingChests,
    finishEvent: getDiggingUpdateEvent(initialBlock, focusRange),
    item: { name: "torch" },
    stackInfo: [1, 8],
  });

  if (torchSwitchReturn) return torchSwitchReturn;

  const position = bot.entity.position.clone();

  position.y = Math.floor(position.y - 1);
  position.x = Math.floor(position.x);
  position.z = Math.floor(position.z);

  const block = bot.blockAt(position);

  if (!block) {
    bot.chat("I cannot place a torch here, stopping");
    nextState.currentGoal = null;

    return context;
  }

  bot.chat("I have torches, placing one at " + position.toString());

  nextState.currentGoal = null;

  if (torch)
    await bot
      .equip(torch, "hand")
      .then(() => bot.placeBlock(block, new Vec3(0, 1, 0)))
      .then(() => {
        bot.chat("Torch placed");
        nextState.currentGoal = currentGoal;
      })
      .catch((e) => {
        console.error("Error place torch", e);
      });

  return context;
};

const handleDigging = async (context: Context): Promise<Context> => {
  const [nextState] = context;
  const { bot } = nextState;

  const { targetDigBlock } = bot;

  const { focusRange, initialBlock } = nextState;

  if (!initialBlock || !focusRange) {
    bot.chat("I don't have an initial block, stopping");
    nextState.currentGoal = null;

    return context;
  }

  if (targetDigBlock) {
    const { world } = nextState;

    return (
      equipBestToolForBlock(context, {
        allowDiggingWithHand: nextState.allowDigWithHand,
        chests: world.diggingChests,
        finishEvent: getDiggingUpdateEvent(initialBlock, focusRange),
        targetDigBlock,
      }) || context
    );
  }

  const possibleBlocks = getDiggableBlocks(
    nextState,
    nextState.focusRange,
  ).sort(sortByInitialBlock(nextState));

  if (!possibleBlocks.length) {
    bot.chat("I cannot find any blocks to dig");

    notifier.notify({
      message: "I cannot find any blocks to dig",
      title: "Minecraft Bot",
    });

    nextState.currentGoal = null;

    return context;
  }

  const item = possibleBlocks.find((coords) => {
    const block = bot.blockAt(coords);

    return block && bot.canDigBlock(block);
  });

  const target = item ? bot.blockAt(item) : null;

  if (target) {
    if (getShouldPlaceTorch(nextState)) {
      return placeTorch(context);
    }

    chatDebug(nextState, `Starting to dig ${target.name}`);

    const blockDistance = bot.entity.position.distanceTo(target.position);

    if (blockDistance > 6) {
      bot.lookAt(target.position);
      nextState.currentGoal = null;

      chatDebug(nextState, "Going to the block");

      const [, eventsQueue] = context;

      const asyncAction = () =>
        bot.pathfinder
          .goto(
            new goals.GoalNear(
              target.position.x,
              target.position.y,
              target.position.z,
              4,
            ),
          )
          .then(() =>
            eventsQueue.push(getDiggingUpdateEvent(initialBlock, focusRange)),
          )
          .catch(() => eventsQueue.push({ type: "clear" }));

      await asyncAction();
    } else {
      bot.dig(target).catch(() => {});
    }

    return context;
  }

  const firstItem = possibleBlocks[0];

  nextState.currentGoal = null;

  chatDebug(nextState, "Going to the block which is far");

  const [, eventsQueue] = context;

  const asyncAction = () => {
    const attemptDig = async (attempNum: number) => {
      const movements = getDefaultMovements(nextState);

      movements.allowParkour = true;
      movements.allowFreeMotion = true;
      movements.allow1by1towers = true;
      movements.scafoldingBlocks = [bot.registry.blocksByName["dirt"].id];

      bot.pathfinder.setMovements(movements);

      return bot.pathfinder
        .goto(new goals.GoalNear(firstItem.x, firstItem.y, firstItem.z, 4))
        .then(() => {
          const defaultMovements = getDefaultMovements(nextState);

          bot.pathfinder.setMovements(defaultMovements);

          eventsQueue.push(getDiggingUpdateEvent(initialBlock, focusRange));
        })
        .catch((err) => {
          if (attempNum >= 3) {
            bot.chat("Stopping");
            console.error("Error digging", err);

            eventsQueue.push({ type: "clear" });
          } else {
            bot.chat("I cannot reach the block");

            attemptDig(attempNum + 1);
          }
        });
    };

    return attemptDig(0);
  };

  await asyncAction();

  return context;
};

export { handleDigging };
