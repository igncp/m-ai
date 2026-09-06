import { program } from "commander";

import { runBot } from "./bot";
import { startDaemon, stopDaemon } from "./daemon";
import { daemonClient } from "./daemon-client";

// https://github.com/PrismarineJS/mineflayer/blob/master/docs/api.md

const parseBotIndexes = (input: string): null | number[] => {
  if (input.includes("..")) {
    const [fromRaw, toRaw] = input.split("..");
    const from = parseInt(fromRaw, 10);
    const to = parseInt(toRaw, 10);

    if (Number.isNaN(from) || Number.isNaN(to) || from > to) {
      return null;
    }

    return Array.from({ length: to - from + 1 }, (_, i) => from + i);
  }

  if (input.includes(",")) {
    const indexes = input
      .split(",")
      .map((item) => parseInt(item.trim(), 10))
      .filter((item) => !Number.isNaN(item));

    if (!indexes.length) {
      return null;
    }

    return indexes;
  }

  const index = parseInt(input, 10);

  if (Number.isNaN(index)) {
    return null;
  }

  return [index];
};

const main = () => {
  program.name("block").version("1.0.0");

  const daemon = program.command("daemon");

  daemon
    .command("start")
    .description("Start the daemon")
    .action(async () => {
      await startDaemon();
    });

  daemon
    .command("stop")
    .description("Stop the daemon")
    .action(async () => {
      await stopDaemon();
    });

  program
    .command("start")
    .description("Start a bot")
    .action(async (...args) => {
      const indexes = parseBotIndexes(args[0]);
      const constantGoal = args[1];

      if (!indexes) {
        throw new Error(`Invalid index argument: ${args[0]}`);
      }

      await Promise.all(
        indexes.map((index) => daemonClient.createBot(index, constantGoal)),
      );
    })
    .argument("<index>", "Bot index, list (1,10), or range (1..10)")
    .argument("[constantGoal]", "Constant goal for the bot");

  program
    .command("stop")
    .description("Stop a bot subprocess")
    .action(async (...args) => {
      const index = parseInt(args[0], 10);

      await daemonClient.stopBot(index);
    })
    .argument("<index>", "Index of the bot");

  program
    .command("restart")
    .description("Restart all bot subprocesses")
    .action(async () => {
      await daemonClient.restartBots();
    });

  program
    .command("run-bot")
    .description("Run a bot process")
    .action(async (...args) => {
      const index = parseInt(args[0], 10);
      const constantGoal = args[1];

      await runBot({
        botNum: index,
        constantGoalAlias: constantGoal,
      });
    })
    .argument("<index>", "Index of the bot")
    .argument("[constantGoal]", "Constant goal for the bot");

  program.parse();
};

main();
