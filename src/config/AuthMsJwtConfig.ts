import { AppError } from "../utils/AppError";

type SupportedJwtAlg = "RS256" | "ES256";

type JwkShape = {
  kty?: string;
  crv?: string;
  x?: string;
  y?: string;
  n?: string;
  e?: string;
  use?: string;
  alg?: string;
  kid?: string;
  [key: string]: unknown;
};

type ParsedKeyInput = {
  kid: string;
  alg: SupportedJwtAlg;
  privateKeyPem: string;
  publicJwk: JwkShape;
  enabled?: boolean;
};

type SigningKey = {
  kid: string;
  alg: SupportedJwtAlg;
  privateKeyPem: string;
};

type PublicJwk = JwkShape & {
  kid: string;
  alg: SupportedJwtAlg;
  use: "sig";
};

const parseExpiresInSeconds = (rawValue?: string): number => {
  if (!rawValue || !rawValue.trim()) {
    return 3600;
  }

  const parsed = Number.parseInt(rawValue.trim(), 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new AppError(
      500,
      "ConfigError",
      "AUTH_MS_JWT_EXPIRES_IN_SEC must be a positive integer.",
    );
  }

  return parsed;
};

const issuer = process.env.AUTH_MS_ISSUER?.trim();
if (!issuer) {
  throw new AppError(500, "ConfigError", "AUTH_MS_ISSUER is not configured.");
}

const audience = process.env.AUTH_MS_AUDIENCE?.trim();
if (!audience) {
  throw new AppError(500, "ConfigError", "AUTH_MS_AUDIENCE is not configured.");
}

const parseAlg = (value: unknown): SupportedJwtAlg => {
  if (value === "RS256" || value === "ES256") {
    return value;
  }

  throw new AppError(
    500,
    "ConfigError",
    "AUTH_MS_JWT_KEYS_JSON contains unsupported alg. Allowed: RS256, ES256.",
  );
};

const sanitizePublicJwk = (jwk: JwkShape, kid: string, alg: SupportedJwtAlg): PublicJwk => {
  const { d, p, q, dp, dq, qi, oth, k, ...rest } = jwk as JwkShape & {
    d?: string;
    p?: string;
    q?: string;
    dp?: string;
    dq?: string;
    qi?: string;
    oth?: unknown;
    k?: string;
  };

  return {
    ...rest,
    kid,
    alg,
    use: "sig",
  };
};

const parseKeys = (rawValue?: string): ParsedKeyInput[] => {
  if (!rawValue || !rawValue.trim()) {
    throw new AppError(
      500,
      "ConfigError",
      "AUTH_MS_JWT_KEYS_JSON is not configured.",
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawValue);
  } catch {
    throw new AppError(
      500,
      "ConfigError",
      "AUTH_MS_JWT_KEYS_JSON must be valid JSON.",
    );
  }

  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new AppError(
      500,
      "ConfigError",
      "AUTH_MS_JWT_KEYS_JSON must be a non-empty JSON array.",
    );
  }

  const keys: ParsedKeyInput[] = parsed.map((item, index) => {
    const key = item as {
      kid?: unknown;
      alg?: unknown;
      privateKeyPem?: unknown;
      publicJwk?: unknown;
      enabled?: unknown;
    };

    const kid = typeof key.kid === "string" ? key.kid.trim() : "";
    const privateKeyPem =
      typeof key.privateKeyPem === "string" ? key.privateKeyPem.trim() : "";
    const publicJwk =
      key.publicJwk && typeof key.publicJwk === "object"
        ? (key.publicJwk as JwkShape)
        : null;

    if (!kid) {
      throw new AppError(
        500,
        "ConfigError",
        `AUTH_MS_JWT_KEYS_JSON[${index}].kid is required.`,
      );
    }

    if (!privateKeyPem) {
      throw new AppError(
        500,
        "ConfigError",
        `AUTH_MS_JWT_KEYS_JSON[${index}].privateKeyPem is required.`,
      );
    }

    if (!publicJwk) {
      throw new AppError(
        500,
        "ConfigError",
        `AUTH_MS_JWT_KEYS_JSON[${index}].publicJwk is required.`,
      );
    }

    return {
      kid,
      alg: parseAlg(key.alg),
      privateKeyPem,
      publicJwk,
      enabled: key.enabled === undefined ? true : Boolean(key.enabled),
    };
  });

  const uniqueKidCount = new Set(keys.map((key) => key.kid)).size;
  if (uniqueKidCount !== keys.length) {
    throw new AppError(
      500,
      "ConfigError",
      "AUTH_MS_JWT_KEYS_JSON contains duplicate kid values.",
    );
  }

  return keys;
};

const parsedKeys = parseKeys(process.env.AUTH_MS_JWT_KEYS_JSON);
const enabledKeys = parsedKeys.filter((key) => key.enabled !== false);

if (!enabledKeys.length) {
  throw new AppError(
    500,
    "ConfigError",
    "AUTH_MS_JWT_KEYS_JSON has no enabled keys.",
  );
}

const requestedActiveKid = process.env.AUTH_MS_JWT_ACTIVE_KID?.trim() || "";
const signingSource =
  enabledKeys.find((key) => key.kid === requestedActiveKid) || enabledKeys[0];

const signingKey: SigningKey = {
  kid: signingSource.kid,
  alg: signingSource.alg,
  privateKeyPem: signingSource.privateKeyPem,
};

const jwks = {
  keys: enabledKeys.map((key) => sanitizePublicJwk(key.publicJwk, key.kid, key.alg)),
} as const;

export const authMsJwtConfig = {
  signingKey,
  jwks,
  issuer,
  audience,
  expiresInSec: parseExpiresInSeconds(process.env.AUTH_MS_JWT_EXPIRES_IN_SEC),
} as const;
