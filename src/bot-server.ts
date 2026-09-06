const BOT_PORT_ENV = "BOT_PORT";
const BOT_PORT = 6000;
const MAX_BOT_INDEX = 10;

const botServerRoutes = {
  fetchWorld: "/fetch-world",
};

const getBotServerPort = (): number => {
  const port = Number(process.env[BOT_PORT_ENV]);

  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error(`${BOT_PORT_ENV} must be a valid port number`);

  return port;
};

const getBotPort = (index: number): number => {
  if (!Number.isInteger(index) || index < 0 || index > MAX_BOT_INDEX)
    throw new Error(`Bot index must be between 0 and ${MAX_BOT_INDEX}`);

  return BOT_PORT + index;
};

const botClient = (index: number, host = "localhost") => {
  const fetchBot = async (route: string, init?: RequestInit) => {
    const response = await fetch(
      `http://${host}:${getBotPort(index)}${route}`,
      init,
    );

    if (!response.ok)
      throw new Error(
        `Bot ${index} request to ${route} failed: ${response.statusText}`,
      );

    return response;
  };

  const notifyFetchWorld = () =>
    fetchBot(botServerRoutes.fetchWorld, { method: "POST" });

  return { notifyFetchWorld };
};

export {
  BOT_PORT_ENV,
  botClient,
  botServerRoutes,
  getBotPort,
  getBotServerPort,
};
