import express, { type Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { generateKeyPairSync } from "crypto";

type BridgeRow = {
  id: bigint;
  provider: string;
  provider_subject: string;
  cognito_sub: string;
  app_user_id: number | null;
  legacy_user_id: number | null;
};

type RegisterUserRow = {
  id: number;
  cognito_sub: string;
  username: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  email_verified: boolean;
  status: "APPROVED";
};

type AppUserRow = {
  id: number;
  register_user_id: number;
  cognito_sub: string;
  username: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  role_id: number | null;
  site_id: number | null;
  corporation_id: number | null;
  status: boolean;
  created_at: Date;
  updated_at: Date;
};

type LegacyUserRow = {
  user_id: number;
  username: string;
  email: string;
  provider: string;
  password: string;
  first_name: string;
  last_name: string;
  lab_type: number;
  dob: Date;
  created_date: Date;
  status: boolean;
};

const FIXTURES = {
  tbl_user: [
    {
      user_id: 42,
      username: "legacy.fixture.user",
      email: "legacy.fixture@example.com",
      provider: "cognito",
      password: "fixture",
      first_name: "Legacy",
      last_name: "Fixture",
      lab_type: 0,
      dob: new Date("1970-01-01"),
      created_date: new Date("2026-01-01T00:00:00Z"),
      status: true,
    },
  ] satisfies LegacyUserRow[],
  tbl_siteuser: [
    { user_id: 42, site_id: 7001, status: 1 },
    { user_id: 11, site_id: 9009, status: 1 },
  ],
  user_auth_bridge: [
    {
      id: 1n,
      provider: "cognito",
      provider_subject: "cognito-sub-fixture-001",
      cognito_sub: "cognito-sub-fixture-001",
      app_user_id: 11,
      legacy_user_id: 42,
    },
  ] satisfies BridgeRow[],
};

const registerUsers: RegisterUserRow[] = [
  {
    id: 101,
    cognito_sub: "cognito-sub-fixture-001",
    username: "fixture.cognito.user",
    email: null,
    first_name: null,
    last_name: null,
    phone: null,
    email_verified: false,
    status: "APPROVED",
  },
];

const appUsers: AppUserRow[] = [
  {
    id: 11,
    register_user_id: 101,
    cognito_sub: "cognito-sub-fixture-001",
    username: "fixture.cognito.user",
    first_name: null,
    last_name: null,
    email: null,
    phone: null,
    role_id: null,
    site_id: null,
    corporation_id: null,
    status: true,
    created_at: new Date("2026-01-01T00:00:00Z"),
    updated_at: new Date("2026-01-01T00:00:00Z"),
  },
];

const toBase64Url = (input: string): string =>
  Buffer.from(input, "utf-8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");

const decodePayload = (token: string): Record<string, unknown> => {
  const parts = token.split(".");
  if (parts.length < 2) {
    return {};
  }
  const payloadSegment = parts[1].replace(/-/g, "+").replace(/_/g, "/");
  const padLen = payloadSegment.length % 4;
  const padded = payloadSegment + (padLen ? "=".repeat(4 - padLen) : "");
  return JSON.parse(Buffer.from(padded, "base64").toString("utf-8"));
};

const buildCognitoLikeToken = (payload: Record<string, unknown>): string => {
  const header = { alg: "RS256", typ: "JWT", kid: "ignored-by-mock" };
  return `${toBase64Url(JSON.stringify(header))}.${toBase64Url(JSON.stringify(payload))}.mock-signature`;
};

const txMock = {
  $executeRaw: vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const sql = strings.join(" ");

    if (sql.includes("INSERT INTO user_auth_bridge")) {
      const cognitoSub = String(values[0]);
      let row = FIXTURES.user_auth_bridge.find((item) => item.cognito_sub === cognitoSub);
      if (!row) {
        row = {
          id: BigInt(FIXTURES.user_auth_bridge.length + 1),
          provider: "cognito",
          provider_subject: cognitoSub,
          cognito_sub: cognitoSub,
          app_user_id: null,
          legacy_user_id: null,
        };
        FIXTURES.user_auth_bridge.push(row);
      }
      row.provider_subject = cognitoSub;
      row.cognito_sub = cognitoSub;
      return 1;
    }

    if (sql.includes("UPDATE user_auth_bridge")) {
      const appUserId = Number(values[0]);
      const legacyUserId = Number(values[1]);
      const id = BigInt(String(values[2]));
      const row = FIXTURES.user_auth_bridge.find((item) => item.id === id);
      if (row) {
        row.app_user_id = appUserId;
        row.legacy_user_id = legacyUserId;
      }
      return 1;
    }

    return 1;
  }),
  $queryRaw: vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const sql = strings.join(" ");
    if (sql.includes("FROM user_auth_bridge")) {
      const cognitoSub = String(values[0]);
      const row = FIXTURES.user_auth_bridge.find((item) => item.cognito_sub === cognitoSub);
      if (!row) {
        return [];
      }
      return [
        {
          id: row.id,
          app_user_id: row.app_user_id,
          legacy_user_id: row.legacy_user_id,
        },
      ];
    }
    return [];
  }),
  register_user: {
    findFirst: vi.fn(async ({ where }: any) => {
      const cognitoSub = where?.OR?.[0]?.cognito_sub;
      const username = where?.OR?.[1]?.username;
      return (
        registerUsers.find(
          (user) =>
            (cognitoSub && user.cognito_sub === cognitoSub) ||
            (username && user.username === username),
        ) ?? null
      );
    }),
    findUnique: vi.fn(async ({ where }: any) => {
      if (where?.email) {
        return registerUsers.find((user) => user.email === where.email) ?? null;
      }
      return null;
    }),
    create: vi.fn(async ({ data }: any) => {
      const created: RegisterUserRow = {
        id: registerUsers.length + 1000,
        cognito_sub: data.cognito_sub,
        username: data.username,
        email: data.email ?? null,
        first_name: data.first_name ?? null,
        last_name: data.last_name ?? null,
        phone: data.phone ?? null,
        email_verified: Boolean(data.email_verified),
        status: "APPROVED",
      };
      registerUsers.push(created);
      return created;
    }),
    update: vi.fn(async ({ where, data }: any) => {
      const user = registerUsers.find((item) => item.id === where.id);
      if (!user) {
        return null;
      }
      Object.assign(user, data);
      return user;
    }),
  },
  app_user: {
    findFirst: vi.fn(async ({ where }: any) => {
      const cognitoSub = where?.OR?.[0]?.cognito_sub;
      const registerUserId = where?.OR?.[1]?.register_user_id;
      return (
        appUsers.find(
          (item) =>
            (cognitoSub && item.cognito_sub === cognitoSub) ||
            (registerUserId && item.register_user_id === registerUserId),
        ) ?? null
      );
    }),
    findUnique: vi.fn(async ({ where }: any) => {
      if (where?.username) {
        return appUsers.find((item) => item.username === where.username) ?? null;
      }
      return null;
    }),
    create: vi.fn(async ({ data }: any) => {
      const created: AppUserRow = {
        id: appUsers.length + 1000,
        register_user_id: data.register_user_id,
        cognito_sub: data.cognito_sub,
        username: data.username,
        first_name: data.first_name ?? null,
        last_name: data.last_name ?? null,
        email: data.email ?? null,
        phone: data.phone ?? null,
        role_id: null,
        site_id: null,
        corporation_id: null,
        status: Boolean(data.status),
        created_at: new Date(),
        updated_at: new Date(),
      };
      appUsers.push(created);
      return created;
    }),
    update: vi.fn(async ({ where, data }: any) => {
      const user = appUsers.find((item) => item.id === where.id);
      if (!user) {
        return null;
      }
      Object.assign(user, data, { updated_at: new Date() });
      return user;
    }),
  },
  tbl_users: {
    findFirst: vi.fn(async ({ where }: any) => {
      return (
        FIXTURES.tbl_user.find(
          (user) => user.username === where.username && user.provider === where.provider,
        ) ?? null
      );
    }),
    create: vi.fn(async ({ data }: any) => {
      const created: LegacyUserRow = {
        user_id: FIXTURES.tbl_user.length + 1000,
        username: data.username,
        email: data.email,
        provider: data.provider,
        password: data.password,
        first_name: data.first_name,
        last_name: data.last_name,
        lab_type: data.lab_type,
        dob: data.dob,
        created_date: data.created_date,
        status: Boolean(data.status),
      };
      FIXTURES.tbl_user.push(created);
      return created;
    }),
  },
};

