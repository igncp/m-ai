import { goals, Movements } from "mineflayer-pathfinder";
import { type Vec3 } from "vec3";

import {
  type BotState,
  type Context,
  type Direction,
  type LogLevel,
  type UpdateEvent,
  aliases,
  ChatCommand,
  GoalName,
  logLevels,
  MAX_DIG_STRAIGHT,
  MAX_HEIGHT_RANGE,
  MAX_HEIGHT_STRAIGHT,
} from "../base";
import {
  chatDebug,
  formatTime,
  getCanDigBlock,
  getDiggableBlocks,
  getMainPlayerLookingBlock,
  throwAll,
} from "../utils";
import { getMainUsername, saveDiggingChest } from "../worlds";

type Command = (
  ctx: Context,
  et: Extract<UpdateEvent, { type: "chat" }>,
) => Promise<Context> | void;

const entityTargets = [
  "coal",
  "diamond",
  "iron",
  "lapis",
  "redstone",
  "tree",
] as const;

type EntityTarget = (typeof entityTargets)[number];

const isEntityTarget = (target: string | undefined): target is EntityTarget =>
  entityTargets.some((entityTarget) => entityTarget === target);

const closestEntityUsage = `Usage: closest-entity <${entityTargets.join("|")}>`;

const getCommandInfo = (command: ChatCommand) => {
  switch (command) {
    case ChatCommand.ClosestEntity:
      return closestEntityUsage;
    case ChatCommand.Commands:
      return "List available commands and options";
    case ChatCommand.DigRange:
      return "Usage: dig-range [-a|+a] <fromX> <toX> <fromY> <toY> <fromZ> <toZ>";
    case ChatCommand.DigRangeHere:
      return "Usage: dig-range-here [-a|+a] <fromX> <toX> <fromY> <toY> <fromZ> <toZ>";
    case ChatCommand.SaveChest:
      return "Usage: save-chest <x> <y> <z>";
    case ChatCommand.SetLogLevel:
      return `Usage: set-log-level <${logLevels.join("|")}>`;
    default:
      return "No extra options";
  }
};

const follow: Command = (context, eventType) => {
  const nextState = context[0];
  const { bot } = nextState;

  nextState.followTarget = bot.players[eventType.username].entity || null;
  nextState.currentGoal = GoalName.Follow;
  bot.stopDigging();
  bot.chat("Ok!");
};

const inventory: Command = (context) => {
  const [nextState] = context;
  const { bot } = nextState;

  const items = bot.inventory.slots
    .filter((i) => !!i)
    .map((i, idx) => `[${idx + 1}. ${i.displayName}: ${i.count}]`)
    .join(" ");

  const emptySlots = bot.inventory.emptySlotCount();

  bot.chat(items);
  bot.chat(`Empty slots: ${emptySlots}`);
};

const commands: Command = (context, eventType) => {
  const [nextState] = context;
  const { bot } = nextState;
  const [subcommand] = eventType.opts.trim().split(" ");

  if (subcommand !== "ls") {
    bot.chat("Usage: commands ls");

    return;
  }

  const aliasesByCommand = Object.entries(aliases).reduce(
    (acc, [alias, command]) => {
      if (!command) return acc;

      acc[command] = [...(acc[command] || []), alias];

      return acc;
    },
    {} as Partial<Record<ChatCommand, string[]>>,
  );

  const commandsWithAliases = Object.values(ChatCommand).map((command) => {
    const commandAliases = aliasesByCommand[command] || [];
    const commandInfo = getCommandInfo(command);

    return `- ${command} (${commandAliases.join(", ")}) - ${commandInfo}`;
  });

  bot.chat("Available commands:");
  bot.chat("Target one or more minions with :<n[,n|n-m...]>_<command> [opts]");
  bot.chat("Target all minions with :a_<command> [opts]");
  bot.chat("Example: :1,3-5_dig-r -a 0 5 0 3 0 5");

  for (const commandWithAliases of commandsWithAliases) {
    bot.chat(commandWithAliases);
  }
};

