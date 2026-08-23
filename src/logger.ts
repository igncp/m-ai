import winston from "winston";

const createLogger = () => {
  const fullFormat = winston.format.combine(
    winston.format.timestamp({
      format: "YYYY-MM-DD HH:mm:ss",
    }),
    winston.format.printf(
      ({ level, message, timestamp }) => `${timestamp} [${level}]: ${message}`,
    ),
  );

  const logger = winston.createLogger({
    format: fullFormat,
    level: "info",
    transports: [
      new winston.transports.File({
        filename: "/tmp/blocks-error.log",
        level: "error",
      }),
      new winston.transports.File({ filename: "/tmp/blocks-combined.log" }),
      new winston.transports.Console(),
    ],
  });

  return logger;
};

type Logger = ReturnType<typeof createLogger>;

export { type Logger, createLogger };
