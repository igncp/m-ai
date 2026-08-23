import { type Bot, type Chest } from "mineflayer";
import { goals, Movements } from "mineflayer-pathfinder";
import { type Block } from "prismarine-block";
import { type Item } from "prismarine-item";
import { Vec3 } from "vec3";

import {
  type BotState,
  type Context,
  type FlatRect,
  type Goal,
  type Point3D,
  type Range3D,
  type UpdateEvent,
  botMustKeepItems,
  GoalName,
  LogLevel,
  logLevels,
  skipToDig,
} from "./base";

const getDefaultMovements = (nextState: BotState) => {
  const { bot } = nextState;

  const defaultMovement = new Movements(bot);

  defaultMovement.canDig = false;
  defaultMovement.dontMineUnderFallingBlock = true;
  defaultMovement.canOpenDoors = true;
  defaultMovement.allow1by1towers = true;
  defaultMovement.carpets = new Set();
  defaultMovement.climbables = new Set();
  defaultMovement.allowParkour = false;
  defaultMovement.countScaffoldingItems = () => 0;

  return defaultMovement;
};

const getCanDigBlock = (block: Block, skipTransparent = true) =>
  block.diggable &&
  (!skipTransparent || !block.transparent) &&
  !skipToDig.some((s) => block.name.includes(s));

const formatTime = (timeMs: number): string => {
  const seconds = Math.floor(timeMs / 1000);

  if (seconds < 60) {
    return `${seconds} seconds`;
  }

  const minutes = Math.floor(seconds / 60);

  const remainingSeconds = seconds % 60;

  if (minutes < 60) {
    return `${minutes} minutes and ${remainingSeconds} seconds`;
  }

  const hours = Math.floor(minutes / 60);

  const remainingMinutes = minutes % 60;

  if (hours < 24) {
    return `${hours} hours and ${remainingMinutes} minutes`;
  }

  const days = Math.floor(hours / 24);

  const remainingHours = hours % 24;

  if (days < 7) {
    return `${days} days and ${remainingHours} hours`;
  }

  const weeks = Math.floor(days / 7);

  const remainingDays = days % 7;

  return `${weeks} weeks and ${remainingDays} days`;
};

const getAllBlocksInRange = (
  nextState: BotState,
  focusRange: Range3D,
): Block[] => {
  const { bot } = nextState;
  const allRangeBlocks = [];

  const xRange = [...focusRange[0]].sort((a, b) => a - b);
  const yRange = [...focusRange[1]].sort((a, b) => a - b);
  const zRange = [...focusRange[2]].sort((a, b) => a - b);

  for (let y = yRange[0]; y <= yRange[1]; y++) {
    for (let x = xRange[0]; x <= xRange[1]; x++) {
      for (let z = zRange[0]; z <= zRange[1]; z++) {
        allRangeBlocks.push(new Vec3(x, y, z).floored());
      }
    }
  }

  return allRangeBlocks
    .map((coords) => bot.blockAt(coords))
    .filter((block): block is Block => !!block);
};

const getMainPlayerLookingBlock = (nextState: BotState): Block | null => {
  const { bot } = nextState;

  const mainUser = nextState.world.mainPlayer;

  if (!mainUser) return null;

  const player = bot.players[mainUser];

  if (!player || !player.entity) {
    return null;
  }

  const pitch = player.entity.pitch;
  const yaw = player.entity.yaw;
  const eyePosition = player.entity.position.offset(0, 1.62, 0);

  const lookVector = new Vec3(
    -Math.cos(pitch) * Math.sin(yaw),
    Math.sin(pitch),
    -Math.cos(pitch) * Math.cos(yaw),
  );

  const maxReach = 4.5;
  const stepSize = 0.1;

  let targetedBlock = null;

  for (let d = 0; d < maxReach; d += stepSize) {
    const checkPoint = eyePosition.plus(lookVector.scaled(d));
    const block = bot.blockAt(checkPoint);

    if (
      block &&
      block.type !== 0 &&
      block.name !== "water" &&
      block.name !== "lava"
    ) {
      targetedBlock = block;
      break; // Stop tracking as soon as the ray hits a solid block
    }
  }

  return targetedBlock;
};