const closestEntity: Command = async (context, eventType) => {
  const [nextState] = context;
  const { bot } = nextState;
  const [target] = eventType.opts.trim().split(" ").filter(Boolean);

  if (!isEntityTarget(target)) {
    bot.chat(closestEntityUsage);

    return context;
  }

  const mainUsername = getMainUsername(nextState.world);

  const mainPlayer = bot.players[mainUsername];

  if (!mainPlayer?.entity) {
    bot.chat(`I don't see ${mainUsername}`);

    return context;
  }

  const blockMatchers: Record<EntityTarget, (name: string) => boolean> = {
    coal: (name: string) => ["coal_ore", "deepslate_coal_ore"].includes(name),
    diamond: (name: string) =>
      ["deepslate_diamond_ore", "diamond_ore"].includes(name),
    iron: (name: string) => ["deepslate_iron_ore", "iron_ore"].includes(name),
    lapis: (name: string) =>
      ["deepslate_lapis_ore", "lapis_ore"].includes(name),
    redstone: (name: string) =>
      ["deepslate_redstone_ore", "redstone_ore"].includes(name),
    tree: (name: string) =>
      ["_leaves", "_log", "_wood"].some((suffix) => name.endsWith(suffix)),
  };

  const positions = bot.findBlocks({
    count: 2000,
    matching: (block) => block && blockMatchers[target](block.name),
    maxDistance: 96,
    point: mainPlayer.entity.position,
  });

  const [closestBlock] = positions
    .map((position) => bot.blockAt(position))
    .filter(
      (block): block is NonNullable<ReturnType<typeof bot.blockAt>> => !!block,
    )
    .sort(
      (a, b) =>
        a.position.distanceTo(mainPlayer.entity.position) -
        b.position.distanceTo(mainPlayer.entity.position),
    );

  if (!closestBlock) {
    bot.chat(`No ${target} found near ${mainUsername}`);

    return context;
  }

  const { x, y, z } = closestBlock.position.floored();

  bot.chat(`Closest ${target}: ${x}, ${y}, ${z}`);

  return context;
};

const getDigMillis = (
  nextState: BotState,
): [null, number, Vec3[]] | [string, null, null] => {
  const { bot } = nextState;

  const stonePickaxe = bot.inventory
    .items()
    .find((i) => i.name.includes("stone_pickaxe"));

  if (!stonePickaxe) {
    return ["I don't have a stone pickaxe", null, null];
  }

  const diggableBlocks = getDiggableBlocks(nextState, nextState.focusRange);

  const millis = diggableBlocks.reduce((p, coords) => {
    const block = bot.blockAt(coords);

    if (!block || !getCanDigBlock(block)) return p;

    const blockTime = block.digTime(stonePickaxe.type, false, false, false);

    return p + blockTime;
  }, 0);

  return [null, millis, diggableBlocks];
};

const estimateTime: Command = async (context) => {
  const [nextState] = context;
  const { bot, currentGoal, initialBlock } = nextState;

  if (!currentGoal || !initialBlock) {
    bot.chat("I'm not doing anything right now");

    return context;
  }

  const [digMillisError, digMillis, diggableBlocks] = getDigMillis(nextState);

  if (digMillisError || !diggableBlocks) {
    bot.chat(digMillisError);

    return context;
  }

  const corners = diggableBlocks.reduce(
    ([c1, c2, c3, c4], coord) => [
      [Math.min(c1[0], coord.x), Math.min(c1[1], coord.z)],
      [Math.max(c2[0], coord.x), Math.max(c2[1], coord.z)],
      [Math.min(c3[0], coord.x), Math.max(c3[1], coord.z)],
      [Math.max(c4[0], coord.x), Math.min(c4[1], coord.z)],
    ],
    [
      [Infinity, Infinity],
      [-Infinity, -Infinity],
      [Infinity, -Infinity],
      [-Infinity, Infinity],
    ],
  );

  bot.chat(
    `The corners of the range are: ${corners
      .map((c) => c.join(", "))
      .join(" | ")} and the range is ${diggableBlocks.length} blocks.`,
  );

  const formatted = formatTime(digMillis);

  bot.chat(`It will take me ${formatted} to mine this range.`);

  return context;
};

