import cors from "cors";
import dotenv from "dotenv";
import express, { Application } from "express";

import { GlobalErrorHandler } from "./middlewares/GlobalErrorHandler";
import { RequestResponseLoggingMiddleware } from "./middlewares/RequestResponseLoggingMiddleware";
import { connectDB, disconnectDB } from "./prismaClient";
import { Logger } from "./utils/Logger";
import { ApiResponse } from "./utils/ApiResponse";
import v1Router from "./routes/v1";

dotenv.config();

const app: Application = express();
const port: number = Number(process.env.PORT) || 4100;

app.use(cors());
app.use(express.json());

// Request/Response logging middleware
app.use(RequestResponseLoggingMiddleware);

app.get("/health", (_req, res) => {
  Logger.info("Health check called");
  ApiResponse.ok(res, "Auth microservice is healthy.", { status: "operational" });
});

app.use("/api/v1", v1Router);
app.use(GlobalErrorHandler);

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
