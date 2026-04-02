import cors from "cors";
import express, { Application } from "express";

import { GlobalErrorHandler } from "./middlewares/GlobalErrorHandler";
import { RequestResponseLoggingMiddleware } from "./middlewares/RequestResponseLoggingMiddleware";
import v1Router from "./routes/v1";
import { ApiResponse } from "./utils/ApiResponse";
import { Logger } from "./utils/Logger";

export const createApp = (): Application => {
  const app: Application = express();

  app.use(cors());
  app.use(express.json());
  app.use(RequestResponseLoggingMiddleware);

  app.get("/health", (_req, res) => {
    Logger.info("Health check called");
    ApiResponse.ok(res, "Auth microservice is healthy.", { status: "operational" });
  });

  app.use("/api/v1", v1Router);
  app.use(GlobalErrorHandler);

  return app;
};
