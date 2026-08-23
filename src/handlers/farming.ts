import { goals } from "mineflayer-pathfinder";
import { Vec3 } from "vec3";

import {
  type BotState,
  type Context,
  type FlatRect,
  type Goal,
  type Range3D,
  type UpdateEvent,
  GoalName,
  skipToDig,
} from "../base";
import {
  chatDebug,
  clearAllGoals,
  confirmAllBlocksOfType,
  depositItemsInChest,
  ensureItem,
  equipBestToolForBlock,
  getAllBlocksInRange,
  getDefaultMovements,
  getIsInFlatSquare,
  goToFlatSquare,
  openChest,
} from "../utils";

const getIsInFarm = (nextState: BotState, cropObj: FlatRect): boolean =>
  getIsInFlatSquare(nextState, cropObj);

const getFinishEvent = (nextState: BotState): UpdateEvent => {
  const { bot } = nextState;

  const goal = (nextState.constantGoal || nextState.currentGoal) as Extract<
    Goal,
    { name: GoalName.ManageFarm }
  >;

  const defaultMovement = getDefaultMovements(nextState);

  bot.pathfinder.setMovements(defaultMovement);

  return {
    goal: {
      name: GoalName.ManageFarm,
      opts: {
        ...goal.opts,
        isGoing: false,
      },
    },
    type: "setState",
  };
};

const goToFarm = async (context: Context, farm: FlatRect): Promise<Context> => {
  const [nextState] = context;

  const goal = (nextState.constantGoal || nextState.currentGoal) as Extract<
    Goal,
    { name: GoalName.ManageFarm }
  >;

  goal.opts.isGoing = true;

  const [, eventsQueue] = context;

  return goToFlatSquare(context, farm, 2, async () => {
    eventsQueue.push(getFinishEvent(nextState));
  });
};

const goToWalking = (
  nextState: BotState,
  position: Vec3,
  distance: number,
): Promise<void> => {
  const { bot } = nextState;

  const goal = (nextState.constantGoal || nextState.currentGoal) as Extract<
    Goal,
    { name: GoalName.ManageFarm }
  >;

  const defaultMovement = getDefaultMovements(nextState);

  defaultMovement.allowSprinting = false;
  defaultMovement.allowFreeMotion = false;
  defaultMovement.canDig = false;

  defaultMovement.blocksCantBreak = new Set([
    bot.registry.blocksByName["farmland"].id,
  ]);

  bot.pathfinder.setMovements(defaultMovement);

  goal.opts.isGoing = true;

  return bot.pathfinder.goto(
    new goals.GoalNear(position.x, position.y, position.z, distance),
  );
};