const digInfo: Command = (context) => {
  const [nextState] = context;
  const { bot, currentGoal, focusRange, initialBlock } = nextState;

  if (![GoalName.DigRange].includes(currentGoal as GoalName)) {
    bot.chat("I'm not doing anything right now");

    return;
  }

  bot.chat(`I'm digging ${currentGoal}`);
  bot.chat(`Initial block: ${initialBlock?.join(", ")}`);
  bot.chat(`Mine range: ${focusRange}`);
};

const digStraight: Command = async (context, eventType) => {
  const [nextState] = context;
  const { bot } = nextState;

  const { opts } = eventType;

  const [digDirection, startPos, height] = opts.trim().split(" ");

  if (!startPos) {
    bot.chat("Invalid coordinates");

    return context;
  }

  bot.chat(`Digging straight ${digDirection} ${startPos}`);

  if (
    !(["-x", "-z", "+x", "+z"] satisfies Direction[]).includes(
      digDirection as Direction,
    )
  ) {
    bot.chat(`Invalid digDirection: ${digDirection}`);

    return context;
  }

  nextState.followTarget = null;

  const num = parseInt(startPos, 10);

  if (isNaN(num)) {
    bot.chat(`Invalid coordinates: ${startPos}`);

    return context;
  }

  const initialBlock = [
    digDirection.includes("x")
      ? Math.floor(num)
      : Math.floor(bot.entity.position.x),
    Math.floor(bot.entity.position.y),
    digDirection.includes("z")
      ? Math.floor(num)
      : Math.floor(bot.entity.position.z),
  ] as [number, number, number];

  nextState.initialBlock = initialBlock;

  const heightNum = parseInt(height, 10);

  const [xRange, yRange, zRange] = initialBlock.map((n) => [n, n]);

  if (digDirection.includes("x")) {
    xRange[0] += MAX_DIG_STRAIGHT * (digDirection.includes("-") ? -1 : 1);
  } else {
    zRange[0] += MAX_DIG_STRAIGHT * (digDirection.includes("-") ? -1 : 1);
  }

  yRange[1] += heightNum || MAX_HEIGHT_STRAIGHT;

  nextState.focusRange = [
    xRange as [number, number],
    yRange as [number, number],
    zRange as [number, number],
  ];

  nextState.allowDigWithHand = false;
  nextState.currentGoal = GoalName.DigRange;

  return context;
};

const parseDigRangeFlags = (opts: string) => {
  const tokens = opts.trim().split(" ").filter(Boolean);

  const allowDigWithHand = tokens.reduce((acc, token) => {
    if (token === "-a") {
      return true;
    }

    if (token === "+a") {
      return false;
    }

    return acc;
  }, false);

  const coordinateTokens = tokens.filter(
    (token) => !["-a", "+a"].includes(token),
  );

  return { allowDigWithHand, coordinateTokens };
};

const digRange: Command = async (context, eventType) => {
  const [nextState] = context;
  const { bot } = nextState;

  const { opts } = eventType;
  const mainUsername = getMainUsername(nextState.world);
  const mainEntity = bot.players[mainUsername];

  if (!mainEntity?.entity) {
    chatDebug(
      nextState,
      `I don't see ${mainUsername}, just ${Object.keys(bot.players)
        .filter((p) => bot.players[p]?.entity)
        .sort()
        .join(", ")}`,
    );

    return context;
  }

  const { allowDigWithHand, coordinateTokens } = parseDigRangeFlags(opts);
  const parsedCoordinates = coordinateTokens.map((n) => parseInt(n, 10));

  if (parsedCoordinates.some((n) => isNaN(n))) {
    bot.chat(`Invalid coordinates!! ${opts}`);

    return context;
  }

  const [fromX, toX, fromYBase, toYBase, fromZ, toZ] = parsedCoordinates;

  nextState.followTarget = null;
  nextState.allowDigWithHand = allowDigWithHand;

  const initialBlock = [
    Math.floor(bot.entity.position.x),
    Math.floor(mainEntity.entity.position.y),
    Math.floor(bot.entity.position.z),
  ] as [number, number, number];

  nextState.initialBlock = initialBlock;

  const yRange = [fromYBase || 0, toYBase || MAX_HEIGHT_RANGE]
    .sort((a, b) => a - b)
    .map(Math.floor)
    .map((n) => n + Math.floor(mainEntity.entity.position.y)) as [
    number,
    number,
  ];

  nextState.focusRange = [
    [Math.min(fromX, toX), Math.max(fromX, toX)],
    yRange,
    [Math.min(fromZ, toZ), Math.max(fromZ, toZ)],
  ];

  nextState.currentGoal = GoalName.DigRange;

  return context;
};

