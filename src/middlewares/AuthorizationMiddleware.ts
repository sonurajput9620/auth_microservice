import { createHmac, createPublicKey, createVerify, timingSafeEqual } from "node:crypto";
import { NextFunction, Request, Response } from "express";
import { StatusCodes } from "http-status-codes";

import { AppError } from "../utils/AppError";

type TokenSource = "cognito" | "legacy";

interface JwtHeader {
  alg?: string;
  kid?: string;
}

interface DecodedJwt {
  header: JwtHeader;
  payload: Record<string, unknown>;
  signingInput: string;
  signature: Buffer;
}

interface VerifiedToken {
  source: TokenSource;
  payload: Record<string, unknown>;
}

interface JwksCacheEntry {
  jwk: Jwk;
  expiresAt: number;
}

type Jwk = Record<string, unknown> & { kid?: string };

const JWKS_CACHE_TTL_MS = 60 * 60 * 1000;
const DEFAULT_CLOCK_SKEW_SEC = 30;

const jwksCache = new Map<string, JwksCacheEntry>();

export interface AuthContext {
  sub?: string;
  username?: string;
  role?: string;
  userId?: string;
  email?: string;
  authSource: TokenSource;
  groups: string[];
  permissions: string[];
}

export interface AuthenticatedRequest extends Request {
  auth?: AuthContext;
}

const toBool = (value: string | undefined, defaultValue: boolean): boolean => {
  if (value === undefined) {
    return defaultValue;
  }
  return String(value).trim().toLowerCase() === "true";
};

const normalizeToken = (token: string): string => {
  let value = token.trim();
  if (value.startsWith("\"") && value.endsWith("\"")) {
    value = value.slice(1, -1);
  }
  return value.trim();
};

const decodeBase64UrlToBuffer = (value: string): Buffer => {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padding = "=".repeat((4 - (normalized.length % 4 || 4)) % 4);
  return Buffer.from(normalized + padding, "base64");
};

const decodeBase64UrlJson = (value: string): Record<string, unknown> => {
  try {
    return JSON.parse(decodeBase64UrlToBuffer(value).toString("utf-8")) as Record<string, unknown>;
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
      .split(/[,\s]+/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return [];
};

const decodeJwt = (token: string): DecodedJwt => {
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new AppError(
      StatusCodes.UNAUTHORIZED,
      "UNAUTHORIZED",
      "Invalid bearer token format."
    );
  }

  const header = decodeBase64UrlJson(parts[0]) as JwtHeader;
  const payload = decodeBase64UrlJson(parts[1]);
  const signature = decodeBase64UrlToBuffer(parts[2]);

  return {
    header,
    payload,
    signature,
    signingInput: `${parts[0]}.${parts[1]}`
  };
};

const getClockSkewSec = (): number => {
  const raw = process.env.AUTH_JWT_CLOCK_SKEW_SEC;
  const parsed = Number.parseInt(String(raw ?? DEFAULT_CLOCK_SKEW_SEC), 10);
  if (!Number.isFinite(parsed) || Number.isNaN(parsed) || parsed < 0) {
    return DEFAULT_CLOCK_SKEW_SEC;
  }
  return parsed;
};

const validateTimeClaims = (payload: Record<string, unknown>): void => {
  const nowSec = Math.floor(Date.now() / 1000);
  const skew = getClockSkewSec();

  const exp = Number(payload.exp);
  if (Number.isFinite(exp) && nowSec > exp + skew) {
    throw new AppError(StatusCodes.UNAUTHORIZED, "UNAUTHORIZED", "Token expired.");
  }

  const nbf = Number(payload.nbf);
  if (Number.isFinite(nbf) && nowSec + skew < nbf) {
    throw new AppError(StatusCodes.UNAUTHORIZED, "UNAUTHORIZED", "Token is not active yet.");
  }
};

const getCognitoIssuerFromPayload = (payload: Record<string, unknown>): string => {
  const issuer = payload.iss;
  if (typeof issuer !== "string" || issuer.trim() === "") {
    throw new AppError(StatusCodes.UNAUTHORIZED, "UNAUTHORIZED", "Invalid Cognito issuer.");
  }
  return issuer.trim();
};

const getExpectedCognitoIssuer = (): string | null => {
  if (process.env.COGNITO_ISSUER?.trim()) {
    return process.env.COGNITO_ISSUER.trim();
  }

  const region = process.env.COGNITO_REGION?.trim() || process.env.AWS_DEFAULT_REGION?.trim();
  const userPoolId = process.env.COGNITO_USER_POOL_ID?.trim();
  if (!region || !userPoolId) {
    return null;
  }

  return `https://cognito-idp.${region}.amazonaws.com/${userPoolId}`;
};

const getAllowedCognitoClientIds = (): string[] => {
  const raw =
    process.env.COGNITO_ALLOWED_CLIENT_IDS ||
    process.env.COGNITO_CLIENT_ID ||
    "";

  return raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
};

const validateCognitoAudience = (payload: Record<string, unknown>): void => {
  const enforceAudience = toBool(process.env.COGNITO_VALIDATE_AUDIENCE, true);
  if (!enforceAudience) {
    return;
  }

  const allowedClientIds = getAllowedCognitoClientIds();
  if (allowedClientIds.length === 0) {
    return;
  }

  const tokenUse = String(payload.token_use || "");
  const aud = String(payload.aud || "");
  const clientId = String(payload.client_id || "");

  if (tokenUse === "id") {
    if (!allowedClientIds.includes(aud)) {
      throw new AppError(StatusCodes.UNAUTHORIZED, "UNAUTHORIZED", "Invalid Cognito token audience.");
    }
    return;
  }

  if (tokenUse === "access") {
    if (!allowedClientIds.includes(clientId)) {
      throw new AppError(StatusCodes.UNAUTHORIZED, "UNAUTHORIZED", "Invalid Cognito token client.");
    }
    return;
  }

  if (!allowedClientIds.includes(aud) && !allowedClientIds.includes(clientId)) {
    throw new AppError(StatusCodes.UNAUTHORIZED, "UNAUTHORIZED", "Invalid Cognito token audience.");
  }
};

const getJwkForKid = async (issuer: string, kid: string): Promise<Jwk> => {
  const cacheKey = `${issuer}|${kid}`;
  const cached = jwksCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.jwk;
  }

  const response = await fetch(`${issuer}/.well-known/jwks.json`);
  if (!response.ok) {
    throw new AppError(
      StatusCodes.UNAUTHORIZED,
      "UNAUTHORIZED",
      `Unable to fetch Cognito keys (${response.status}).`
    );
  }

  const body = (await response.json()) as { keys?: Jwk[] };
  const keys = Array.isArray(body.keys) ? body.keys : [];
  const jwk = keys.find((item) => item.kid === kid);

  if (!jwk) {
    throw new AppError(StatusCodes.UNAUTHORIZED, "UNAUTHORIZED", "Cognito signing key not found.");
  }

  jwksCache.set(cacheKey, {
    jwk,
    expiresAt: Date.now() + JWKS_CACHE_TTL_MS
  });

  return jwk;
};

