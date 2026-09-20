import { type Express } from "express-serve-static-core";
import { type Chest } from "mineflayer";
import { type Item } from "prismarine-item";

import { type BotState, type Goal, GoalName, logLevels } from "./base";
import { getDigMillis } from "./reducer/commands";

type Metric = {
  labels?: Record<string, string>;
  name: string;
  value: number;
};

const getBotMetrics = (state: BotState): Metric[] => {
  const defaultLabels = { userName: state.bot.entity.username as string };

  const createSimpleMetric = (
    name: string,
    value: number,
    labels?: Record<string, string>,
  ): Metric => ({ labels: { ...defaultLabels, ...labels }, name, value });

  const { constantGoal, currentGoal: currentGoalBase } = state;
  const currentGoal = constantGoal || currentGoalBase;
  const isMining = [GoalName.DigRange].includes(currentGoal as GoalName);
  const isFollowing = [GoalName.Follow].includes(currentGoal as GoalName);
  const currentBlock = state.bot.blockAt(state.bot.entity.position);

  const flootBlock = state.bot.blockAt(
    state.bot.entity.position.offset(0, -1, 0),
  );

  const items = state.bot.inventory.items();

  const isChestGoal =
    typeof currentGoal === "object" &&
    currentGoal?.name === GoalName.MonitorChest &&
    !!currentGoal.opts.chest;

  const stonePickaxes = items.filter(
    (item) => item?.name === "stone_pickaxe",
  ).length;

  const countItems = (name: string) =>
    items
      .filter((item) => item?.name === name)
      .reduce((count, item) => count + item.count, 0);

  const { x, y, z } = state.bot.entity.position;

  const metrics: Metric[] = [
    createSimpleMetric("log_level", logLevels.indexOf(state.logLevel)),
    createSimpleMetric("is_mining", isMining ? 1 : 0),
    createSimpleMetric("is_following", isFollowing ? 1 : 0),
    createSimpleMetric("no_goal", currentGoal ? 0 : 1),
    createSimpleMetric("user_food", state.bot.food),
    createSimpleMetric("user_health", state.bot.health),
    createSimpleMetric(
      "user_empty_slots",
      state.bot.inventory.emptySlotCount(),
    ),
    createSimpleMetric("user_add_torches", state.addTorches ? 1 : 0),
    createSimpleMetric("stone_pickaxes", stonePickaxes),
    createSimpleMetric("item_stone_pickaxes", stonePickaxes),
    createSimpleMetric("item_torch", countItems("torch")),
    createSimpleMetric("item_wheat", countItems("wheat")),
    createSimpleMetric("user_x", x),
    createSimpleMetric("user_y", y),
    createSimpleMetric("user_z", z),
    createSimpleMetric(
      "user_light",
      currentBlock?.light || flootBlock?.light || -1,
    ),
    createSimpleMetric("service_health", 1),
    createSimpleMetric("dig_millis", getDigMillis(state)[1] ?? -1),
  ];

  if (isChestGoal) {
    const goal = currentGoal as Extract<Goal, { name: GoalName.MonitorChest }>;

    const commonLabels = {
      chestIndex: goal.opts.chestIndex.toString(),
      chestType: goal.opts.chestType,
    };

    const itemsInChest = (goal.opts.chest as Chest).slots.filter(
      (item): item is Item => !!item?.name && item?.slot < 55,
    );

    for (const itemName of [
      "stone_pickaxe",
      "cobbled_deepslate",
      "torch",
      "stone_shovel",
      "wheat",
    ]) {
      metrics.push(
        createSimpleMetric(
          `chest_${itemName}_bulks`,
          itemsInChest.filter((item) => item.name === itemName).length,
          commonLabels,
        ),
        createSimpleMetric(
          `chest_${itemName}_count`,
          itemsInChest
            .filter((item) => item.name === itemName)
            .reduce((count, item) => count + item.count, 0),
          commonLabels,
        ),
      );
    }
  }

  return metrics;
};

const createBotMetricsServer = (app: Express, getState: () => BotState) => {
  app.get("/metrics", (_req, res) => {
    res.json(getBotMetrics(getState()));
  });
};

const createMetricsServer = (
  app: Express,
  getMetrics: () => Promise<{ botName: string; metrics: Metric[] }[]>,
) => {
  app.get("/prometheus/metrics", async (_req, res) => {
    const metrics = await getMetrics();

    const output = metrics.flatMap(({ botName, metrics }) =>
      metrics.map(({ labels = {}, name, value }) => {
        const allLabels = { ...labels, botName };

        const labelsText = Object.entries(allLabels)
          .map(([key, labelValue]) => `${key}="${labelValue}"`)
          .join(",");

        return `minecraft_${name}{${labelsText}} ${value}`;
      }),
    );

    res.setHeader("Content-Type", "text/plain");
    res.send(output.join("\n"));
  });
};

export { type Metric, createBotMetricsServer, createMetricsServer };
