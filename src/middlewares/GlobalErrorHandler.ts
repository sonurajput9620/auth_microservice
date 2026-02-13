import { NextFunction, Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { ZodError } from "zod";

import { Logger } from "../utils/Logger";
import { AppError } from "../utils/AppError";
import { ApiResponse, ApiResponsePayload } from "../utils/ApiResponse";

export const GlobalErrorHandler = (
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction
): void => {
  const errorContext = {
    method: req.method,
    path: req.path,
    query: req.query,
    ip: req.ip
  };

  if (err instanceof AppError) {
    Logger.warn(`AppError in ${req.method} ${req.path}`, {
      ...errorContext,
      errorCode: err.errorCode,
      statusCode: err.statusCode,
      message: err.message,
      details: err.details
    });

    const payload: ApiResponsePayload<null> = {
      success: false,
      statusCode: err.statusCode,
      message: err.message,
      errorCode: err.errorCode,
      data: null
    };

    res.status(err.statusCode).json(payload);
    return;
  }

  if (err instanceof ZodError) {
    Logger.warn(`Validation error in ${req.method} ${req.path}`, {
      ...errorContext,
      issues: err.issues
    });

    const payload: ApiResponsePayload<null> = {
      success: false,
      statusCode: StatusCodes.BAD_REQUEST,
      message: "Request validation failed.",
      errorCode: "ValidationError",
      errors: err.issues.map((issue) => ({
        field: String(issue.path.join(".")),
        message: issue.message
      })),
      data: null
    };

    res.status(StatusCodes.BAD_REQUEST).json(payload);
    return;
  }

  // Log unexpected error
  const error = err instanceof Error ? err : new Error(String(err));
  Logger.error(
    `Unexpected error in ${req.method} ${req.path}`,
    error,
    errorContext
  );

  const payload: ApiResponsePayload<null> = {
    success: false,
    statusCode: StatusCodes.INTERNAL_SERVER_ERROR,
    message: "An unexpected error occurred.",
    errorCode: "InternalServerError",
    data: null
  };

  res.status(StatusCodes.INTERNAL_SERVER_ERROR).json(payload);
};