const verifySignatureRs256 = (decoded: DecodedJwt, jwk: Jwk): void => {
  const verifier = createVerify("RSA-SHA256");
  verifier.update(decoded.signingInput);
  verifier.end();

  const publicKey = createPublicKey({ key: jwk as any, format: "jwk" } as any);
  const isValid = verifier.verify(publicKey, decoded.signature);
  if (!isValid) {
    throw new AppError(StatusCodes.UNAUTHORIZED, "UNAUTHORIZED", "Invalid token signature.");
  }
};

const verifySignatureHs256 = (decoded: DecodedJwt, secret: string): void => {
  const expected = createHmac("sha256", secret).update(decoded.signingInput).digest();
  if (expected.length !== decoded.signature.length) {
    throw new AppError(StatusCodes.UNAUTHORIZED, "UNAUTHORIZED", "Invalid token signature.");
  }
  if (!timingSafeEqual(expected, decoded.signature)) {
    throw new AppError(StatusCodes.UNAUTHORIZED, "UNAUTHORIZED", "Invalid token signature.");
  }
};

const verifyCognitoToken = async (decoded: DecodedJwt): Promise<VerifiedToken> => {
  const alg = String(decoded.header.alg || "");
  if (alg !== "RS256") {
    throw new AppError(StatusCodes.UNAUTHORIZED, "UNAUTHORIZED", "Unsupported Cognito token algorithm.");
  }

  const issuer = getCognitoIssuerFromPayload(decoded.payload);
  const expectedIssuer = getExpectedCognitoIssuer();
  if (expectedIssuer && issuer !== expectedIssuer) {
    throw new AppError(StatusCodes.UNAUTHORIZED, "UNAUTHORIZED", "Cognito issuer mismatch.");
  }

  const kid = decoded.header.kid;
  if (!kid) {
    throw new AppError(StatusCodes.UNAUTHORIZED, "UNAUTHORIZED", "Cognito token key id is missing.");
  }

  const jwk = await getJwkForKid(issuer, kid);
  verifySignatureRs256(decoded, jwk);
  validateTimeClaims(decoded.payload);
  validateCognitoAudience(decoded.payload);

  return {
    source: "cognito",
    payload: decoded.payload
  };
};