const digRangeHere: Command = async (context, eventType) => {
  const [nextState] = context;
  const { bot } = nextState;

  const mainUsername = getMainUsername(nextState.world);
  const player = bot.players[mainUsername];

  if (!player?.entity) {
    chatDebug(
      nextState,
      `I don't see ${eventType.username}, just ${Object.keys(bot.players)
        .filter((p) => bot.players[p]?.entity)
        .sort()
        .join(", ")}`,
    );

    return context;
  }

  const goal = new goals.GoalNear(
    player.entity.position.x,
    player.entity.position.y,
    player.entity.position.z,
    2,
  );

  const [, eventsQueue] = context;

  const asyncAction = () =>
    bot.pathfinder
      .goto(goal)
      .then(() =>
        eventsQueue.push({
          content: ChatCommand.DigRange,
          isTargeted: eventType.isTargeted,
          opts: eventType.opts,
          type: "chat",
          username: eventType.username,
        }),
      )
      .catch(() => ({ type: "clear" }) as const);

  await asyncAction();

  return context;
};

const digStraightHere: Command = async (context, eventType) => {
  const [nextState] = context;
  const { bot } = nextState;

  const mainUsername = getMainUsername(nextState.world);
  const player = bot.players[mainUsername];

  if (!player?.entity) {
    bot.chat(`I don't see ${mainUsername}`);

    return context;
  }

  const goal = new goals.GoalNear(
    Math.floor(player.entity.position.x),
    Math.floor(player.entity.position.y),
    Math.floor(player.entity.position.z),
    2,
  );

  const [, eventsQueue] = context;

  const asyncAction = () =>
    bot.pathfinder
      .goto(goal)
      .then(() => {
        bot.chat("I'm here, going to dig straight!");

        const newOpts = (() => {
          const [first, ...rest] = eventType.opts.trim().split(" ");

          if (first.length === 0 || rest.length > 1) return eventType.opts;

          if (first.includes("x"))
            return [first, Math.floor(bot.entity.position.x), ...rest].join(
              " ",
            );

          if (first.includes("z"))
            return [first, Math.floor(bot.entity.position.z), ...rest].join(
              " ",
            );

          return eventType.opts;
        })();

        eventsQueue.push({
          content: ChatCommand.DigStraight,
          isTargeted: eventType.isTargeted,
          opts: newOpts,
          type: "chat",
          username: eventType.username,
        });
      })
      .catch(() => eventsQueue.push({ type: "clear" }));

  await asyncAction();

  return context;
};

const stop: Command = (context) => {
  const [nextState] = context;
  const { bot } = nextState;

  if (bot.targetDigBlock) {
    bot.stopDigging();
  }

  nextState.focusRange = null;
  nextState.initialBlock = null;
  nextState.currentGoal = null;
  nextState.followTarget = null;

  nextState.bot.clearControlStates();
};

const myPosition: Command = (context, event) => {
  const [nextState] = context;
  const { bot } = nextState;

  const otherPlayer = Object.values(bot.players).find(
    (p) => p.username === event.username,
  );

  if (otherPlayer?.entity) {
    bot.chat(
      `Your position is: ${otherPlayer.entity.position
        .toArray()
        .map(Math.round)
        .join(", ")}`,
    );

    const [numStr] = event.opts.trim().split(" ");
    const num = parseInt(numStr, 10);

    if (!Number.isNaN(num)) {
      for (let i = 0; i < num; i++) {
        bot.chat(
          `The block at your position and height +${i} is: ${
            bot.blockAt(otherPlayer.entity.position.offset(0, i, 0))?.name ||
            "empty"
          }`,
        );
      }
    }
  }
};

const yourPosition: Command = (context) => {
  const [nextState] = context;
  const { bot } = nextState;

  bot.chat(`My position is: ${bot.entity.position.toString()}`);
};