const prismaMock = {
  $transaction: vi.fn(async (callback: (tx: any) => Promise<unknown>) => callback(txMock)),
};

vi.mock("../src/prismaClient", () => ({
  prisma: prismaMock,
  connectDB: vi.fn(),
  disconnectDB: vi.fn(),
}));

vi.mock("aws-jwt-verify", () => ({
  CognitoJwtVerifier: {
    create: vi.fn(() => ({
      verify: vi.fn(async (token: string) => decodePayload(token)),
    })),
  },
}));

describe("token exchange to legacy sites authorization", () => {
  let authApp: Express;
  let legacyApp: Express;
  let authServer: Awaited<ReturnType<Express["listen"]>>;
  const siteLookupUserIds: number[] = [];

  beforeAll(async () => {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
    });

    const privateKeyPem = privateKey.export({ type: "pkcs1", format: "pem" }).toString();
    const publicJwk = publicKey.export({ format: "jwk" }) as Record<string, unknown>;

    process.env.NODE_ENV = "test";
    process.env.DISABLE_AUTH = "false";
    process.env.AWS_DEFAULT_REGION = "ap-south-1";
    process.env.COGNITO_REGION = "ap-south-1";
    process.env.COGNITO_USER_POOL_ID = "ap-south-1_fixturepool";
    process.env.COGNITO_CLIENT_ID = "fixture-client-id";
    process.env.COGNITO_JWT_AUDIENCE = "fixture-client-id";
    process.env.COGNITO_ALLOWED_TOKEN_USE = "access";

    process.env.AUTH_MS_ISSUER = "https://auth-ms.fixture.local";
    process.env.AUTH_MS_AUDIENCE = "purebi-legacy-api";
    process.env.AUTH_MS_JWT_EXPIRES_IN_SEC = "3600";
    process.env.AUTH_MS_JWT_ACTIVE_KID = "fixture-kid-1";
    process.env.AUTH_MS_JWT_KEYS_JSON = JSON.stringify([
      {
        kid: "fixture-kid-1",
        alg: "RS256",
        privateKeyPem,
        publicJwk,
        enabled: true,
      },
    ]);

    const { createApp } = await import("../src/app");
    authApp = createApp();
    authServer = authApp.listen(0);

    await new Promise<void>((resolve) => {
      authServer.once("listening", () => resolve());
    });

    const address = authServer.address();
    const port = typeof address === "object" && address ? address.port : 0;
    const authBaseUrl = `http://127.0.0.1:${port}`;

    process.env.AUTH_MS_JWKS_URL = `${authBaseUrl}/jwks.json`;
    process.env.AUTH_MS_JWKS_CACHE_TTL_SEC = "60";
    process.env.AUTH_MS_JWKS_TIMEOUT_MS = "2000";

    const { verifyAuthMsToken } = await import(
      "../../purebi_main_server/src/middleware/authms.verifier.js"
    );

    legacyApp = express();
    legacyApp.use(express.json());

    legacyApp.get("/sites", async (req, res) => {
      const authorization = String(req.header("Authorization") || "");
      if (!authorization.startsWith("Bearer ")) {
        return res.status(401).json({ status: 0, code: "MISSING_BEARER" });
      }

      try {
        const token = authorization.slice(7);
        const verified = (await verifyAuthMsToken(token)) as {
          legacy_user_id?: number;
        };
        const legacyUserId = Number(verified.legacy_user_id);

        if (!Number.isInteger(legacyUserId) || legacyUserId <= 0) {
          return res.status(401).json({ status: 0, code: "AUTHMS_LEGACY_USER_ID_INVALID" });
        }

        siteLookupUserIds.push(legacyUserId);
        const sites = FIXTURES.tbl_siteuser.filter(
          (row) => row.user_id === legacyUserId && row.status === 1,
        );

        return res.status(200).json({
          status: 1,
          legacy_user_id: legacyUserId,
          sites,
        });
      } catch {
        return res.status(401).json({ status: 0, code: "AUTHMS_VERIFY_FAILED" });
      }
    });
  });

  afterAll(async () => {
    if (authServer) {
      await new Promise<void>((resolve, reject) => {
        authServer.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    }
  });

  it("exchanges Cognito token and queries legacy sites with mapped legacy_user_id", async () => {
    const cognitoToken = buildCognitoLikeToken({
      sub: "cognito-sub-fixture-001",
      username: "fixture.cognito.user",
      token_use: "access",
      client_id: "fixture-client-id",
      iss: "https://cognito-idp.ap-south-1.amazonaws.com/ap-south-1_fixturepool",
      exp: Math.floor(Date.now() / 1000) + 1800,
      iat: Math.floor(Date.now() / 1000) - 10,
    });

    const exchangeResponse = await request(authApp)
      .post("/api/v1/auth/token/exchange")
      .set("Authorization", `Bearer ${cognitoToken}`)
      .send({});

    expect(exchangeResponse.status).toBe(200);
    expect(exchangeResponse.body.token_type).toBe("Bearer");
    expect(typeof exchangeResponse.body.access_token).toBe("string");

    const authMsToken = String(exchangeResponse.body.access_token);

    const legacySitesResponse = await request(legacyApp)
      .get("/sites")
      .set("Authorization", `Bearer ${authMsToken}`);

    expect(legacySitesResponse.status).toBe(200);
    expect(legacySitesResponse.body.status).toBe(1);
    expect(legacySitesResponse.body.legacy_user_id).toBe(42);
    expect(siteLookupUserIds.at(-1)).toBe(42);

    const returnedSiteIds = (legacySitesResponse.body.sites as Array<{ site_id: number }>).map(
      (row) => row.site_id,
    );
    expect(returnedSiteIds).toEqual([7001]);
    expect(returnedSiteIds).not.toContain(9009);

    const bridgeSnapshot = FIXTURES.user_auth_bridge[0];
    expect(bridgeSnapshot.legacy_user_id).toBe(42);
    expect(bridgeSnapshot.app_user_id).toBe(11);
  });
});
