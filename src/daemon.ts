import bodyParser from "body-parser";
import { type ChildProcess, spawn } from "child_process";
import express from "express";
import { type PathParams } from "express-serve-static-core";
import { readFile } from "fs/promises";
import path from "path";

import { type DaemonContext } from "./base";
import { BOT_PORT_ENV, botClient, getBotPort } from "./bot-server";
import { type RoutesParams, daemonClient, dameonRoutes } from "./daemon-client";
import { createLogger } from "./logger";
import { type Metric, createMetricsServer } from "./metrics-server";
import { runMigrations } from "./worlds/database";
import { ensureWorld, getWorld, saveWorld } from "./worlds/file";

const startDaemon = async () => {
  const logger = createLogger();

  await runMigrations();

  const minecraftWorldId = process.env.MINECRAFT_WORLD_ID;

  if (!minecraftWorldId) {
    logger.warn(
      "MINECRAFT_WORLD_ID is not configured; create or import a Minecraft world",
    );
  } else if (await ensureWorld(minecraftWorldId)) {
    logger.info(
      process.env.MAIN_PLAYER
        ? "Created world"
        : "Created world; remember to fill in the mainPlayer property",
    );
  }

  const app = express();
  const port = 50000;

  app.use(bodyParser.json() as unknown as PathParams);

  const context: DaemonContext = { bots: {}, logger };
  const botConfigs: Record<number, { constantGoal?: string }> = {};
  const botProcesses: Record<number, ChildProcess> = {};
  const kubernetesBotRunner = process.env.M_AI_BOT_RUNNER === "kubernetes";
  const kubernetesApiUrl = `https://${process.env.KUBERNETES_SERVICE_HOST}:${process.env.KUBERNETES_SERVICE_PORT_HTTPS || "443"}`;
  const kubernetesNamespace = process.env.POD_NAMESPACE || "default";

  const kubernetesTokenPath =
    "/var/run/secrets/kubernetes.io/serviceaccount/token";

  const kubernetesRequest = async (
    path: string,
    init?: RequestInit,
  ): Promise<Response> => {
    const token = await readFile(kubernetesTokenPath, "utf8");

    const response = await fetch(`${kubernetesApiUrl}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token.trim()}`,
        "Content-Type": "application/json",
        ...init?.headers,
      },
    });

    if (!response.ok)
      throw new Error(
        `Kubernetes API request failed: ${response.status} ${await response.text()}`,
      );

    return response;
  };

  const getBotPods = async () => {
    const response = await kubernetesRequest(
      `/api/v1/namespaces/${kubernetesNamespace}/pods?labelSelector=app%3Dm-ai-bot`,
    );

    return (await response.json()) as {
      items: {
        metadata: {
          annotations?: { constantGoal?: string };
          labels: { "bot-index": string };
          name: string;
        };
      }[];
    };
  };

  let shuttingDown = false;

  const notifyBotsToFetchWorld = async () => {
    const indexes = kubernetesBotRunner
      ? (await getBotPods()).items.map(({ metadata }) =>
          Number(metadata.labels["bot-index"]),
        )
      : Object.keys(botProcesses).map(Number);

    await Promise.all(
      indexes.map((index) =>
        botClient(index, botServiceHost(index)).notifyFetchWorld(),
      ),
    );
  };

  const botServiceHost = (index: number) =>
    kubernetesBotRunner ? `m-ai-bot-${index}` : "localhost";

  const ensureBotService = async (index: number) => {
    const response = await fetch(
      `${kubernetesApiUrl}/api/v1/namespaces/${kubernetesNamespace}/services`,
      {
        body: JSON.stringify({
          apiVersion: "v1",
          kind: "Service",
          metadata: { name: `m-ai-bot-${index}` },
          spec: {
            ports: [{ port: getBotPort(index), targetPort: getBotPort(index) }],
            selector: { app: "m-ai-bot", "bot-index": `${index}` },
          },
        }),
        headers: {
          Authorization: `Bearer ${(await readFile(kubernetesTokenPath, "utf8")).trim()}`,
          "Content-Type": "application/json",
        },
        method: "POST",
      },
    );

    if (!response.ok && response.status !== 409)
      throw new Error(
        `Could not create bot Service: ${response.status} ${await response.text()}`,
      );
  };

  const stopBotPod = async (index: number) => {
    const { items } = await getBotPods();

    const matchingPods = items.filter(
      ({ metadata }) => Number(metadata.labels["bot-index"]) === index,
    );

    await Promise.all(
      matchingPods.map(({ metadata: { name } }) =>
        kubernetesRequest(
          `/api/v1/namespaces/${kubernetesNamespace}/pods/${name}`,
          { method: "DELETE" },
        ),
      ),
    );

    return matchingPods.length > 0;
  };

  const startBotPod = async (index: number, constantGoal?: string) => {
    const restarted = await stopBotPod(index);

    await ensureBotService(index);

    const image = process.env.M_AI_IMAGE;

    if (!image) throw new Error("M_AI_IMAGE must be set for Kubernetes bots");

    await kubernetesRequest(`/api/v1/namespaces/${kubernetesNamespace}/pods`, {
      body: JSON.stringify({
        apiVersion: "v1",
        kind: "Pod",
        metadata: {
          annotations: constantGoal ? { constantGoal } : undefined,
          generateName: `m-ai-bot-${index}-`,
          labels: { app: "m-ai-bot", "bot-index": `${index}` },
        },
        spec: {
          containers: [
            {
              args: [
                "run-bot",
                `${index}`,
                ...(constantGoal ? [constantGoal] : []),
              ],
              env: [
                { name: "BOT_PORT", value: `${getBotPort(index)}` },
                { name: "DAEMON_BASE_URL", value: "http://m-ai-daemon:50000" },
                { name: "MINECRAFT_HOST", value: "minecraft" },
                { name: "MINECRAFT_PORT", value: "80" },
              ],
              image,
              name: "bot",
              ports: [{ containerPort: getBotPort(index) }],
            },
          ],
          restartPolicy: "OnFailure",
        },
      }),
      method: "POST",
    });

    botConfigs[index] = constantGoal ? { constantGoal } : {};

    logger.info(
      `Bot ${index} Kubernetes Pod started${restarted ? " after restart" : ""}`,
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
    if (kubernetesBotRunner) return startBotPod(index, constantGoal);

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

  const shutdown = async () => {
    if (shuttingDown) return;

    shuttingDown = true;
    logger.info("Daemon shutting down...");

    await Promise.all(
      Object.keys(kubernetesBotRunner ? botConfigs : botProcesses).map(
        (index) =>
          kubernetesBotRunner
            ? stopBotPod(Number(index))
            : stopBotProcess(Number(index)),
      ),
    );

    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  };

  app.get(dameonRoutes.health, (_req, res) => {
    logger.info("debug: daemon.ts: context", context);
    res.send("OK");
  });

  app.get(dameonRoutes.world, async (_req, res) => {
    try {
      if (!minecraftWorldId)
        throw new Error("MINECRAFT_WORLD_ID is not configured");

      res.json(await getWorld(minecraftWorldId));
    } catch (error) {
      res
        .status(500)
        .send(error instanceof Error ? error.message : String(error));
    }
  });

  app.put(dameonRoutes.world, async (req, res) => {
    try {
      if (!minecraftWorldId)
        throw new Error("MINECRAFT_WORLD_ID is not configured");

      await saveWorld(minecraftWorldId, req.body);
      await notifyBotsToFetchWorld();

      res.sendStatus(204);
    } catch (error) {
      res
        .status(500)
        .send(error instanceof Error ? error.message : String(error));
    }
  });

  app.post(dameonRoutes.shutdown, async (_req, res) => {
    res.send("Shutting down...");
    await shutdown();
  });

  app.post(dameonRoutes.createBot, async (req, res) => {
    const body = req.body as RoutesParams["createBot"];

    await startBotProcess(body.minionIndex, body.constantGoal);

    res.send(`Starting bot ${kubernetesBotRunner ? "Pod" : "subprocess"}...`);
  });

  app.post(dameonRoutes.restartBots, async (_req, res) => {
    const podConfigs = kubernetesBotRunner
      ? (await getBotPods()).items.map(({ metadata }) => ({
          constantGoal: metadata.annotations?.constantGoal,
          index: Number(metadata.labels["bot-index"]),
        }))
      : Object.keys(botProcesses).map((index) => ({
          constantGoal: botConfigs[Number(index)]?.constantGoal,
          index: Number(index),
        }));

    await Promise.all(
      podConfigs.map(({ constantGoal, index }) =>
        startBotProcess(index, constantGoal),
      ),
    );

    res.send(
      `Restarted ${podConfigs.length} bot ${kubernetesBotRunner ? "Pod(s)" : "subprocess(es)"}`,
    );
  });

  app.post(dameonRoutes.stopBot, async (req, res) => {
    const body = req.body as RoutesParams["stopBot"];

    const stopped = kubernetesBotRunner
      ? await stopBotPod(body.minionIndex)
      : await stopBotProcess(body.minionIndex);

    if (stopped) {
      delete botConfigs[body.minionIndex];

      logger.info(
        `Bot ${body.minionIndex} ${kubernetesBotRunner ? "Pod" : "subprocess"} stopped`,
      );

      res.send(`Stopped bot ${kubernetesBotRunner ? "Pod" : "subprocess"}`);

      return;
    }

    res
      .status(404)
      .send(`Bot ${kubernetesBotRunner ? "Pod" : "subprocess"} not running`);
  });

  createMetricsServer(app, async () => {
    const indexes = kubernetesBotRunner
      ? (await getBotPods()).items.map(({ metadata }) =>
          Number(metadata.labels["bot-index"]),
        )
      : Object.keys(botProcesses).map(Number);

    const results = await Promise.all(
      indexes.map(async (index) => {
        try {
          const metrics = (await botClient(
            index,
            botServiceHost(index),
          ).getMetrics()) as Metric[];

          return { botName: `minion${index}`, metrics };
        } catch (error) {
          logger.warn(`Could not get metrics from minion${index}: ${error}`);

          return null;
        }
      }),
    );

    return results.filter(
      (result): result is { botName: string; metrics: Metric[] } =>
        result !== null,
    );
  });

  const server = app.listen(port, (err: unknown) => {
    if (err) {
      console.error(err);
      process.exit(1);
    }

    logger.info(`Daemon started on port: ${port}`);
  });

  const handleSignal = () => {
    void shutdown().catch((error: unknown) => {
      logger.error(error);
      process.exitCode = 1;
    });
  };

  process.once("SIGINT", handleSignal);
  process.once("SIGTERM", handleSignal);
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
