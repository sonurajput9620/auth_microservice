import dotenv from "dotenv";

import { createApp } from "./app";
import { connectDB, disconnectDB } from "./prismaClient";
import { Logger } from "./utils/Logger";

dotenv.config();

const app = createApp();
const port: number = Number(process.env.PORT) || 4100;

const bootstrap = async (): Promise<void> => {
  try {
    await connectDB();
    Logger.info("Database connected successfully.");

    const server = app.listen(port, () => {
      Logger.info(`Server is running on port ${port}`, { port });
    });

    const shutdown = async (signal: string): Promise<void> => {
      Logger.info(`${signal} received. Shutting down gracefully...`, { signal });
      server.close(async () => {
        await disconnectDB();
        Logger.info("Database disconnected. Server shut down.");
        process.exit(0);
      });
    };

    process.on("SIGINT", () => {
      void shutdown("SIGINT");
    });

    process.on("SIGTERM", () => {
      void shutdown("SIGTERM");
    });
  } catch (err: unknown) {
    const error = err instanceof Error ? err : new Error(String(err));
    Logger.error("Failed to connect database.", error);
    process.exit(1);
  }
};

void bootstrap();