const handleFarming = async (context: Context): Promise<Context> => {
  const [nextState] = context;
  const goal = nextState.constantGoal || nextState.currentGoal;

  if (
    !goal ||
    typeof goal !== "object" ||
    goal.name !== GoalName.ManageFarm ||
    goal.opts.isGoing
  ) {
    return context;
  }

  const { currentTask, farmIndex } = goal.opts;

  const farm = nextState.world.farms[farmIndex];

  if (!farm) {
    return clearAllGoals(context);
  }

  if (!currentTask) {
    goal.opts.currentTask = ["wheat", 0];

    return context;
  }

  const [crop, cropIndex] = currentTask;
  const { bot } = nextState;

  const patrolArea = async (
    context: Context,
    cropObj: FlatRect,
  ): Promise<Context> => {
    const xRange = [...cropObj.x].sort((a, b) => a - b);

    xRange[0] -= 1;
    xRange[1] += 1;

    const lastXChecked = goal.opts.lastXChecked ?? xRange[0] - 1;

    const nextXChecked =
      lastXChecked + 1 > xRange[1] ? xRange[0] : lastXChecked + 1;

    goal.opts.lastXChecked = nextXChecked;
    goal.opts.isGoing = true;

    const firstTarget = new Vec3(nextXChecked, cropObj.y + 1, cropObj.z[0] - 2);

    const secondTarget = new Vec3(
      nextXChecked,
      cropObj.y + 1,
      cropObj.z[1] + 2,
    );

    const [, eventsQueue] = context;

    const asyncAction = () =>
      goToWalking(nextState, firstTarget, 1)
        .then(() => new Promise((resolve) => setTimeout(resolve, 2000)))
        .catch((e) => {
          console.error("Error patrolling X 1", e, firstTarget);
          bot.chat("Error patrolling X 1");
        })
        .then(() => goToWalking(nextState, secondTarget, 1))
        .then(() => new Promise((resolve) => setTimeout(resolve, 2000)))
        .catch((e) => {
          console.error("Error patrolling X 2", e, secondTarget);
          bot.chat("Error patrolling X 2");
        })
        .then(() => eventsQueue.push(getFinishEvent(nextState)));

    await asyncAction();

    return context;
  };

  if (crop === "wheat") {
    const cropObj = farm.wheat[cropIndex];
    const isInFarm = getIsInFarm(nextState, cropObj);

    if (!isInFarm) {
      return goToFarm(context, cropObj);
    }

    const isCorrect = confirmAllBlocksOfType(
      nextState,
      cropObj,
      new Set(["dirt", "farmland", "water"]),
    );

    if (!isCorrect) {
      bot.chat("The crop is not correct");

      return clearAllGoals(context);
    }

    const range = [cropObj.x, [cropObj.y, cropObj.y + 1], cropObj.z] as Range3D;

    const farmableBlocks = getAllBlocksInRange(nextState, range).filter((b) =>
      ["dirt", "farmland", "wheat"].includes(b.name),
    );

    const blockToHarvest = farmableBlocks.find(
      (block) =>
        block.type === bot.registry.blocksByName.wheat.id &&
        block.metadata === 7,
    );

    if (blockToHarvest) {
      goal.opts.isGoing = true;

      const [, eventsQueue] = context;

      const asyncAction = () =>
        goToWalking(nextState, blockToHarvest.position, 3)
          .then(() => bot.dig(blockToHarvest))
          .then(() => {
            chatDebug(nextState, "Harvested wheat");
          })
          .catch((e) => {
            console.error("Error harvesting wheat", e);
            bot.chat("Error harvesting wheat");
          })
          .then(() => eventsQueue.push(getFinishEvent(nextState)));

      await asyncAction();

      return context;
    }

    const dirtBlocks = farmableBlocks.filter(
      (b) => b.type === bot.registry.blocksByName.dirt.id,
    );

    if (dirtBlocks.length) {
      chatDebug(
        nextState,
        `Found dirt blocks to plant wheat: ${dirtBlocks.length}`,
      );

      const { item: stoneHoe, switchReturn: switchReturnHoe } = ensureItem(
        context,
        {
          chests: [farm.chest],
          finishEvent: getFinishEvent(nextState),
          item: { name: "stone_hoe" },
          stackInfo: [1, 1],
        },
      );

      if (!stoneHoe) {
        goal.opts.isGoing = true;

        return switchReturnHoe;
      }

      const block = dirtBlocks[0];

      goal.opts.isGoing = true;

      const [, eventsQueue] = context;

      const asyncAction = () =>
        bot.pathfinder
          .goto(
            new goals.GoalNear(
              block.position.x,
              block.position.y,
              block.position.z,
              2,
            ),
          )
          .then(() => bot.equip(stoneHoe, "hand"))
          .then(() => bot.activateBlock(block))
          .catch((e) => {
            console.error("Error hoeing dirt", e);
            bot.chat("Error hoeing dirt");
          })
          .then(() => eventsQueue.push(getFinishEvent(nextState)));

      await asyncAction();

      return context;
    }

    const blockToSow = farmableBlocks.find((block) => {
      if (block?.type !== bot.registry.blocksByName.farmland.id) return false;

      const blockAbove = bot.blockAt(block.position.offset(0, 1, 0));

      return !blockAbove || blockAbove.type === 0;
    });

    if (blockToSow) {
      const { item: wheatSeeds, switchReturn: switchReturnSeeds } = ensureItem(
        context,
        {
          chests: [farm.chest],
          finishEvent: getFinishEvent(nextState),
          item: { name: "wheat_seeds" },
          stackInfo: [1, 20],
        },
      );

      if (!wheatSeeds) {
        goal.opts.isGoing = true;

        return switchReturnSeeds;
      }

      goal.opts.isGoing = true;

      const [, eventsQueue] = context;

      const asyncAction = () =>
        goToWalking(nextState, blockToSow.position, 3)
          .then(() =>
            bot.equip(bot.registry.itemsByName.wheat_seeds.id, "hand"),
          )
          .then(() => bot.placeBlock(blockToSow, new Vec3(0, 1, 0)))
          .then(() => {
            chatDebug(nextState, "Sowed wheat seeds");
          })
          .catch((e) => {
            console.error("debug: farming.ts: e", e);
            bot.chat("Error sowing wheat seeds");
          })
          .then(() => eventsQueue.push(getFinishEvent(nextState)));

      await asyncAction();

      return context;
    }

    const hasEnoughWheat =
      bot.inventory
        .items()
        .filter((item) => item?.name === "wheat")
        .reduce((acc, item) => acc + item.count, 0) > 12;

    if (hasEnoughWheat) {
      goal.opts.isGoing = true;

      const [, eventsQueue] = context;

      const asyncAction = () =>
        openChest(nextState, farm.chest)
          .then(async (chest) => {
            await depositItemsInChest(nextState, chest);
          })
          .catch((e) => {
            console.error("Error going to chest", e);
            bot.chat("Error going to chest, the block is");
          })
          .then(() => eventsQueue.push(getFinishEvent(nextState)));

      await asyncAction();

      return context;
    }

    return patrolArea(context, cropObj);
  } else if (crop === "trees") {
    const { bot } = nextState;
    const { targetDigBlock } = bot;
    const treeObj = farm.trees[cropIndex];

    const cropObj = treeObj.trees.reduce(
      (acc, tree) => {
        acc.x[0] = Math.min(acc.x[0], tree[0]);
        acc.x[1] = Math.max(acc.x[1], tree[0]);
        acc.z[0] = Math.min(acc.z[0], tree[1]);
        acc.z[1] = Math.max(acc.z[1], tree[1]);

        return acc;
      },
      {
        x: [Infinity, -Infinity],
        y: treeObj.y,
        z: [Infinity, -Infinity],
      } as FlatRect,
    );

    const isInFarm = getIsInFarm(nextState, cropObj);

    if (!isInFarm) {
      return goToFarm(context, cropObj);
    }

    const range = [cropObj.x, [cropObj.y, cropObj.y + 5], cropObj.z] as Range3D;

    if (targetDigBlock) {
      const equipAction = equipBestToolForBlock(context, {
        chests: [farm.chest],
        finishEvent: getFinishEvent(nextState),
        targetDigBlock,
      });

      if (equipAction) {
        goal.opts.isGoing = true;

        return equipAction;
      }

      return context;
    }

    for (const tree of treeObj.trees) {
      const treeVec = new Vec3(tree[0], treeObj.y, tree[1]);
      const block = bot.blockAt(treeVec);

      if (!block) continue;

      const isDirt = block.name === "dirt";

      if (!isDirt) {
        bot.chat(
          `The tree base is not dirt in ${treeVec.toString()}, it is ${block.name}`,
        );

        continue;
      }

      const blockAboveDirt = bot.blockAt(treeVec.offset(0, 1, 0));

      if (!blockAboveDirt) continue;

      if (blockAboveDirt.name === "air") {
        const { item: saplingItem, switchReturn: goForSapling } = ensureItem(
          context,
          {
            chests: [farm.chest],
            finishEvent: getFinishEvent(nextState),
            item: { suffix: "sapling" },
            stackInfo: [1, 4],
          },
        );

        goal.opts.isGoing = true;

        if (goForSapling) {
          return goForSapling;
        }

        const asyncAction = async () => {
          if (saplingItem)
            return goToWalking(nextState, treeVec, 3)
              .then(() => bot.equip(saplingItem, "hand"))
              .then(() => bot.placeBlock(block, new Vec3(0, 1, 0)))
              .catch((e) => {
                console.error("Error planting sapling", e);
                bot.chat(`Error planting sapling in ${treeVec.toString()}`);
              })
              .then(() => getFinishEvent(nextState));
        };

        await asyncAction();

        return context;
      }
    }

    range[0] = [range[0][0] - 2, range[0][1] + 2];
    range[2] = [range[2][0] - 2, range[2][1] + 2];

    const possibleBlocksToDig = getAllBlocksInRange(nextState, range)
      .filter((block) => {
        if (!["_log", "_leaves"].some((n) => block.name.endsWith(n)))
          return false;

        if (block.name.includes("leaves"))
          return Math.abs(block.position.y - cropObj.y) <= 4;

        return !skipToDig.some((s) => block.name.includes(s));
      })
      .map((block) => block.position);

    if (possibleBlocksToDig.length) {
      const target = possibleBlocksToDig[0];
      const block = bot.blockAt(target);

      if (!block) return context;

      goal.opts.isGoing = true;

      const equipAction = equipBestToolForBlock(context, {
        chests: [farm.chest],
        finishEvent: getFinishEvent(nextState),
        targetDigBlock: block,
      });

      if (equipAction) {
        return equipAction;
      }

      const [, eventsQueue] = context;

      const asyncAction = () =>
        bot.pathfinder
          .goto(new goals.GoalNear(target.x, target.y, target.z, 3))
          .then(() => bot.dig(block).catch(() => {}))
          .catch(() => {
            bot.chat("I cannot cut the tree");
          })
          .then(() => eventsQueue.push(getFinishEvent(nextState)));

      await asyncAction();

      return context;
    }

    return patrolArea(context, cropObj);
  }

  return context;
};

export { handleFarming };
