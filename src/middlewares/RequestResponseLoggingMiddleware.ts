import { NextFunction, Request, Response } from "express";
import { Logger } from "../utils/Logger";

export interface RequestWithTimestamp extends Request {
  startTime?: number;
}

export const RequestResponseLoggingMiddleware = (
  req: RequestWithTimestamp,
  res: Response,
  next: NextFunction
): void => {
  // Record start time
  req.startTime = Date.now();

  // Log incoming request
  Logger.debug(`Incoming ${req.method} request`, {
    method: req.method,
    path: req.path,
    query: req.query,
    ip: req.ip,
    userAgent: req.get("user-agent")
  });

  // Capture the original send method
  const originalSend = res.send;

  // Override the send method to log the response
  res.send = function (data: any): Response {
    const duration = Date.now() - (req.startTime || 0);

    // Log the response
    Logger.http(req.method, req.path, res.statusCode, duration);

    if (res.statusCode >= 400) {
      Logger.warn(`API error response`, {
        method: req.method,
        path: req.path,
        statusCode: res.statusCode,
        duration_ms: duration,
        response: typeof data === "object" ? data : { body: data }
      });
    }

    // Call the original send method
    return originalSend.call(this, data);
  };

  next();
};