const getDiggableBlocks = (
  nextState: BotState,
  range: null | Range3D,
  filter?: (block: Block) => boolean,
) => {
  if (!range) return [];

  return getAllBlocksInRange(nextState, range)
    .filter((block) => {
      if (filter) return filter(block);

      return getCanDigBlock(block);
    })
    .map((block) => block.position);
};

const getEquippedItem = (bot: Bot) => {
  const equippedSlot = bot.getEquipmentDestSlot("hand");

  return typeof equippedSlot === "number"
    ? bot.inventory.slots.find((s) => s?.slot === equippedSlot)
    : null;
};

const throwAll = (
  nextState: BotState,
  onlyItems: string[] = [],
  excludeItems: string[] = [],
) => {
  const { bot } = nextState;

  return bot.inventory.items().reduce(async (p, item) => {
    await p;

    if (onlyItems.length) {
      if (!onlyItems.includes(item.name)) return;

      return bot.tossStack(item);
    }

    if (botMustKeepItems.concat(excludeItems).some((s) => item.name === s))
      return;

    return bot.tossStack(item);
  }, Promise.resolve());
};

const openChest = async (
  nextState: BotState,
  chest: Point3D,
): Promise<Chest> => {
  const { bot } = nextState;
  const chestVec = new Vec3(chest[0], chest[1], chest[2]);

  return bot.pathfinder
    .goto(new goals.GoalNear(chest[0], chest[1], chest[2], 4))
    .then(async () => {
      const block = bot.blockAt(chestVec);

      if (!block) {
        bot.chat("I cannot find the chest");

        throw new Error("Cannot find the chest");
      }

      const p = await bot.openChest(block);

      return new Promise<Chest>((resolve) => {
        setTimeout(() => {
          resolve(p);
        }, 500);
      });
    });
};

const depositItemsInChest = async (nextState: BotState, chest: Chest) => {
  const { bot } = nextState;
  const chestEmptySlots = chest.emptySlotCount();

  const unnecessaryItems = bot.inventory
    .items()
    .filter((item) => botMustKeepItems.every((s) => !item?.name?.includes(s)));

  if (unnecessaryItems.length && chestEmptySlots) {
    chatDebug(nextState, "Depositing unnecessary items");

    for (let i = 0; i < chestEmptySlots; i++) {
      const item = unnecessaryItems[i];

      if (!item) {
        break;
      }

      await chest.deposit(item.type, null, item.count);
    }
  }
};

const goToGetItem = async (
  context: Context,
  opts: {
    chests: Point3D[];
    finishEvent?: UpdateEvent;
    item: { name: string } | { suffix: string };
    meanwhileGoal?: Goal | null;
    stackInfo: [number, number];
  },
): Promise<Context> => {
  const [nextState] = context;
  const { bot } = nextState;

  const [howManyStacks, howManyPerStack] = opts.stackInfo;

  nextState.currentGoal = opts.meanwhileGoal || null;

  nextState.constantGoal =
    (nextState.constantGoal && opts.meanwhileGoal) || null;

  const [closestChest] = opts.chests.reduce(
    ([chest, distance], chestPoint) => {
      const chestVec = new Vec3(chestPoint[0], chestPoint[1], chestPoint[2]);
      const thisDistance = chestVec.distanceTo(bot.entity.position);

      return thisDistance < distance
        ? [chestPoint, thisDistance]
        : [chest, distance];
    },
    [null, Infinity] as [null | Point3D, number],
  );

  if (!closestChest) {
    bot.chat("No known chests");

    return context;
  }

  chatDebug(
    nextState,
    `Going to the closest chest at ${closestChest.toString()}`,
  );

  const { finishEvent, item } = opts;

  const itemStr = JSON.stringify(item);
  const [, eventsQueue] = context;

  const asyncAction = () =>
    openChest(nextState, closestChest)
      .then(async (chest) => {
        await depositItemsInChest(nextState, chest);

        const itemsInChest = chest.slots.filter((targetItem) => {
          if (!targetItem) return false;

          if ("name" in item) {
            return targetItem.name === item.name;
          }

          return targetItem.name.endsWith(item.suffix);
        });

        if (!itemsInChest.length) {
          bot.chat(`I cannot find a ${itemStr} in the chest`);

          throw new Error(`Cannot find a ${itemStr} in the chest`);
        }

        chatDebug(nextState, `Getting some ${itemStr}`);

        const maxItems = itemsInChest
          .filter((item) => item && item.count >= howManyPerStack)
          .slice(0, howManyStacks);

        const itemInChest = itemsInChest[0];

        if (!itemInChest) {
          throw new Error(`No ${itemStr} found`);
        }

        for (let i = 0; i < maxItems.length; i++) {
          await chest.withdraw(itemInChest.type, null, howManyPerStack);
        }

        chest.close();
      })
      .catch((err) => {
        console.error("debug: utils.ts: err", err);

        const chestVec = new Vec3(
          closestChest[0],
          closestChest[1],
          closestChest[2],
        );

        const chestBlock = bot.blockAt(chestVec);

        bot.chat(
          `Error trying to get a ${itemStr}, the block is a: ${chestBlock?.position.toString() || "unknown"}`,
        );
      })
      .then(() => eventsQueue.push(finishEvent || { type: "interval" }));

  await asyncAction();

  return context;
};

