import bodyParser from "body-parser";
import { type ChildProcess, spawn } from "child_process";
import express from "express";
import { type PathParams } from "express-serve-static-core";
import path from "path";

import { type DaemonContext } from "./base";
import { BOT_PORT_ENV, botClient, getBotPort } from "./bot-server";
import { type RoutesParams, daemonClient, dameonRoutes } from "./daemon-client";
import { createLogger } from "./logger";
import { createMetricsServer } from "./metrics-server";
import { ensureWorldFile, getWorld, saveWorld } from "./worlds/file";

const startDaemon = async () => {
  const logger = createLogger();

  if (await ensureWorldFile())
    logger.info(
      "Created server/world.json; remember to fill in the mainPlayer property",
    );

  const app = express();
  const port = 50000;

  app.use(bodyParser.json() as unknown as PathParams);

  const context: DaemonContext = { bots: {}, logger };
  const botConfigs: Record<number, { constantGoal?: string }> = {};
  const botProcesses: Record<number, ChildProcess> = {};

  const notifyBotsToFetchWorld = async () => {
    await Promise.all(
      Object.keys(botProcesses).map((index) =>
        botClient(Number(index)).notifyFetchWorld(),
      ),
    );
  };

  const stopBotProcess = async (index: number) => {
    const botProcess = botProcesses[index];

    if (!botProcess) return false;

    if (botProcess.exitCode !== null || botProcess.signalCode !== null) {
      delete botProcesses[index];

      return true;
    }

    await new Promise<void>((resolve) => {
      botProcess.once("exit", () => {
        resolve();
      });

      botProcess.kill("SIGTERM");
    });

    return true;
  };

  const startBotProcess = async (index: number, constantGoal?: string) => {
    const botPort = getBotPort(index);
    const restarted = await stopBotProcess(index);

    const command = path.resolve(
      __dirname,
      "..",
      "node_modules",
      ".bin",
      "tsx",
    );

    const commandArgs = [
      "src/main.ts",
      "run-bot",
      `${index}`,
      ...(constantGoal ? [constantGoal] : []),
    ];

    const botProcess = spawn(command, commandArgs, {
      cwd: path.resolve(__dirname, ".."),
      env: { ...process.env, [BOT_PORT_ENV]: `${botPort}` },
      stdio: "inherit",
    });

    botProcesses[index] = botProcess;
    botConfigs[index] = constantGoal ? { constantGoal } : {};

    botProcess.on("exit", (code, signal) => {
      if (botProcesses[index]?.pid === botProcess.pid) {
        delete botProcesses[index];
      }

      logger.info(
        `Bot ${index} subprocess exited (code=${code}, signal=${signal})`,
      );
    });

    logger.info(
      `Bot ${index} subprocess started (pid=${botProcess.pid})${restarted ? " after restart" : ""}`,
    );
  };

  app.get(dameonRoutes.health, (_req, res) => {
    logger.info("debug: daemon.ts: context", context);
    res.send("OK");
  });

  app.get(dameonRoutes.world, async (_req, res) => {
    try {
      res.json(await getWorld());
    } catch (error) {
      res
        .status(500)
        .send(error instanceof Error ? error.message : String(error));
    }
  });

  app.put(dameonRoutes.world, async (req, res) => {
    try {
      await saveWorld(req.body);
      await notifyBotsToFetchWorld();

      res.sendStatus(204);
    } catch (error) {
      res
        .status(500)
        .send(error instanceof Error ? error.message : String(error));
    }
  });

  app.post(dameonRoutes.shutdown, async (_req, res) => {
    await Promise.all(
      Object.keys(botProcesses).map((index) => stopBotProcess(Number(index))),
    );

    res.send("Shutting down...");
    logger.info("Daemon shutting down...");
    process.exit(0);
  });

  app.post(dameonRoutes.createBot, async (req, res) => {
    const body = req.body as RoutesParams["createBot"];

    await startBotProcess(body.minionIndex, body.constantGoal);

    res.send("Starting bot subprocess...");
  });

  app.post(dameonRoutes.restartBots, async (_req, res) => {
    const indexes = Object.keys(botProcesses).map(Number);

    await Promise.all(
      indexes.map((index) =>
        startBotProcess(index, botConfigs[index]?.constantGoal),
      ),
    );

    res.send(`Restarted ${indexes.length} bot subprocess(es)`);
  });

  app.post(dameonRoutes.stopBot, async (req, res) => {
    const body = req.body as RoutesParams["stopBot"];
    const stopped = await stopBotProcess(body.minionIndex);

    if (stopped) {
      logger.info(`Bot ${body.minionIndex} subprocess stopped`);
      res.send("Stopped bot subprocess");

      return;
    }

    res.status(404).send("Bot subprocess not running");
  });

  createMetricsServer(app, context);

  app.listen(port, (err: unknown) => {
    if (err) {
      console.error(err);
      process.exit(1);
    }

    logger.info(`Daemon started on port: ${port}`);
  });
};

const stopDaemon = async () => {
  try {
    await daemonClient.stop();
    // eslint-disable-next-line no-console
    console.log("Daemon stopped");
  } catch {
    // eslint-disable-next-line no-console
    console.log("Daemon is not running");
  }
};

export { startDaemon, stopDaemon };