const dropAll: Command = async (context, updateEvent) => {
  const [nextState] = context;
  const { opts } = updateEvent;
  const items = opts.trim().split(" ").filter(Boolean);

  const asyncAction = () => throwAll(nextState, items);

  await asyncAction();

  return context;
};

const eat: Command = async (context) => {
  const [nextState] = context;

  nextState.currentGoal = GoalName.Eat;
  nextState.followTarget = null;

  return context;
};

const manageFarm: Command = async (context, updateEvent) => {
  const [nextState] = context;
  const farmIndex = parseInt(updateEvent.opts.trim(), 10);

  nextState.currentGoal = {
    name: GoalName.ManageFarm,
    opts: { currentTask: null, farmIndex, isGoing: false, lastXChecked: null },
  };

  return context;
};

const comeHere: Command = async (context, eventType) => {
  const [nextState] = context;

  nextState.followTarget = null;

  const { bot } = nextState;
  const target = bot.players[eventType.username].entity.position.clone();

  nextState.currentGoal = {
    name: GoalName.ComeHere,
    opts: { target },
  };

  const goal = new goals.GoalNear(target.x, target.y, target.z, 2);
  const movement = new Movements(bot);

  movement.allowParkour = true;
  movement.allow1by1towers = true;
  bot.pathfinder.setMovements(movement);
  bot.chat(`Going to ${eventType.username}`);

  const intervalId = setInterval(() => {
    bot.chat(`I'm going to ${eventType.username}`);

    bot.chat(
      `I'm at ${bot.entity.position.toArray().map(Math.floor).join(", ")}`,
    );
  }, 10_000);

  const action = () =>
    bot.pathfinder
      .goto(goal)
      .catch((err) => {
        bot.chat("I can't go there");
        console.error("comeHere err", err);
      })
      .finally(() => {
        const defaultMovements = new Movements(bot);

        bot.pathfinder.setMovements(defaultMovements);
        clearInterval(intervalId);
      });

  await action();

  return context;
};

const reportPosition: Command = async (context, eventType) => {
  const [nextState] = context;

  nextState.followTarget = null;

  const { bot } = nextState;

  nextState.currentGoal = GoalName.ReportPosition;

  const playerEntity = bot.players[eventType.username].entity;

  const action = () =>
    new Promise<void>((resolve) => {
      const intervalId = setInterval(() => {
        if (nextState.currentGoal !== GoalName.ReportPosition) {
          clearInterval(intervalId);
          resolve();

          return;
        }

        const distance = playerEntity?.position
          ? Math.floor(bot.entity.position.distanceTo(playerEntity.position))
          : "";

        bot.chat(
          [
            `I'm at ${bot.entity.position.toArray().map(Math.floor).join(", ")}`,
            distance ? `distance: ${distance}` : "",
          ]
            .filter(Boolean)
            .join(", "),
        );
      }, 3_000);
    });

  await action();

  return context;
};

const setRespawn: Command = async (context) => {
  const [nextState] = context;
  const { bot } = nextState;

  const closestBed = bot.findBlock({
    matching: (block) => block.name.includes("_bed"),
  });

  if (!closestBed) {
    bot.chat("I don't see a bed");

    return context;
  }

  bot.chat("Setting respawn point");

  const goal = new goals.GoalNear(
    closestBed.position.x,
    closestBed.position.y,
    closestBed.position.z,
    2,
  );

  const [, eventsQueue] = context;

  const asyncAction = () =>
    bot.pathfinder
      .goto(goal)
      .then(() => bot.sleep(closestBed))
      .then(
        () =>
          new Promise<void>((resolve) => {
            setTimeout(() => {
              resolve();
            }, 2000);
          }),
      )
      .then(() => {
        bot.wake();
        bot.chat("I'm awake!");
      })
      .catch((err) => {
        console.error("Sleep err", err);

        eventsQueue.push({ type: "clear" });
      });

  nextState.currentGoal = null;

  await asyncAction();

  return context;
};

