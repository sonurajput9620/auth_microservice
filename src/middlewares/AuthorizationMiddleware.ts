import { NextFunction, Request, Response } from "express";
import { StatusCodes } from "http-status-codes";

import { AppError } from "../utils/AppError";

export interface AuthContext {
  sub?: string;
  username?: string;
  role?: string;
  groups: string[];
  permissions: string[];
}

export interface AuthenticatedRequest extends Request {
  auth?: AuthContext;
}

const decodeBase64Url = (value: string): string => {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const pad = normalized.length % 4;
  const padded = pad === 0 ? normalized : normalized + "=".repeat(4 - pad);
  return Buffer.from(padded, "base64").toString("utf-8");
};

const toStringArray = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }

  if (typeof value === "string") {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return [];
};

const parseTokenPayload = (token: string): Record<string, unknown> => {
  const parts = token.split(".");
  if (parts.length < 2) {
    throw new AppError(
      StatusCodes.UNAUTHORIZED,
      "UNAUTHORIZED",
      "Invalid bearer token format."
    );
  }

  try {
    return JSON.parse(decodeBase64Url(parts[1])) as Record<string, unknown>;
  } catch {
    throw new AppError(
      StatusCodes.UNAUTHORIZED,
      "UNAUTHORIZED",
      "Invalid bearer token payload."
    );
  }
};

const buildAuthContext = (payload: Record<string, unknown>): AuthContext => {
  const groups = toStringArray(payload["cognito:groups"] ?? payload.groups);
  const permissions = toStringArray(
    payload.permissions ?? payload["custom:permissions"] ?? payload.scope
  );

  return {
    sub: typeof payload.sub === "string" ? payload.sub : undefined,
    username:
      typeof payload.preferred_username === "string"
        ? payload.preferred_username
        : typeof payload.username === "string"
          ? payload.username
          : undefined,
    role:
      typeof payload["custom:role"] === "string"
        ? String(payload["custom:role"])
        : typeof payload.role === "string"
          ? String(payload.role)
          : undefined,
    groups,
    permissions
  };
};

const isAuthDisabled = (): boolean => {
  // In automated test pipelines, keep auth enabled even if DISABLE_AUTH is set,
  // to avoid bypassing hard security behavior during test verification.
  if (process.env.NODE_ENV === "production") {
    return false;
  }

  return process.env.DISABLE_AUTH === "true";
};

const isAdmin = (auth: AuthContext): boolean => {
  const role = auth.role?.toLowerCase() ?? "";
  if (role === "admin" || role === "administrator") {
    return true;
  }

  const groupSet = new Set(auth.groups.map((group) => group.toLowerCase()));
  return groupSet.has("admin") || groupSet.has("administrators");
};

const hasAnyPermission = (auth: AuthContext, required: string[]): boolean => {
  if (isAdmin(auth)) {
    return true;
  }

  const permissionSet = new Set(auth.permissions.map((permission) => permission.toLowerCase()));
  return required.some((permission) => permissionSet.has(permission.toLowerCase()));
};

export const RequireAuth = (
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction
): void => {
  if (isAuthDisabled()) {
    next();
    return;
  }

  const authorization = req.header("authorization") ?? "";
  if (!authorization.toLowerCase().startsWith("bearer ")) {
    next(
      new AppError(
        StatusCodes.UNAUTHORIZED,
        "UNAUTHORIZED",
        "Missing or invalid Authorization header."
      )
    );
    return;
  }

  const token = authorization.slice(7).trim();
  if (!token) {
    next(new AppError(StatusCodes.UNAUTHORIZED, "UNAUTHORIZED", "Bearer token is empty."));
    return;
  }

  const payload = parseTokenPayload(token);
  req.auth = buildAuthContext(payload);
  next();
};

export const RequireAdmin = (
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction
): void => {
  if (isAuthDisabled()) {
    next();
    return;
  }

  if (!req.auth) {
    next(new AppError(StatusCodes.UNAUTHORIZED, "UNAUTHORIZED", "Authentication required."));
    return;
  }

  if (!isAdmin(req.auth)) {
    next(new AppError(StatusCodes.FORBIDDEN, "FORBIDDEN", "Admin access required."));
    return;
  }

  next();
};

export const RequireAnyPermission =
  (...permissions: string[]) =>
    (req: AuthenticatedRequest, _res: Response, next: NextFunction): void => {
      if (isAuthDisabled()) {
        next();
        return;
      }

      if (!req.auth) {
        next(new AppError(StatusCodes.UNAUTHORIZED, "UNAUTHORIZED", "Authentication required."));
        return;
      }

      if (!hasAnyPermission(req.auth, permissions)) {
        next(
          new AppError(
            StatusCodes.FORBIDDEN,
            "FORBIDDEN",
            "Insufficient permissions for this operation."
          )
        );
        return;
      }

      next();
    };