const verifyLegacyToken = (decoded: DecodedJwt): VerifiedToken => {
  const allowLegacy = toBool(process.env.AUTH_ALLOW_LEGACY_JWT, true);
  if (!allowLegacy) {
    throw new AppError(StatusCodes.UNAUTHORIZED, "UNAUTHORIZED", "Legacy JWT is disabled.");
  }

  const secret = process.env.LEGACY_JWT_SECRET || process.env.JWT_SECRET;
  if (!secret) {
    throw new AppError(
      StatusCodes.INTERNAL_SERVER_ERROR,
      "CONFIG_ERROR",
      "Legacy JWT secret is not configured."
    );
  }

  const alg = String(decoded.header.alg || "");
  if (alg !== "HS256") {
    throw new AppError(StatusCodes.UNAUTHORIZED, "UNAUTHORIZED", "Unsupported legacy token algorithm.");
  }

  verifySignatureHs256(decoded, secret);
  validateTimeClaims(decoded.payload);

  const expectedIssuer = process.env.LEGACY_JWT_ISSUER?.trim();
  if (expectedIssuer && decoded.payload.iss !== expectedIssuer) {
    throw new AppError(StatusCodes.UNAUTHORIZED, "UNAUTHORIZED", "Legacy issuer mismatch.");
  }

  const expectedAudience = process.env.LEGACY_JWT_AUDIENCE
    ?.split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  if (expectedAudience && expectedAudience.length > 0) {
    const tokenAud = decoded.payload.aud;
    const audList = Array.isArray(tokenAud)
      ? tokenAud.map((item) => String(item))
      : tokenAud
        ? [String(tokenAud)]
        : [];

    const matched = expectedAudience.some((aud) => audList.includes(aud));
    if (!matched) {
      throw new AppError(StatusCodes.UNAUTHORIZED, "UNAUTHORIZED", "Legacy audience mismatch.");
    }
  }

  return {
    source: "legacy",
    payload: decoded.payload
  };
};

const verifyAnyToken = async (token: string): Promise<VerifiedToken> => {
  const decoded = decodeJwt(token);
  const issuer = decoded.payload.iss;
  const looksLikeCognito = typeof issuer === "string" && issuer.includes("cognito-idp.");

  let firstError: AppError | null = null;

  try {
    return looksLikeCognito ? await verifyCognitoToken(decoded) : verifyLegacyToken(decoded);
  } catch (error) {
    firstError = error instanceof AppError
      ? error
      : new AppError(StatusCodes.UNAUTHORIZED, "UNAUTHORIZED", "Invalid token.");
  }

  try {
    return looksLikeCognito ? verifyLegacyToken(decoded) : await verifyCognitoToken(decoded);
  } catch {
    throw firstError;
  }
};

const buildAuthContext = (payload: Record<string, unknown>, source: TokenSource): AuthContext => {
  const groups = toStringArray(payload["cognito:groups"] ?? payload.groups);
  const permissions = toStringArray(
    payload.permissions ?? payload["custom:permissions"] ?? payload.scope
  );

  const username =
    typeof payload.preferred_username === "string"
      ? payload.preferred_username
      : typeof payload["cognito:username"] === "string"
        ? String(payload["cognito:username"])
        : typeof payload.username === "string"
          ? payload.username
          : undefined;

  const roleRaw =
    payload["custom:role"] ??
    payload.role ??
    payload["custom:user_role"] ??
    payload.user_role;

  const userIdRaw = payload["custom:user_id"] ?? payload.user_id ?? payload.id;

  return {
    sub: typeof payload.sub === "string" ? payload.sub : undefined,
    username,
    role: roleRaw !== undefined && roleRaw !== null ? String(roleRaw) : undefined,
    userId: userIdRaw !== undefined && userIdRaw !== null ? String(userIdRaw) : undefined,
    email: typeof payload.email === "string" ? payload.email : undefined,
    authSource: source,
    groups,
    permissions
  };
};

const isAuthDisabled = (): boolean => {
  if (process.env.NODE_ENV === "production") {
    return false;
  }

  return process.env.DISABLE_AUTH === "true";
};

const isAdmin = (auth: AuthContext): boolean => {
  const role = auth.role?.toLowerCase() ?? "";
  if (role === "admin" || role === "administrator" || role == "1") {
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

export const RequireAuth = async (
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction
): Promise<void> => {
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

  const token = normalizeToken(authorization.slice(7));
  if (!token) {
    next(new AppError(StatusCodes.UNAUTHORIZED, "UNAUTHORIZED", "Bearer token is empty."));
    return;
  }

  try {
    const verified = await verifyAnyToken(token);
    req.auth = buildAuthContext(verified.payload, verified.source);
    next();
  } catch (error) {
    next(
      error instanceof AppError
        ? error
        : new AppError(StatusCodes.UNAUTHORIZED, "UNAUTHORIZED", "Invalid token.")
    );
  }
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