const attack: Command = (context) => {
  const [nextState] = context;
  const { bot } = nextState;

  const entity = bot.nearestEntity(
    (e) =>
      e.type === "hostile" && e.position.distanceTo(bot.entity.position) < 16,
  );

  nextState.followTarget = null;
  nextState.currentGoal = null;

  if (!entity) {
    bot.chat("No nearby hostile entities");
  } else {
    bot.chat(`Attacking ${entity.name ?? entity.username}`);

    try {
      bot.attack(entity);
    } catch (e) {
      console.error("Attack error", e);
    }
  }
};

const setLogLevel: Command = async (context, eventType) => {
  const [nextState] = context;
  const { bot } = nextState;

  const [level] = eventType.opts.trim().split(" ");

  if (!level) {
    bot.chat(`Invalid log level: ${level}`);

    return context;
  }

  if (!logLevels.includes(level as LogLevel)) {
    bot.chat(`Invalid log level: ${level}`);

    return context;
  }

  nextState.logLevel = level as LogLevel;

  return context;
};

const setConstantGoal: Command = async (context, eventType) => {
  const [nextState] = context;
  const { bot } = nextState;
  const { opts: optsBase } = eventType;

  if (!optsBase) {
    bot.chat("Command incomplete: set-constant-goal <command> [opts]");

    return context;
  }

  const [content, ...opts] = optsBase.split(" ") as [ChatCommand, string];

  nextState.constantGoal = GoalName.Unknown;

  const [, eventsQueue] = context;

  eventsQueue.push({
    content,
    isTargeted: eventType.isTargeted,
    opts: opts.join(" "),
    type: "chat",
    username: eventType.username,
  });

  return context;
};

const saveChest: Command = async (context) => {
  const [nextState] = context;
  const { bot } = nextState;
  const lookingBlock = getMainPlayerLookingBlock(nextState);

  if (!lookingBlock) {
    bot.chat("I don't know which block are you looking at");

    return context;
  }

  // Check if the block is a chest
  if (!lookingBlock.name.includes("chest")) {
    bot.chat(
      `The block you're looking at is not a chest: ${lookingBlock.name}`,
    );

    return context;
  }

  const { x, y, z } = lookingBlock.position;

  bot.chat(`Acknowledged: saving chest ${x},${y},${z}`);

  const status = await saveDiggingChest(nextState.world, [x, y, z]);

  if (status === "exists") {
    bot.chat(`Chest ${x},${y},${z} already exists`);
  } else {
    bot.chat(`Confirmed: chest ${x},${y},${z} saved`);
  }

  return context;
};

const goTo: Command = async (context, eventType) => {
  const [nextState] = context;
  const { bot } = nextState;
  const { opts } = eventType;

  const [x, y, z] = opts.split(" ").map((n) => parseInt(n, 10));

  if (isNaN(x) || isNaN(y) || isNaN(z)) {
    bot.chat("Invalid coordinates");

    return context;
  }

  const goal = new goals.GoalNear(x, y, z, 2);

  const asyncAction = () =>
    bot.pathfinder
      .goto(goal)
      .then(() => {
        bot.chat(`I'm at ${x}, ${y}, ${z}`);
      })
      .catch((err) => {
        console.error("GoTo err", err);
      });

  await asyncAction();

  return context;
};

const toggleAddTorches: Command = async (context) => {
  const [nextState] = context;

  nextState.addTorches = !nextState.addTorches;

  return context;
};

const reEnter: Command = () => {
  process.exit(0);
};

const printState: Command = (context) => {
  const [nextState] = context;

  // eslint-disable-next-line no-console
  console.log(
    "Bot state",
    JSON.stringify(
      {
        constantGoal: nextState.constantGoal,
        currentGoal: nextState.currentGoal,
      },
      null,
      2,
    ),
  );
};

export {
  type Command,
  attack,
  closestEntity,
  comeHere,
  commands,
  digInfo,
  digRange,
  digRangeHere,
  digStraight,
  digStraightHere,
  dropAll,
  eat,
  estimateTime,
  follow,
  getDigMillis,
  goTo,
  inventory,
  manageFarm,
  myPosition,
  printState,
  reEnter,
  reportPosition,
  saveChest,
  setConstantGoal,
  setLogLevel,
  setRespawn,
  stop,
  toggleAddTorches,
  yourPosition,
};
