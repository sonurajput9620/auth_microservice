import dotenv from "dotenv";
import serverlessExpress from "@vendia/serverless-express";

import { createApp } from "./src/app";
import { connectDB } from "./src/prismaClient";

dotenv.config();

const allowedOrigins = [
  "http://localhost:4200",
  "http://localhost:3000",
  "https://dev.pure.bi",
  "https://nodetest.pure.bi",
  "https://staging.pure.bi",
  "https://app.pure.bi",
  "https://test.pure.bi",
  "http://localhost:8080",
  "https://purifai.tech"
];

let cachedHandler:
  | ((
      event: unknown,
      context: unknown,
    ) => Promise<unknown>)
  | null = null;
let isDatabaseConnected = false;

type LambdaHandler = (
  event: unknown,
  context: unknown,
) => Promise<unknown>;

const resolveOrigin = (event: any): string => {
  const origin = event?.headers?.origin || event?.headers?.Origin;
  if (!origin || process.env.NODE_ENV !== "production") {
    return origin || "*";
  }

  return allowedOrigins.includes(origin) ? origin : allowedOrigins[0];
};

const isOptionsRequest = (event: any): boolean => {
  const method = event?.requestContext?.http?.method || event?.httpMethod || "";
  return String(method).toUpperCase() === "OPTIONS";
};

const buildCorsResponse = (origin: string) => ({
  statusCode: 200,
  headers: {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, PATCH, OPTIONS",
    "Access-Control-Allow-Headers":
      "Content-Type, Authorization, X-Requested-With, Accept, Origin, X-Api-Key",
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Max-Age": "86400",
    "Content-Type": "application/json",
  },
  body: "",
});

const getHandler = async (): Promise<LambdaHandler> => {
  if (!isDatabaseConnected) {
    await connectDB();
    isDatabaseConnected = true;
  }

  if (!cachedHandler) {
    cachedHandler = serverlessExpress({
      app: createApp(),
    });
  }

  return cachedHandler as LambdaHandler;
};

export const handler = async (event: any, context: any) => {
  const origin = resolveOrigin(event);

  if (isOptionsRequest(event)) {
    return buildCorsResponse(origin);
  }

  try {
    const expressHandler = await getHandler();
    return await expressHandler(event, context);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";

    return {
      statusCode: 500,
      headers: {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Credentials": "true",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        success: false,
        statusCode: 500,
        message: "Failed to initialize auth microservice Lambda.",
        errorCode: "LambdaBootstrapFailed",
        details: message,
      }),
    };
  }
};
