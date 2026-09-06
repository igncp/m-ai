import { type World } from "./worlds/types";

const dameonRoutes = {
  createBot: "/create-bot",
  health: "/health",
  restartBots: "/restart-bots",
  shutdown: "/shutdown",
  stopBot: "/stop-bot",
  world: "/world",
};

type RoutesParams = {
  createBot: {
    constantGoal?: string;
    minionIndex: number;
  };
  stopBot: {
    minionIndex: number;
  };
};

const daemonClient = {
  baseUrl: process.env.DAEMON_BASE_URL || "http://localhost:50000",

  createBot: async (minionIndex: number = 0, constantGoal?: string) => {
    await fetch(`${daemonClient.baseUrl}/${dameonRoutes.createBot}`, {
      body: JSON.stringify({
        minionIndex,
        ...(constantGoal ? { constantGoal } : {}),
      } satisfies RoutesParams["createBot"]),
      headers: {
        "Content-Type": "application/json",
      },
      method: "POST",
    });
  },

  getWorld: async (): Promise<null | World> => {
    const response = await fetch(
      `${daemonClient.baseUrl}${dameonRoutes.world}`,
    );

    if (!response.ok)
      throw new Error(`Could not read world: ${response.statusText}`);

    return (await response.json()) as null | World;
  },

  restartBots: async () => {
    await fetch(`${daemonClient.baseUrl}/${dameonRoutes.restartBots}`, {
      method: "POST",
    });
  },

  saveWorld: async (world: World): Promise<void> => {
    const response = await fetch(
      `${daemonClient.baseUrl}${dameonRoutes.world}`,
      {
        body: JSON.stringify(world),
        headers: { "Content-Type": "application/json" },
        method: "PUT",
      },
    );

    if (!response.ok)
      throw new Error(`Could not save world: ${response.statusText}`);
  },

  stop: async () => {
    await fetch(`${daemonClient.baseUrl}/${dameonRoutes.shutdown}`, {
      method: "POST",
    });
  },

  stopBot: async (minionIndex: number) => {
    await fetch(`${daemonClient.baseUrl}/${dameonRoutes.stopBot}`, {
      body: JSON.stringify({ minionIndex } satisfies RoutesParams["stopBot"]),
      headers: {
        "Content-Type": "application/json",
      },
      method: "POST",
    });
  },
};

export { type RoutesParams, daemonClient, dameonRoutes };
