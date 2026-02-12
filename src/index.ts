import cors from "cors";
import dotenv from "dotenv";
import express, { Application } from "express";

import { GlobalErrorHandler } from "./middlewares/GlobalErrorHandler";
import { connectDB, disconnectDB } from "./prismaClient";
import v1Router from "./routes/v1";

dotenv.config();

const app: Application = express();
const port: number = Number(process.env.PORT) || 4100;

app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => {
  res.status(200).json({
    success: true,
    message: "Auth microservice is healthy."
  });
});

app.use("/api/v1", v1Router);
app.use(GlobalErrorHandler);

const bootstrap = async (): Promise<void> => {
  try {
    await connectDB();
    // eslint-disable-next-line no-console
    console.log("Database connected successfully.");

    const server = app.listen(port, () => {
      // eslint-disable-next-line no-console
      console.log(`Server is running on port ${port}`);
    });

    const shutdown = async (signal: string): Promise<void> => {
      // eslint-disable-next-line no-console
      console.log(`${signal} received. Shutting down gracefully...`);
      server.close(async () => {
        await disconnectDB();
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
    // eslint-disable-next-line no-console
    console.error("Failed to connect database.", err);
    process.exit(1);
  }
};

void bootstrap();
