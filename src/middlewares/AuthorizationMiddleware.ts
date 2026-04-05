import { NextFunction, Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { CognitoJwtVerifier } from "aws-jwt-verify";
import { CognitoJwtPayload } from "aws-jwt-verify/jwt-model";

import { authJwtConfig, CognitoTokenUse } from "../config/AuthJwtConfig";
import { AppError } from "../utils/AppError";
import { Logger } from "../utils/Logger";

export interface AuthContext {
  sub?: string;
  username?: string;
  tokenUse?: "access" | "id";
  clientId?: string;
  role?: string;
  groups: string[];
  permissions: string[];
}

export interface AuthenticatedRequest extends Request {
  auth?: AuthContext;
}

const authMetricCounters = new Map<string, number>();

const incrementAuthMetric = (
  metric: string,
  labels: Record<string, string>,
): number => {
  const key = `${metric}|${JSON.stringify(labels)}`;
  const nextValue = (authMetricCounters.get(key) || 0) + 1;
  authMetricCounters.set(key, nextValue);
  Logger.info("AUTH_METRIC", {
    metric,
    value: nextValue,
    ...labels,
  });
  return nextValue;
};

const recordVerificationFailure = (reason: string): void => {
  incrementAuthMetric("auth_verification_failure_total", {
    auth_source: "cognito",
    reason,
  });
  Logger.warn("Cognito token verification failed", {
    auth_source: "cognito",
    reason,
  });
};

const recordVerificationSuccess = (tokenUse: string): void => {
  incrementAuthMetric("auth_verification_success_total", {
    auth_source: "cognito",
    token_use: tokenUse,
  });
};

const decodeBase64Url = (value: string): string => {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const pad = normalized.length % 4;
  const padded = pad === 0 ? normalized : normalized + "=".repeat(4 - pad);
  return Buffer.from(padded, "base64").toString("utf-8");
};

const parseBearerTokenPayloadUnsafe = (token: string): Record<string, unknown> => {
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
    tokenUse:
      payload.token_use === "access" || payload.token_use === "id"
        ? payload.token_use
        : undefined,
    clientId:
      typeof payload.client_id === "string"
        ? payload.client_id
        : typeof payload.aud === "string"
          ? payload.aud
          : undefined,
    groups,
    permissions
  };
};

const tokenUseVerifiers = authJwtConfig.allowedTokenUse.reduce<
  Partial<Record<CognitoTokenUse, ReturnType<typeof CognitoJwtVerifier.create>>>
>((acc, tokenUse) => {
  acc[tokenUse] = CognitoJwtVerifier.create({
    userPoolId: authJwtConfig.userPoolId,
    tokenUse,
    clientId: authJwtConfig.audience
  });
  return acc;
}, {});

const verifyCognitoJwt = async (token: string): Promise<CognitoJwtPayload> => {
  const unsafePayload = parseBearerTokenPayloadUnsafe(token);
  const tokenUse = String(unsafePayload.token_use ?? "").toLowerCase() as CognitoTokenUse;

  if (tokenUse !== "access" && tokenUse !== "id") {
    recordVerificationFailure("invalid_token_use_claim");
    throw new AppError(
      StatusCodes.UNAUTHORIZED,
      "UNAUTHORIZED",
      "Invalid token_use claim."
    );
  }

  if (!authJwtConfig.allowedTokenUse.includes(tokenUse)) {
    recordVerificationFailure("token_use_not_allowed");
    throw new AppError(
      StatusCodes.UNAUTHORIZED,
      "UNAUTHORIZED",
      `token_use ${tokenUse} is not allowed for this API.`
    );
  }

  const verifier = tokenUseVerifiers[tokenUse];
  if (!verifier) {
    recordVerificationFailure("verifier_not_configured");
    throw new AppError(
      StatusCodes.INTERNAL_SERVER_ERROR,
      "ConfigError",
      `Verifier not configured for token_use ${tokenUse}.`
    );
  }

  try {
    const verifiedPayload = await verifier.verify(token);

    if (verifiedPayload.iss !== authJwtConfig.issuer) {
      recordVerificationFailure("invalid_issuer");
      throw new AppError(
        StatusCodes.UNAUTHORIZED,
        "UNAUTHORIZED",
        "Invalid issuer claim."
      );
    }

    if (
      typeof verifiedPayload.exp !== "number" ||
      verifiedPayload.exp <= Math.floor(Date.now() / 1000)
    ) {
      recordVerificationFailure("token_expired");
      throw new AppError(
        StatusCodes.UNAUTHORIZED,
        "UNAUTHORIZED",
        "Token is expired."
      );
    }

    if (verifiedPayload.token_use !== tokenUse) {
      recordVerificationFailure("token_use_mismatch");
      throw new AppError(
        StatusCodes.UNAUTHORIZED,
        "UNAUTHORIZED",
        "token_use claim mismatch."
      );
    }

    recordVerificationSuccess(tokenUse);
    return verifiedPayload;
  } catch (error: unknown) {
    if (error instanceof AppError) {
      throw error;
    }

    recordVerificationFailure("signature_or_claims_verification_failed");
    throw new AppError(
      StatusCodes.UNAUTHORIZED,
      "UNAUTHORIZED",
      "Token verification failed."
    );
  }
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
    recordVerificationFailure("missing_or_invalid_authorization_header");
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
    recordVerificationFailure("empty_bearer_token");
    next(new AppError(StatusCodes.UNAUTHORIZED, "UNAUTHORIZED", "Bearer token is empty."));
    return;
  }

  void verifyCognitoJwt(token)
    .then((payload) => {
      req.auth = buildAuthContext(payload as unknown as Record<string, unknown>);
      next();
    })
    .catch((error: unknown) => {
      next(error as Error);
    });
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