const getDiggingUpdateEvent = (
  initialBlock: NonNullable<BotState["initialBlock"]>,
  focusRange: NonNullable<BotState["focusRange"]>,
): UpdateEvent =>
  ({
    focusRange,
    goal: GoalName.DigRange,
    initialBlock,
    type: "setState",
  }) satisfies UpdateEvent;

const sortByInitialBlock = (state: BotState) => {
  const { initialBlock } = state;

  if (!initialBlock) return () => 0;

  const initialBlockVec = new Vec3(
    initialBlock[0],
    initialBlock[1],
    initialBlock[2],
  );

  return (a: Vec3, b: Vec3) => {
    const distanceA = initialBlockVec.distanceTo(a);
    const distanceB = initialBlockVec.distanceTo(b);

    return distanceA - distanceB;
  };
};

const ensureItem = (
  context: Context,
  opts: Parameters<typeof goToGetItem>[1],
):
  | { item: Item; switchReturn: null }
  | { item: null; switchReturn: Promise<Context> } => {
  const [nextState] = context;
  const { bot } = nextState;

  const item = bot.inventory.items().find((item) => {
    if (!item) return false;

    if ("name" in opts.item) {
      return item.name === opts.item.name;
    }

    return item.name.endsWith(opts.item.suffix);
  });

  if (!item) {
    return {
      item: null,
      switchReturn: goToGetItem(context, opts),
    };
  }

  return { item, switchReturn: null };
};

const shovelBlocks = ["dirt", "sand", "gravel", "grass_block"];
const axeBlocks = ["log", "wood", "_log", "_leaves"];

const equipBestToolForBlock = (
  context: Context,
  opts: {
    allowDiggingWithHand?: boolean;
    chests: Point3D[];
    finishEvent: UpdateEvent;
    targetDigBlock: Block;
  },
): null | Promise<Context> => {
  const [nextState] = context;
  const { bot } = nextState;

  const equippedItem = getEquippedItem(bot);
  const { chests, finishEvent } = opts;

  for (const [diggingBlocks, itemName] of [
    [axeBlocks, "stone_axe"],
    [shovelBlocks, "stone_shovel"],
    [null, "stone_pickaxe"],
  ] as [null | string[], string][]) {
    if (
      !diggingBlocks ||
      diggingBlocks.some((d) => opts.targetDigBlock.name.endsWith(d))
    ) {
      if (equippedItem?.name === itemName) {
        return null;
      }

      if (opts.allowDiggingWithHand) {
        const matchingItem = bot.inventory.items().find((item) => {
          if (!item) return false;

          return item.name === itemName;
        });

        if (!matchingItem) {
          return null;
        }

        chatDebug(nextState, `Equipping ${itemName}`);
        bot.equip(matchingItem, "hand").catch(() => {});

        return null;
      }

      const { item, switchReturn } = ensureItem(context, {
        chests,
        finishEvent,
        item: { name: itemName },
        stackInfo: [3, 1],
      });

      if (switchReturn) return switchReturn;

      chatDebug(nextState, `Equipping ${itemName}`);

      if (item) bot.equip(item, "hand").catch(() => {});

      return null;
    }
  }

  return null;
};

