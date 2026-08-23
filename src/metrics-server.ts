import { type Express } from "express-serve-static-core";
import { type Chest } from "mineflayer";
import { type Item } from "prismarine-item";

import { type DaemonContext, type Goal, GoalName, logLevels } from "./base";
import { getDigMillis } from "./reducer/commands";

const createMetricsServer = async (app: Express, context: DaemonContext) => {
  app.get("/prometheus/metrics", (_req, res) => {
    type Metric = {
      labels?: Record<string, string>;
      name: string;
      value: number;
    };

    const metrics: (Metric | null)[] = [];

    Object.entries(context.bots).forEach(([botNum, asyncActionCtx]) => {
      const defaultLabels = {
        userName: asyncActionCtx.stateCopy.bot.entity.username as string,
      };

      const createSimpleMetric = (
        name: string,
        value: number,
        labels?: Record<string, string>,
      ): Metric => ({
        labels: { ...defaultLabels, ...(labels || {}) },
        name,
        value,
      });

      const logLevelPos = logLevels.indexOf(asyncActionCtx.stateCopy.logLevel);

      const { constantGoal, currentGoal: currentGoalBase } =
        asyncActionCtx.stateCopy;

      const currentGoal = constantGoal || currentGoalBase;
      const isMining = [GoalName.DigRange].includes(currentGoal as GoalName);
      const isFollowing = [GoalName.Follow].includes(currentGoal as GoalName);
      const noGoal = !currentGoal;
      const food = asyncActionCtx.stateCopy.bot.food;
      const health = asyncActionCtx.stateCopy.bot.health;
      const items = asyncActionCtx.stateCopy.bot.inventory.items();
      const { x, y, z } = asyncActionCtx.stateCopy.bot.entity?.position || {};

      const currentBlock = asyncActionCtx.stateCopy.bot.blockAt(
        asyncActionCtx.stateCopy.bot.entity.position.offset(0, 0, 0),
      );

      const flootBlock = asyncActionCtx.stateCopy.bot.blockAt(
        asyncActionCtx.stateCopy.bot.entity.position.offset(0, -1, 0),
      );

      const light = currentBlock?.light || flootBlock?.light || -1;

      const isChestGoal =
        typeof currentGoal === "object" &&
        currentGoal?.name === GoalName.MonitorChest &&
        !!currentGoal.opts.chest;

      const stonePickaxes = items.filter(
        (item) => item?.name === "stone_pickaxe",
      ).length;

      const wheat = items
        .filter((item) => item?.name === "wheat")
        .reduce((acc, item) => acc + item.count, 0);

      const torches = items
        .filter((item) => item?.name === "torch")
        .reduce((acc, item) => acc + item.count, 0);

      const digMillis =
        (isMining && getDigMillis(asyncActionCtx.stateCopy)[1]) || -1;

      const createChestMetrics = () => {
        const goal = currentGoal as Extract<
          Goal,
          { name: GoalName.MonitorChest }
        >;

        const commonLabels = {
          chestIndex: goal.opts.chestIndex.toString(),
          chestType: goal.opts.chestType,
        };

        const itemsInChest = (goal.opts.chest as Chest).slots.filter(
          (item): item is Item => !!item?.name && item?.slot < 55,
        );

        const getBulks = (name: string) =>
          itemsInChest.filter((item) => item.name === name).length;

        const getCount = (name: string) =>
          itemsInChest
            .filter((item) => item.name === name)
            .reduce((acc, item) => acc + item.count, 0);

        return [
          "stone_pickaxe",
          "cobbled_deepslate",
          "torch",
          "stone_shovel",
          "wheat",
        ]
          .map((itemName) => [
            createSimpleMetric(
              `chest_${itemName}_bulks`,
              getBulks(itemName),
              commonLabels,
            ),
            createSimpleMetric(
              `chest_${itemName}_count`,
              getCount(itemName),
              commonLabels,
            ),
          ])
          .flat()
          .concat([
            createSimpleMetric("chest_minion", Number(botNum), commonLabels),
          ]);
      };

      const emptySlots =
        asyncActionCtx.stateCopy.bot.inventory.emptySlotCount();

      metrics.push(
        ...(isChestGoal ? createChestMetrics() : []),
        createSimpleMetric("log_level", logLevelPos),
        createSimpleMetric("is_mining", isMining ? 1 : 0),
        createSimpleMetric("is_following", isFollowing ? 1 : 0),
        createSimpleMetric("no_goal", noGoal ? 1 : 0),
        createSimpleMetric("user_food", food),
        createSimpleMetric("user_health", health),
        createSimpleMetric("user_empty_slots", emptySlots),
        createSimpleMetric(
          "user_add_torches",
          asyncActionCtx.stateCopy.addTorches ? 1 : 0,
        ),
        createSimpleMetric("stone_pickaxes", stonePickaxes),
        createSimpleMetric("item_stone_pickaxes", stonePickaxes),
        createSimpleMetric("item_torch", torches),
        createSimpleMetric("item_wheat", wheat),
        createSimpleMetric("user_x", x || -1),
        createSimpleMetric("user_y", y || -1),
        createSimpleMetric("user_z", z || -1),
        createSimpleMetric("user_light", light),
        createSimpleMetric("service_health", 1),
        createSimpleMetric("dig_millis", digMillis),
      );
    });

    const parseMetric = ({ labels, name, value }: Metric) => {
      let labelsText = "";

      if (Object.keys(labels || {}).length) {
        labelsText = `{${Object.entries(labels || {})
          .map(([key, value]) => `${key}="${value}"`)
          .join(", ")}}`;
      }

      return [`minecraft_${name}${labelsText}`, value].join(" ");
    };

    res.setHeader("Content-Type", "text/plain");

    res.send(
      metrics
        .flat()
        .filter((m): m is Metric => Boolean(m))
        .map(parseMetric)
        .join("\n"),
    );
  });
};

export { createMetricsServer };
