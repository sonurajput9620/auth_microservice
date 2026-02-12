import cors from "cors";
import dotenv from "dotenv";
import express, { Application } from "express";

import { GlobalErrorHandler } from "./middlewares/GlobalErrorHandler";
import v1Router from "./routes/v1";

dotenv.config();

const app: Application = express();
const port: number = Number(process.env.PORT) || 4000;

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

app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`Server is running on port ${port}`);
});
