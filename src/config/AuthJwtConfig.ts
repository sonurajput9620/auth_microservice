import { AppError } from "../utils/AppError";

export type CognitoTokenUse = "access" | "id";

const DEFAULT_ALLOWED_TOKEN_USE: CognitoTokenUse[] = ["access", "id"];

const getRequiredEnv = (key: string): string => {
  const value = process.env[key]?.trim();
  if (!value) {
    throw new AppError(500, "ConfigError", `${key} is not configured.`);
  }
  return value;
};

const parseAllowedTokenUse = (rawValue?: string): CognitoTokenUse[] => {
  if (!rawValue || !rawValue.trim()) {
    return DEFAULT_ALLOWED_TOKEN_USE;
  }

  const parsed = rawValue
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);

  const unique = Array.from(new Set(parsed));
  const allowed = unique.filter(
    (item): item is CognitoTokenUse => item === "access" || item === "id",
  );

  if (!allowed.length) {
    throw new AppError(
      500,
      "ConfigError",
      "COGNITO_ALLOWED_TOKEN_USE must contain at least one of: access,id.",
    );
  }

  return allowed;
};

const region = process.env.COGNITO_REGION?.trim() || getRequiredEnv("AWS_DEFAULT_REGION");
const userPoolId = getRequiredEnv("COGNITO_USER_POOL_ID");
const clientId = getRequiredEnv("COGNITO_CLIENT_ID");
const audience = process.env.COGNITO_JWT_AUDIENCE?.trim() || clientId;
const allowedTokenUse = parseAllowedTokenUse(process.env.COGNITO_ALLOWED_TOKEN_USE);
const issuer = `https://cognito-idp.${region}.amazonaws.com/${userPoolId}`;

export const authJwtConfig = {
  region,
  userPoolId,
  clientId,
  audience,
  issuer,
  allowedTokenUse,
} as const;
