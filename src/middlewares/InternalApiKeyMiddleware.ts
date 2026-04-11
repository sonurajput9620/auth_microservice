import { NextFunction, Request, Response } from "express";
import { StatusCodes } from "http-status-codes";

import { AppError } from "../utils/AppError";

const getInternalApiKey = (): string => {
  const key = process.env.INTERNAL_AUTH_API_KEY?.trim();
  if (!key) {
    throw new AppError(
      StatusCodes.INTERNAL_SERVER_ERROR,
      "ConfigError",
      "INTERNAL_AUTH_API_KEY is not configured."
    );
  }

  return key;
};

export const RequireInternalApiKey = (
  req: Request,
  _res: Response,
  next: NextFunction
): void => {
  const provided = req.header("x-internal-api-key")?.trim();
  const expected = getInternalApiKey();

  if (!provided || provided !== expected) {
    next(
      new AppError(
        StatusCodes.UNAUTHORIZED,
        "InvalidInternalApiKey",
        "Invalid internal API key."
      )
    );
    return;
  }

  next();
};