const logChat = (state: BotState, level: LogLevel, ...rest: unknown[]) => {
  const { bot, logLevel } = state;
  const logLevelPos = logLevels.indexOf(logLevel);
  const levelPos = logLevels.indexOf(level);

  if (logLevelPos > levelPos) return;

  bot.chat(rest.join(" "));
};

const chatDebug = (state: BotState, ...rest: unknown[]) =>
  logChat(state, LogLevel.Debug, ...rest);

const getIsInFlatSquare = (nextState: BotState, flatSquare: FlatRect) => {
  const { bot } = nextState;
  const { x, y, z } = bot.entity.position;

  if (Math.abs(flatSquare.y - y) > 2) return false;

  const sortedX = [...flatSquare.x].sort((a, b) => a - b);
  const sortedZ = [...flatSquare.z].sort((a, b) => a - b);

  return (
    x >= sortedX[0] && x <= sortedX[1] && z >= sortedZ[0] && z <= sortedZ[1]
  );
};

const goToFlatSquare = async (
  context: Context,
  flatSquare: FlatRect,
  distance: number,
  onComplete: () => Promise<void>,
): Promise<Context> => {
  const [nextState] = context;

  const asyncAction = async (): Promise<UpdateEvent | void> => {
    const { bot } = nextState;
    const { x, y, z } = flatSquare;
    const targetX = (x[0] + x[1]) / distance;
    const targetZ = (z[0] + z[1]) / distance;

    return bot.pathfinder
      .goto(new goals.GoalNear(targetX, y, targetZ, distance))
      .catch((err) => {
        bot.chat("Error trying to go to flat square");
        console.error("debug: utils.ts: err", err);
      })
      .then(onComplete);
  };

  await asyncAction();

  return context;
};

const clearAllGoals = async (context: Context): Promise<Context> => {
  const [nextState] = context;
  const { bot } = nextState;

  bot.pathfinder.setGoal(null);

  nextState.currentGoal = null;
  nextState.constantGoal = null;

  return context;
};

const confirmAllBlocksOfType = (
  nextState: BotState,
  flatSquare: FlatRect,
  blockTypes: Set<string>,
): boolean => {
  const { bot } = nextState;
  const { x: xRange, y, z: zRange } = flatSquare;
  const sortedXRange = [...xRange].sort((a, b) => a - b);
  const sortedZRange = [...zRange].sort((a, b) => a - b);

  for (let x = sortedXRange[0]; x <= sortedXRange[1]; x++) {
    for (let z = sortedZRange[0]; z <= sortedZRange[1]; z++) {
      const block = bot.blockAt(new Vec3(x, y, z));

      if (!block) continue;

      if (block.type === 0) continue;

      if (!blockTypes.has(block.name)) {
        bot.chat(
          `I found a ${block.name} block at ${new Vec3(x, y, z)} which is not expected`,
        );

        return false;
      }
    }
  }

  return true;
};

export {
  chatDebug,
  clearAllGoals,
  confirmAllBlocksOfType,
  depositItemsInChest,
  ensureItem,
  equipBestToolForBlock,
  formatTime,
  getAllBlocksInRange,
  getCanDigBlock,
  getDefaultMovements,
  getDiggableBlocks,
  getDiggingUpdateEvent,
  getEquippedItem,
  getIsInFlatSquare,
  getMainPlayerLookingBlock,
  goToFlatSquare,
  goToGetItem,
  openChest,
  sortByInitialBlock,
  throwAll,
};
