import express from "express";
import { type BotOptions } from "mineflayer";
import mineflayer from "mineflayer";
import { pathfinder } from "mineflayer-pathfinder";

import {
  type BotState,
  type UpdateEvent,
  aliases,
  ChatCommand,
  goalAliases,
  LogLevel,
} from "./base";
import { botServerRoutes, getBotServerPort } from "./bot-server";
import { daemonClient } from "./daemon-client";
import { asyncReducer } from "./reducer";
import { getDefaultMovements } from "./utils";

const initialState: Omit<BotState, "bot" | "world"> = {
  addTorches: false,
  allowDigWithHand: false,
  constantGoal: null,
  currentGoal: null,
  focusRange: null,
  followTarget: null,
  initialBlock: null,
  logLevel: LogLevel.Info,
};

const runBot = async (opts: {
  botNum: number;
  constantGoalAlias: string | undefined;
}) => {
  const { botNum, constantGoalAlias } = opts;
  const constantGoal = goalAliases[constantGoalAlias || ""] || null;
  const world = await daemonClient.getWorld();

  if (!world) throw new Error("world.json does not exist");

  const botOptions: BotOptions = {
    auth: "offline",
    host: process.env.MINECRAFT_HOST || "localhost",
    port: Number(process.env.MINECRAFT_PORT || 25565),
    respawn: true,
    username: "minion" + botNum,
    version: "1.21.1",
  } as const;

  const bot = mineflayer.createBot(botOptions);

  bot.loadPlugin(pathfinder);

  bot.on("kicked", (reason) => {
    console.error("Kicked for", reason);
  });

  const firstState: BotState = {
    ...initialState,
    bot,
    constantGoal,
    world,
  };

  const eventsQueue: UpdateEvent[] = [];
  const app = express();

  app.post(botServerRoutes.fetchWorld, (_req, res) => {
    eventsQueue.push({ type: "fetch-world" });
    res.sendStatus(204);
  });

  const botServer = app.listen(getBotServerPort());

  bot.on("chat", (username, message) => {
    const [fullContent, ...opts] = message?.split(" ") || [];

    const [toUsernames, content] = ((): [string[], string] => {
      if (fullContent.startsWith(":")) {
        return (fullContent as string)
          .replace(":", "")
          .split("_")
          .map((s: string) => s.trim())
          .map((s, idx, arr) => {
            if (idx === 0 && arr.length === 2) {
              return s
                .split(",")
                .map((token) => token.trim())
                .flatMap((token) => {
                  if (token === "a") {
                    const allMinions = Object.keys(bot.players).filter((name) =>
                      /^minion\d+$/.test(name),
                    );

                    const selfUsername = bot.entity.username;

                    return Array.from(
                      new Set(
                        selfUsername && /^minion\d+$/.test(selfUsername)
                          ? [...allMinions, selfUsername]
                          : allMinions,
                      ),
                    );
                  }

                  if (token.includes("-")) {
                    const [start, end] = token.split("-").map(Number);

                    return Array.from(
                      { length: end - start + 1 },
                      (_, i) => start + i,
                    )
                      .map((n) => `${n}`)
                      .filter((n) => !Number.isNaN(Number(n)))
                      .map((n) => `minion${n}`);
                  }

                  if (!token || Number.isNaN(Number(token))) {
                    return [];
                  }

                  return [`minion${token}`];
                });
            }

            return s;
          }) as [string[], string];
      }

      return [[], fullContent];
    })();

    if (
      !!stateRef.state.constantGoal &&
      content !== ChatCommand.SetConstantGoal &&
      aliases[content] !== ChatCommand.SetConstantGoal &&
      content !== ChatCommand.ClosestEntity &&
      aliases[content] !== ChatCommand.ClosestEntity &&
      content !== ChatCommand.SaveChest &&
      aliases[content] !== ChatCommand.SaveChest
    ) {
      return;
    }

    if (
      !!toUsernames?.length &&
      !toUsernames.includes(bot.entity.username as string)
    ) {
      return;
    }

    if (username === bot.entity.username) {
      return;
    }

    eventsQueue.push({
      content: (content as ChatCommand) || "",
      isTargeted: toUsernames.length > 0,
      opts: opts.join(" "),
      type: "chat",
      username,
    } as const);
  });

  bot.on("entityHurt", (entity) => {
    if (entity === bot.entity)
      eventsQueue.push({
        type: "hurtWarning",
      });
  });

  const intervalId = setInterval(() => {
    eventsQueue.push({
      type: "interval",
    });
  }, 1000);

  const eventsMonitorIntervalId = setInterval(() => {
    if (eventsQueue.length > 100)
      bot.chat(
        `WARNING: MANY EVENTS: ${botOptions.username} - ${eventsQueue.length}`,
      );
  }, 10_000);

  bot.on("error", (err) => {
    console.error("Error", err);

    eventsQueue.push({
      type: "error",
    });
  });

  bot.on("end", () => {
    eventsQueue.length = 0;
    bot.chat("Clearing queue");

    eventsQueue.push({
      type: "end",
    });
  });

  const stateRef: { state: BotState } = {
    state: firstState,
  };

  bot.on("spawn", () => {
    const defaultMovement = getDefaultMovements(firstState);

    bot.pathfinder.setMovements(defaultMovement);
  });

  bot.on("end", () => {
    process.exit(1);
  });

  while (true) {
    const nextEvent = eventsQueue.shift();

    if (!nextEvent) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      continue;
    }

    if (nextEvent.type === "end") {
      break;
    }

    const [newState] = await asyncReducer(
      [stateRef.state, eventsQueue],
      nextEvent,
    );

    stateRef.state = newState;
  }

  bot.removeAllListeners();
  botServer.close();
  clearInterval(eventsMonitorIntervalId);
  clearInterval(intervalId);
};

export { runBot };
