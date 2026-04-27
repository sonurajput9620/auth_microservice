import crypto from "crypto";
import {
  AdminDeleteUserCommand,
  AdminGetUserCommand,
  AdminUpdateUserAttributesCommand,
  AdminInitiateAuthCommand,
  CognitoIdentityProviderClient,
  ConfirmForgotPasswordCommand,
  ConfirmSignUpCommand,
  ForgotPasswordCommand,
  SignUpCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import { StatusCodes } from "http-status-codes";

import { prisma } from "../prismaClient";
import { emailService } from "./email.service";
import { AppError } from "../utils/AppError";
import { Logger } from "../utils/Logger";
import {
  ApproveRegistrationPayload,
  ConfirmForgotPasswordPayload,
  ConfirmSignUpPayload,
  ForgotPasswordPayload,
  ListRegistrationsQuery,
  LoginInitiatePayload,
  LoginResendPayload,
  LoginRespondPayload,
  SignUpPayload,
  UsernameAvailabilityPayload,
} from "../validations/AuthValidation";

const getEnv = (key: string): string => {
  const value = process.env[key];
  if (!value) {
    throw new AppError(
      StatusCodes.INTERNAL_SERVER_ERROR,
      "ConfigError",
      `${key} is not configured.`,
    );
  }
  return value;
};

const COGNITO_CLIENT_ID = getEnv("COGNITO_CLIENT_ID");
const COGNITO_USER_POOL_ID = getEnv("COGNITO_USER_POOL_ID");
const AWS_REGION =
  process.env.AWS_REGION?.trim() ||
  process.env.AWS_DEFAULT_REGION?.trim() ||
  "ap-south-1";
const AWS_ACCOUNT_ID = process.env.AWS_ACCOUNT_ID?.trim() || null;
const cognitoClient = new CognitoIdentityProviderClient({
  region: AWS_REGION,
});
const CUSTOM_EMAIL_CHALLENGE_NAME = "CUSTOM_EMAIL_OTP";
const LEGACY_EMAIL_CHALLENGE_NAME = "EMAIL_OTP";
const getConfiguredCognitoUserPoolArn = (): string =>
  AWS_ACCOUNT_ID
    ? `arn:aws:cognito-idp:${AWS_REGION}:${AWS_ACCOUNT_ID}:userpool/${COGNITO_USER_POOL_ID}`
    : `arn:aws:cognito-idp:${AWS_REGION}:<unknown-account>:userpool/${COGNITO_USER_POOL_ID}`;

const parsePositiveIntegerEnv = (key: string, fallback: number): number => {
  const rawValue = process.env[key]?.trim();
  if (!rawValue) {
    return fallback;
  }

  const parsedValue = Number(rawValue);
  if (!Number.isInteger(parsedValue) || parsedValue <= 0) {
    throw new AppError(
      StatusCodes.INTERNAL_SERVER_ERROR,
      "ConfigError",
      `${key} must be a positive integer.`,
    );
  }

  return parsedValue;
};

const AUTH_OTP_TTL_MINUTES = parsePositiveIntegerEnv("AUTH_OTP_TTL_MINUTES", 5);
const AUTH_OTP_MAX_ATTEMPTS = parsePositiveIntegerEnv("AUTH_OTP_MAX_ATTEMPTS", 3);
const AUTH_OTP_RESEND_COOLDOWN_SECONDS = parsePositiveIntegerEnv(
  "AUTH_OTP_RESEND_COOLDOWN_SECONDS",
  30,
);

const normalizePhone = (phone: string): string => {
  if (phone.startsWith("+")) {
    return phone;
  }
  return `+${phone}`;
};

const getAuthSessionSecret = (): string => {
  const value =
    process.env.AUTH_SESSION_SECRET?.trim() ||
    process.env.LEGACY_JWT_SECRET?.trim();

  if (!value) {
    throw new AppError(
      StatusCodes.INTERNAL_SERVER_ERROR,
      "ConfigError",
      "AUTH_SESSION_SECRET is not configured.",
    );
  }

  return value;
};

const deriveSecretKey = (purpose: string): Buffer =>
  crypto
    .createHash("sha256")
    .update(`${purpose}:${getAuthSessionSecret()}`)
    .digest();

const toPublicTokens = (result?: {
  AccessToken?: string;
  IdToken?: string;
  RefreshToken?: string;
  ExpiresIn?: number;
}): {
  access_token: string;
  id_token: string;
  refresh_token: string | null;
  expires_in: number | null;
} => {
  if (!result?.AccessToken || !result?.IdToken) {
    throw new AppError(
      StatusCodes.UNAUTHORIZED,
      "AuthenticationFailed",
      "Authentication failed. Missing token response from Cognito.",
    );
  }

  return {
    access_token: result.AccessToken,
    id_token: result.IdToken,
    refresh_token: result.RefreshToken ?? null,
    expires_in: result.ExpiresIn ?? null,
  };
};

type PublicTokens = ReturnType<typeof toPublicTokens>;

const buildOtpExpiryDate = (): Date =>
  new Date(Date.now() + AUTH_OTP_TTL_MINUTES * 60 * 1000);

const buildResendAvailableDate = (): Date =>
  new Date(Date.now() + AUTH_OTP_RESEND_COOLDOWN_SECONDS * 1000);

const secondsUntil = (value: Date): number =>
  Math.max(0, Math.ceil((value.getTime() - Date.now()) / 1000));

const generateLoginOtp = (): string =>
  crypto.randomInt(100000, 1000000).toString();

const hashLoginOtp = (challengeId: string, otp: string): string =>
  crypto
    .createHmac("sha256", deriveSecretKey("login-otp"))
    .update(`${challengeId}:${otp}`)
    .digest("hex");

const safeHexEqual = (left: string, right: string): boolean => {
  const leftBuffer = Buffer.from(left, "hex");
  const rightBuffer = Buffer.from(right, "hex");

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
};

const encryptTokenBundle = (tokens: PublicTokens): string => {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(
    "aes-256-gcm",
    deriveSecretKey("login-token-bundle"),
    iv,
  );

  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(tokens), "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return [
    iv.toString("base64"),
    authTag.toString("base64"),
    encrypted.toString("base64"),
  ].join(".");
};

const decryptTokenBundle = (ciphertext: string): PublicTokens => {
  try {
    const [ivPart, tagPart, encryptedPart] = ciphertext.split(".");
    if (!ivPart || !tagPart || !encryptedPart) {
      throw new Error("Malformed token bundle.");
    }

    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      deriveSecretKey("login-token-bundle"),
      Buffer.from(ivPart, "base64"),
    );
    decipher.setAuthTag(Buffer.from(tagPart, "base64"));

    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(encryptedPart, "base64")),
      decipher.final(),
    ]).toString("utf8");

    const parsed = JSON.parse(decrypted) as Partial<PublicTokens>;
    if (!parsed.access_token || !parsed.id_token) {
      throw new Error("Token bundle is incomplete.");
    }

    return {
      access_token: parsed.access_token,
      id_token: parsed.id_token,
      refresh_token: parsed.refresh_token ?? null,
      expires_in: parsed.expires_in ?? null,
    };
  } catch (err: unknown) {
    const error = err instanceof Error ? err : new Error(String(err));

    Logger.error("Failed to decrypt pending login token bundle", error);

    throw new AppError(
      StatusCodes.UNAUTHORIZED,
      "AuthenticationSessionInvalid",
      "Login session is invalid or has expired. Please sign in again.",
    );
  }
};

const isCustomEmailChallenge = (challengeName: string): boolean => {
  const normalized = challengeName.trim().toUpperCase();
  return (
    normalized === CUSTOM_EMAIL_CHALLENGE_NAME ||
    normalized === LEGACY_EMAIL_CHALLENGE_NAME
  );
};

const maskEmail = (email: string): string => {
  const [localPart, domainPart = ""] = email.split("@");
  const maskedLocal =
    localPart.length <= 2
      ? `${localPart[0] ?? "*"}*`
      : `${localPart.slice(0, 2)}${"*".repeat(
          Math.max(2, localPart.length - 2),
        )}`;

  const domainSegments = domainPart.split(".");
  const domainName = domainSegments.shift() ?? "";
  const tld = domainSegments.join(".");
  const maskedDomain =
    domainName.length <= 1
      ? "*"
      : `${domainName[0]}${"*".repeat(Math.max(2, domainName.length - 1))}`;

  return `${maskedLocal}@${maskedDomain}${tld ? `.${tld}` : ""}`;
};

const getCognitoErrorName = (err: unknown): string | undefined =>
  (err as { name?: string })?.name;

const isAwsCredentialsError = (errorName: string | undefined): boolean =>
  errorName === "UnrecognizedClientException" ||
  errorName === "InvalidSignatureException" ||
  errorName === "ExpiredTokenException";

const throwLoginError = (
  errorName: string | undefined,
  errorMessage?: string,
): never => {
  if (errorName === "NotAuthorizedException") {
    throw new AppError(
      StatusCodes.UNAUTHORIZED,
      "InvalidCredentials",
      "Invalid username or password.",
    );
  }

  if (errorName === "UserNotFoundException") {
    throw new AppError(
      StatusCodes.NOT_FOUND,
      "UserNotFound",
      "User not found in Cognito.",
    );
  }

  if (errorName === "PasswordResetRequiredException") {
    throw new AppError(
      StatusCodes.FORBIDDEN,
      "PasswordResetRequired",
      "Password reset is required before login.",
    );
  }

  if (errorName === "UserNotConfirmedException") {
    throw new AppError(
      StatusCodes.FORBIDDEN,
      "UserNotConfirmed",
      "User account is not confirmed.",
    );
  }

  if (isAwsCredentialsError(errorName)) {
    throw new AppError(
      StatusCodes.INTERNAL_SERVER_ERROR,
      "AwsCredentialsInvalid",
      "Backend AWS credentials for Cognito are invalid or expired.",
    );
  }

  if (errorName === "InvalidParameterException") {
    throw new AppError(
      StatusCodes.INTERNAL_SERVER_ERROR,
      "CognitoClientMisconfigured",
      "Cognito app client auth flow is not enabled for this login path.",
    );
  }

  if (errorName === "AccessDeniedException") {
    throw new AppError(
      StatusCodes.INTERNAL_SERVER_ERROR,
      "CognitoAccessDenied",
      "Backend Lambda role is not authorized to access the configured Cognito user pool.",
    );
  }

  if (errorName === "ResourceNotFoundException") {
    throw new AppError(
      StatusCodes.INTERNAL_SERVER_ERROR,
      "CognitoResourceNotFound",
      "Configured Cognito user pool or app client was not found.",
    );
  }

  if (
    errorName === "TooManyRequestsException" ||
    errorName === "TooManyFailedAttemptsException" ||
    errorName === "LimitExceededException"
  ) {
    throw new AppError(
      StatusCodes.TOO_MANY_REQUESTS,
      "TooManyRequests",
      "Too many login attempts. Please try again later.",
    );
  }

  if (
    errorName === "UserLambdaValidationException" ||
    errorName === "UnexpectedLambdaException" ||
    errorName === "InvalidLambdaResponseException"
  ) {
    throw new AppError(
      StatusCodes.BAD_GATEWAY,
      "CognitoTriggerFailed",
      errorMessage || "A Cognito trigger failed while processing login.",
    );
  }

  throw new AppError(
    StatusCodes.UNAUTHORIZED,
    "AuthenticationFailed",
    "Authentication failed.",
  );
};

const throwForgotPasswordError = (err: unknown): never => {
  const errorName = getCognitoErrorName(err);
  const message = err instanceof Error ? err.message : String(err);

  if (errorName === "UserNotFoundException") {
    throw new AppError(
      StatusCodes.NOT_FOUND,
      "UserNotFound",
      "User not found in Cognito.",
    );
  }

  if (errorName === "InvalidParameterException") {
    if (message.includes("no registered/verified email or phone_number")) {
      throw new AppError(
        StatusCodes.BAD_REQUEST,
        "PasswordRecoveryUnavailable",
        "Password reset is unavailable because no verified email or phone number is registered for this user.",
      );
    }

    throw new AppError(
      StatusCodes.BAD_REQUEST,
      "InvalidForgotPasswordRequest",
      message,
    );
  }

  if (errorName === "LimitExceededException") {
    throw new AppError(
      StatusCodes.TOO_MANY_REQUESTS,
      "TooManyRequests",
      "Too many password reset attempts. Please try again later.",
    );
  }

  throw new AppError(
    StatusCodes.BAD_GATEWAY,
    "ForgotPasswordFailed",
    "Failed to initiate forgot password.",
  );
};

const throwConfirmForgotPasswordError = (err: unknown): never => {
  const errorName = getCognitoErrorName(err);
  const message = err instanceof Error ? err.message : String(err);

  if (errorName === "UserNotFoundException") {
    throw new AppError(
      StatusCodes.NOT_FOUND,
      "UserNotFound",
      "User not found in Cognito.",
    );
  }

  if (errorName === "CodeMismatchException") {
    throw new AppError(
      StatusCodes.BAD_REQUEST,
      "InvalidConfirmationCode",
      "Invalid confirmation code. Please check and try again.",
    );
  }

  if (errorName === "ExpiredCodeException") {
    throw new AppError(
      StatusCodes.BAD_REQUEST,
      "ExpiredConfirmationCode",
      "Confirmation code expired. Please request a new code.",
    );
  }

  if (errorName === "InvalidPasswordException") {
    throw new AppError(
      StatusCodes.BAD_REQUEST,
      "InvalidPassword",
      message,
    );
  }

  throw new AppError(
    StatusCodes.BAD_GATEWAY,
    "ConfirmForgotPasswordFailed",
    "Failed to confirm forgot password.",
  );
};

const isRecoverablePendingRegistration = (
  registration:
    | {
        email_verified: boolean;
        status: string;
        app_user?: { id: number } | null;
      }
    | null
    | undefined,
): boolean =>
  !!registration &&
  registration.email_verified === false &&
  registration.status === "PENDING_APPROVAL" &&
  !registration.app_user;

type LoginSite = {
  site_id: number;
  site_name: string | null;
  sitepfd: string | null;
  apikey: string | null;
  assistantid: string | null;
  threadid: string | null;
  site_description: string | null;
  corporation_id?: number | null;
  agent_id?: number | null;
  source_name?: string | null;
  changePassword?: number | null;
};

type LoginUser = {
  id: number;
  username: string;
  email?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  phone?: string | null;
  role_id?: number | null;
  role_name?: string | null;
  site_id?: number | null;
  corporation_id?: number | null;
  status: boolean;
  permissions: string[];
  allsites: LoginSite[];
};

type RegistrationListItem = {
  registration_id: number;
  username: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  status: "PENDING_APPROVAL" | "APPROVED" | "REJECTED";
  email_verified: boolean;
  review_note: string | null;
  reviewed_by: number | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
  app_user_id: number | null;
  app_user_status: boolean | null;
  role_id: string | null;
  role_name: string | null;
  site_id: number | null;
  site_name: string | null;
  corporation_id: number | null;
  corporation_name: string | null;
};

type LoginChallengeResponse = {
  challenge_required: true;
  challenge_name: typeof CUSTOM_EMAIL_CHALLENGE_NAME;
  session: string;
  delivery_medium: "EMAIL";
  destination: string;
  expires_at: string;
  resend_available_at: string;
  user: LoginUser | null;
};

export class AuthService {
  private static async deleteCognitoUser(
    username: string,
    operation: "DeleteRegistration" | "SignUp" = "DeleteRegistration",
  ): Promise<void> {
    try {
      await cognitoClient.send(
        new AdminDeleteUserCommand({
          UserPoolId: COGNITO_USER_POOL_ID,
          Username: username,
        }),
      );
    } catch (err: unknown) {
      const errorName = getCognitoErrorName(err);
      if (errorName === "UserNotFoundException") {
        Logger.warn(`${operation}: Cognito user not found during delete`, {
          username,
        });
        return;
      }

      if (isAwsCredentialsError(errorName)) {
        throw new AppError(
          StatusCodes.INTERNAL_SERVER_ERROR,
          "AwsCredentialsInvalid",
          "Backend AWS credentials for Cognito are invalid or expired.",
        );
      }

      if (errorName === "AccessDeniedException") {
        Logger.error(
          `${operation}: Cognito access denied`,
          err instanceof Error ? err : new Error(String(err)),
          {
            username,
            cognito_user_pool_id: COGNITO_USER_POOL_ID,
            cognito_user_pool_arn: getConfiguredCognitoUserPoolArn(),
            aws_region: AWS_REGION,
            aws_account_id: AWS_ACCOUNT_ID,
          },
        );
        throw new AppError(
          StatusCodes.INTERNAL_SERVER_ERROR,
          "CognitoAccessDenied",
          "Backend Lambda role is not authorized to access the configured Cognito user pool.",
        );
      }

      if (errorName === "ResourceNotFoundException") {
        throw new AppError(
          StatusCodes.INTERNAL_SERVER_ERROR,
          "CognitoResourceNotFound",
          "Configured Cognito user pool was not found.",
        );
      }

      const error = err instanceof Error ? err : new Error(String(err));
      Logger.error(`${operation}: Failed to delete Cognito user`, error, {
        username,
        error_name: errorName,
      });

      throw new AppError(
        StatusCodes.BAD_GATEWAY,
        "CognitoDeleteFailed",
        "Failed to delete user from Cognito.",
      );
    }
  }

  private static async mapRoleNamesByIds(roleIds: number[]): Promise<Map<number, string>> {
    const uniqueRoleIds = Array.from(new Set(roleIds));
    if (uniqueRoleIds.length === 0) {
      return new Map<number, string>();
    }

    const roles = await prisma.roles.findMany({
      where: {
        id: { in: uniqueRoleIds },
        is_deleted: false,
      },
      select: {
        id: true,
        role_name: true,
      },
    });

    return new Map(roles.map((role) => [role.id, role.role_name]));
  }

  private static async mapCorporationNamesByIds(
    corporationIds: number[],
  ): Promise<Map<number, string>> {
    const uniqueCorporationIds = Array.from(new Set(corporationIds));
    if (uniqueCorporationIds.length === 0) {
      return new Map<number, string>();
    }

    const corporations = await prisma.tbl_corporation.findMany({
      where: {
        corporation_id: { in: uniqueCorporationIds },
      },
      select: {
        corporation_id: true,
        corporation_name: true,
      },
    });

    return new Map(
      corporations.map((corporation) => [
        corporation.corporation_id,
        corporation.corporation_name ?? `Corporation ${corporation.corporation_id}`,
      ]),
    );
  }

  private static async mapSitesByIds(siteIds: number[]): Promise<Map<number, LoginSite>> {
    const uniqueSiteIds = Array.from(new Set(siteIds));
    if (uniqueSiteIds.length === 0) {
      return new Map<number, LoginSite>();
    }

    const sites = await prisma.tbl_site.findMany({
      where: {
        site_id: { in: uniqueSiteIds },
      },
      select: {
        site_id: true,
        site_name: true,
        sitepfd: true,
        apikey: true,
        assistantid: true,
        threadid: true,
        site_description: true,
      },
    });

    return new Map(
      sites.map((site) => [
        site.site_id,
        {
          site_id: site.site_id,
          site_name: site.site_name ?? null,
          sitepfd: site.sitepfd ?? null,
          apikey: site.apikey ?? null,
          assistantid: site.assistantid ?? null,
          threadid: site.threadid ?? null,
          site_description: site.site_description ?? null,
        },
      ]),
    );
  }

  private static async resolveUserSites(
    appAssignedSiteId: number | null,
    legacyUserId: number | null,
    legacyRoleId: number | null,
    existingCorporationId: number | null,
  ): Promise<{ allsites: LoginSite[]; corporationId: number | null }> {
    let corporationId = existingCorporationId ?? null;

    // New auth service assignment model: single site_id on app_user.
    if (appAssignedSiteId) {
      const siteMap = await this.mapSitesByIds([appAssignedSiteId]);
      const assignedSite = siteMap.get(appAssignedSiteId);
      return {
        allsites: assignedSite ? [assignedSite] : [],
        corporationId,
      };
    }

    // Legacy fallback path when app_user.site_id is empty.
    if (!legacyRoleId) {
      return { allsites: [], corporationId };
    }

    if (legacyRoleId === 1) {
      const corpSites = await prisma.tbl_corporation_site.findMany({
        where: { status: true, site_id: { not: null } },
        select: {
          corporation_id: true,
          site_id: true,
        },
        orderBy: { site_id: "asc" },
      });

      const siteIds = corpSites
        .map((item) => item.site_id)
        .filter((siteId): siteId is number => siteId !== null);

      const siteMap = await this.mapSitesByIds(siteIds);
      const allsites = corpSites.flatMap((item) => {
        if (!item.site_id) {
          return [];
        }
        const site = siteMap.get(item.site_id);
        if (!site) {
          return [];
        }

        return [{ ...site, corporation_id: item.corporation_id ?? null }];
      });

      return { allsites, corporationId };
    }

    if (legacyRoleId === 6 || legacyRoleId === 14) {
      if (!legacyUserId) {
        return { allsites: [], corporationId };
      }

      const corpAdmin = await prisma.tbl_corporation_admin.findFirst({
        where: {
          user_id: legacyUserId,
          status: true,
        },
        select: {
          corporation_id: true,
        },
      });

      corporationId = corpAdmin?.corporation_id ?? null;
      if (!corporationId) {
        return { allsites: [], corporationId };
      }

      const corpSites = await prisma.tbl_corporation_site.findMany({
        where: {
          corporation_id: corporationId,
          status: true,
          site_id: { not: null },
        },
        select: {
          site_id: true,
        },
        orderBy: { site_id: "asc" },
      });

      const siteIds = corpSites
        .map((item) => item.site_id)
        .filter((siteId): siteId is number => siteId !== null);

      const siteMap = await this.mapSitesByIds(siteIds);
      const allsites = siteIds.flatMap((siteId) => {
        const site = siteMap.get(siteId);
        if (!site) {
          return [];
        }

        return [{ ...site, corporation_id: corporationId }];
      });

      return { allsites, corporationId };
    }

    if (legacyRoleId === 10) {
      if (!legacyUserId) {
        return { allsites: [], corporationId };
      }

      const agentUserSites = await prisma.tbl_site_agentuser.findMany({
        where: {
          user_id: legacyUserId,
          status: 1,
        },
        select: {
          site_id: true,
          agent_id: true,
          chgPwd: true,
        },
        orderBy: { site_id: "asc" },
      });

      if (agentUserSites.length === 0) {
        return { allsites: [], corporationId };
      }

      const activeAgents = await prisma.tbl_site_lab_agent.findMany({
        where: {
          id: { in: agentUserSites.map((item) => item.agent_id) },
          status: true,
        },
        select: {
          id: true,
          source_name: true,
        },
      });

      const activeAgentMap = new Map(
        activeAgents.map((agent) => [agent.id, agent.source_name]),
      );

      const filteredSites = agentUserSites.filter((item) =>
        activeAgentMap.has(item.agent_id),
      );
      const siteMap = await this.mapSitesByIds(filteredSites.map((item) => item.site_id));

      const allsites = filteredSites.flatMap((item) => {
        const site = siteMap.get(item.site_id);
        if (!site) {
          return [];
        }

        return [
          {
            ...site,
            agent_id: item.agent_id,
            changePassword: item.chgPwd,
            source_name: activeAgentMap.get(item.agent_id) ?? null,
          },
        ];
      });

      return { allsites, corporationId };
    }

    const userSites = await prisma.tbl_siteuser.findMany({
      where: {
        user_id: legacyUserId ?? -1,
      },
      select: {
        site_id: true,
      },
      orderBy: { site_id: "asc" },
    });

    const siteIds = userSites
      .map((item) => item.site_id)
      .filter((siteId): siteId is number => siteId !== null);
    const siteMap = await this.mapSitesByIds(siteIds);
    const allsites = siteIds.flatMap((siteId) => {
      const site = siteMap.get(siteId);
      if (!site) {
        return [];
      }

      return [site];
    });

    return { allsites, corporationId };
  }

  private static async getLoginUser(username: string): Promise<LoginUser | null> {
    const user = await prisma.app_user.findUnique({
      where: { username },
      select: {
        id: true,
        username: true,
        email: true,
        first_name: true,
        last_name: true,
        phone: true,
        role_id: true,
        site_id: true,
        corporation_id: true,
        status: true,
      },
    });

    if (!user) {
      return null;
    }

    const [legacyUser, role] = await Promise.all([
      prisma.tbl_users.findFirst({
        where: {
          username,
          status: true,
        },
        select: {
          user_id: true,
          user_role: true,
        },
      }),
      user.role_id
        ? prisma.roles.findFirst({
            where: {
              id: user.role_id,
              is_deleted: false,
            },
            select: {
              role_name: true,
              role_sub_feature_permissions: {
                where: {
                  is_enabled: true,
                  permission_sub_features: {
                    is_active: true,
                    permission_features: {
                      is_active: true,
                    },
                  },
                },
                select: {
                  permission_sub_features: {
                    select: {
                      sub_feature_key: true,
                    },
                  },
                },
              },
            },
          })
        : Promise.resolve(null),
    ]);

    const { allsites, corporationId } = await this.resolveUserSites(
      user.site_id ?? null,
      legacyUser?.user_id ?? null,
      legacyUser?.user_role ?? null,
      user.corporation_id ?? null,
    );

    const permissions = Array.from(
      new Set(
        (role?.role_sub_feature_permissions ?? []).map(
          (permission) => permission.permission_sub_features.sub_feature_key,
        ),
      ),
    ).sort((left, right) => left.localeCompare(right));

    return {
      ...user,
      role_name: role?.role_name ?? null,
      site_id: allsites[0]?.site_id ?? user.site_id ?? null,
      corporation_id: corporationId ?? user.corporation_id ?? null,
      permissions,
      allsites,
    };
  }

  private static async resolveLoginEmail(user: LoginUser): Promise<string> {
    const databaseEmail = user.email?.trim();
    if (databaseEmail) {
      return databaseEmail;
    }

    try {
      const cognitoUser = await cognitoClient.send(
        new AdminGetUserCommand({
          UserPoolId: COGNITO_USER_POOL_ID,
          Username: user.username,
        }),
      );

      const cognitoEmail = cognitoUser.UserAttributes?.find(
        (attribute) => attribute.Name === "email",
      )?.Value?.trim();

      if (cognitoEmail) {
        return cognitoEmail;
      }
    } catch (err: unknown) {
      const error = err instanceof Error ? err : new Error(String(err));

      Logger.error("Failed to resolve login email from Cognito", error, {
        username: user.username,
      });
    }

    throw new AppError(
      StatusCodes.BAD_REQUEST,
      "EmailOtpUnavailable",
      "Login OTP is unavailable because no email address is registered for this user.",
    );
  }

  private static buildLoginChallengeResponse(
    session: string,
    email: string,
    otpExpiresAt: Date,
    resendAvailableAt: Date,
    user: LoginUser | null,
  ): LoginChallengeResponse {
    return {
      challenge_required: true,
      challenge_name: CUSTOM_EMAIL_CHALLENGE_NAME,
      session,
      delivery_medium: "EMAIL",
      destination: maskEmail(email),
      expires_at: otpExpiresAt.toISOString(),
      resend_available_at: resendAvailableAt.toISOString(),
      user,
    };
  }

  private static async finalizeLoginChallenge(
    id: number,
    status: "VERIFIED" | "FAILED" | "EXPIRED",
  ): Promise<void> {
    await prisma.login_otp_challenge.update({
      where: { id },
      data: {
        challenge_status: status,
        consumed_at: new Date(),
        otp_hash: null,
        token_bundle_ciphertext: null,
      },
    });
  }

  private static async createLoginOtpChallenge(
    user: LoginUser,
    email: string,
    tokens: PublicTokens,
  ): Promise<LoginChallengeResponse> {
    const challengeId = crypto.randomUUID();
    const otp = generateLoginOtp();
    const otpExpiresAt = buildOtpExpiryDate();
    const resendAvailableAt = buildResendAvailableDate();

    const challenge = await prisma.login_otp_challenge.create({
      data: {
        challenge_id: challengeId,
        username: user.username,
        email,
        app_user_id: user.id,
        otp_hash: hashLoginOtp(challengeId, otp),
        otp_expires_at: otpExpiresAt,
        max_attempts: AUTH_OTP_MAX_ATTEMPTS,
        resend_available_at: resendAvailableAt,
        last_sent_at: new Date(),
        token_bundle_ciphertext: encryptTokenBundle(tokens),
      },
    });

    try {
      await emailService.sendLoginOtp({
        to: email,
        username: user.first_name?.trim() || user.username,
        otp,
        expiresInMinutes: AUTH_OTP_TTL_MINUTES,
      });
    } catch (err: unknown) {
      const error = err instanceof Error ? err : new Error(String(err));

      Logger.error("Failed to send login OTP email", error, {
        username: user.username,
        challenge_id: challengeId,
      });

      await this.finalizeLoginChallenge(challenge.id, "FAILED");
      throw err;
    }

    return this.buildLoginChallengeResponse(
      challengeId,
      email,
      otpExpiresAt,
      resendAvailableAt,
      user,
    );
  }

  private static async getLoginChallengeForUser(
    username: string,
    session: string,
  ) {
    const challenge = await prisma.login_otp_challenge.findUnique({
      where: { challenge_id: session },
    });

    if (!challenge || challenge.username !== username) {
      throw new AppError(
        StatusCodes.UNAUTHORIZED,
        "AuthenticationSessionInvalid",
        "Login session is invalid or has expired. Please sign in again.",
      );
    }

    if (challenge.challenge_status !== "PENDING") {
      throw new AppError(
        StatusCodes.UNAUTHORIZED,
        "AuthenticationSessionClosed",
        "Login session is no longer active. Please sign in again.",
      );
    }

    if (challenge.otp_expires_at.getTime() <= Date.now()) {
      await this.finalizeLoginChallenge(challenge.id, "EXPIRED");
      throw new AppError(
        StatusCodes.UNAUTHORIZED,
        "OtpExpired",
        "Login OTP expired. Please sign in again.",
      );
    }

    return challenge;
  }

  public static async checkUsernameAvailability(
    payload: UsernameAvailabilityPayload
  ): Promise<{
    username: string;
    available: boolean;
    source: "database" | "cognito";
    recoverable: boolean;
  }> {
    const username = payload.username.trim();

    const [existingAppUser, existingRegistration] = await Promise.all([
      prisma.app_user.findUnique({
        where: { username },
        select: { id: true },
      }),
      prisma.register_user.findUnique({
        where: { username },
        select: {
          id: true,
          email_verified: true,
          status: true,
          app_user: {
            select: {
              id: true,
            },
          },
        },
      }),
    ]);

    if (existingAppUser) {
      return {
        username,
        available: false,
        source: "database",
        recoverable: false,
      };
    }

    const recoverableRegistration = isRecoverablePendingRegistration(existingRegistration);

    if (existingRegistration && !recoverableRegistration) {
      return {
        username,
        available: false,
        source: "database",
        recoverable: false,
      };
    }

    try {
      const cognitoUser = await cognitoClient.send(
        new AdminGetUserCommand({
          UserPoolId: COGNITO_USER_POOL_ID,
          Username: username,
        })
      );

      if (cognitoUser.UserStatus?.toUpperCase() === "UNCONFIRMED") {
        return {
          username,
          available: true,
          source: "cognito",
          recoverable: true,
        };
      }

      return {
        username,
        available: false,
        source: "cognito",
        recoverable: false,
      };
    } catch (err: unknown) {
      const errorName = getCognitoErrorName(err);
      if (errorName === "UserNotFoundException") {
        return {
          username,
          available: true,
          source: "cognito",
          recoverable: recoverableRegistration,
        };
      }

      const error = err instanceof Error ? err : new Error(String(err));
      Logger.error("Username availability check failed", error, {
        username,
        error_name: errorName,
      });

      throw new AppError(
        StatusCodes.BAD_GATEWAY,
        "UsernameAvailabilityFailed",
        "Unable to check username availability right now."
      );
    }
  }

  public static async signUp(payload: SignUpPayload): Promise<{
    username: string;
    user_sub: string;
    code_delivery?: unknown;
  }> {
    try {
      const fullName = `${payload.first_name} ${payload.last_name}`.trim();
      const normalizedPhone = normalizePhone(payload.phone);
      const createCognitoUser = () =>
        cognitoClient.send(
          new SignUpCommand({
            ClientId: COGNITO_CLIENT_ID,
            Username: payload.username,
            Password: payload.password,
            UserAttributes: [
              { Name: "email", Value: payload.email },
              { Name: "given_name", Value: payload.first_name },
              { Name: "family_name", Value: payload.last_name },
              { Name: "preferred_username", Value: payload.username },
              { Name: "name", Value: fullName || payload.username },
              { Name: "phone_number", Value: normalizedPhone },
            ],
          }),
        );

      Logger.debug("SignUp: Creating user in Cognito", {
        username: payload.username,
        email: payload.email,
      });

      let response;
      try {
        response = await createCognitoUser();
      } catch (err: unknown) {
        const errorName = getCognitoErrorName(err);

        if (errorName !== "UsernameExistsException") {
          throw err;
        }

        const cognitoUser = await cognitoClient.send(
          new AdminGetUserCommand({
            UserPoolId: COGNITO_USER_POOL_ID,
            Username: payload.username,
          }),
        );

        if (cognitoUser.UserStatus?.toUpperCase() !== "UNCONFIRMED") {
          throw new AppError(
            StatusCodes.CONFLICT,
            "UsernameAlreadyExists",
            "Username is already taken.",
          );
        }

        Logger.info("SignUp: Recreating unconfirmed Cognito user", {
          username: payload.username,
        });

        await this.deleteCognitoUser(payload.username, "SignUp");
        response = await createCognitoUser();
      }

      Logger.info("SignUp: User created successfully in Cognito", {
        username: payload.username,
        user_sub: response.UserSub,
      });

      const [existingRegistrationByUsername, existingRegistrationByEmail] = await Promise.all([
        prisma.register_user.findUnique({
          where: { username: payload.username },
          include: {
            app_user: {
              select: {
                id: true,
              },
            },
          },
        }),
        prisma.register_user.findUnique({
          where: { email: payload.email },
          include: {
            app_user: {
              select: {
                id: true,
              },
            },
          },
        }),
      ]);

      const reusableRegistration =
        isRecoverablePendingRegistration(existingRegistrationByUsername)
          ? existingRegistrationByUsername
          : isRecoverablePendingRegistration(existingRegistrationByEmail)
            ? existingRegistrationByEmail
            : null;

      if (reusableRegistration) {
        await prisma.register_user.update({
          where: { id: reusableRegistration.id },
          data: {
            first_name: payload.first_name,
            last_name: payload.last_name,
            email: payload.email,
            username: payload.username,
            phone: normalizedPhone,
          },
        });
      } else {
        await prisma.register_user.create({
          data: {
            username: payload.username,
            first_name: payload.first_name,
            last_name: payload.last_name,
            email: payload.email,
            phone: normalizedPhone,
            email_verified: false,
            status: "PENDING_APPROVAL",
          },
        });
      }

      return {
        username: payload.username,
        user_sub: response.UserSub ?? "",
        code_delivery: response.CodeDeliveryDetails,
      };
    } catch (err: unknown) {
      const error = err instanceof Error ? err : new Error(String(err));
      Logger.error("SignUp: Failed to create user in Cognito", error, {
        username: payload.username,
      });
      throw error;
    }
  }

  public static async confirmSignUp(payload: ConfirmSignUpPayload): Promise<{
    registration_id: number;
    status: string;
  }> {
    try {
      Logger.debug("ConfirmSignUp: Confirming user email", {
        username: payload.username,
      });

      try {
        await cognitoClient.send(
          new ConfirmSignUpCommand({
            ClientId: COGNITO_CLIENT_ID,
            Username: payload.username,
            ConfirmationCode: payload.confirmation_code,
          }),
        );
      } catch (err: unknown) {
        const error = err instanceof Error ? err : new Error(String(err));
        const errorName = getCognitoErrorName(err);
        const message = error.message.toLowerCase();

        if (errorName === "ExpiredCodeException") {
          throw new AppError(
            StatusCodes.BAD_REQUEST,
            "ExpiredConfirmationCode",
            "Confirmation code expired. Please request a new code.",
          );
        }

        if (errorName === "CodeMismatchException") {
          throw new AppError(
            StatusCodes.BAD_REQUEST,
            "InvalidConfirmationCode",
            "Invalid confirmation code. Please check and try again.",
          );
        }

        if (errorName === "UserNotFoundException") {
          throw new AppError(
            StatusCodes.NOT_FOUND,
            "UserNotFound",
            "User not found in Cognito.",
          );
        }

        if (isAwsCredentialsError(errorName)) {
          throw new AppError(
            StatusCodes.INTERNAL_SERVER_ERROR,
            "AwsCredentialsInvalid",
            "Backend AWS credentials for Cognito are invalid or expired.",
          );
        }

        const alreadyConfirmed =
          errorName === "NotAuthorizedException" &&
          (message.includes("current status is confirmed") ||
            message.includes("cannot confirm already confirmed user"));

        if (!alreadyConfirmed) {
          if (errorName === "NotAuthorizedException") {
            throw new AppError(
              StatusCodes.FORBIDDEN,
              "UserNotAuthorized",
              "User is not authorized to confirm sign up.",
            );
          }

          throw error;
        }

        Logger.info("ConfirmSignUp: User already confirmed in Cognito, continuing registration sync", {
          username: payload.username,
        });
      }

      // ConfirmSignUp verifies the sign-up code but does not reliably set the
      // recovery attribute as verified for this username-based pool setup.
      try {
        await cognitoClient.send(
          new AdminUpdateUserAttributesCommand({
            UserPoolId: COGNITO_USER_POOL_ID,
            Username: payload.username,
            UserAttributes: [{ Name: "email_verified", Value: "true" }],
          }),
        );
      } catch (err: unknown) {
        const errorName = getCognitoErrorName(err);

        if (isAwsCredentialsError(errorName)) {
          throw new AppError(
            StatusCodes.INTERNAL_SERVER_ERROR,
            "AwsCredentialsInvalid",
            "Backend AWS credentials for Cognito are invalid or expired.",
          );
        }

        throw err;
      }

      Logger.info("ConfirmSignUp: Email confirmed", {
        username: payload.username,
      });

      const existing = await prisma.register_user.findUnique({
        where: { username: payload.username },
      });

      if (existing) {
        Logger.debug("ConfirmSignUp: Updating existing registration", {
          registration_id: existing.id,
        });

        const updated = await prisma.register_user.update({
          where: { id: existing.id },
          data: {
            email_verified: true,
          },
        });

        Logger.info("ConfirmSignUp: Registration updated", {
          registration_id: updated.id,
          status: updated.status,
        });

        return {
          registration_id: updated.id,
          status: updated.status,
        };
      }

      Logger.debug("ConfirmSignUp: Creating new registration", {
        username: payload.username,
      });

      const created = await prisma.register_user.create({
        data: {
          username: payload.username,
          email_verified: true,
          status: "PENDING_APPROVAL",
        },
      });

      Logger.info("ConfirmSignUp: Registration created", {
        registration_id: created.id,
        status: created.status,
      });

      return {
        registration_id: created.id,
        status: created.status,
      };
    } catch (err: unknown) {
      const error = err instanceof Error ? err : new Error(String(err));
      const errorName = (err as { name?: string }).name;

      Logger.error("ConfirmSignUp: Failed to confirm sign up", error, {
        username: payload.username,
        error_name: errorName,
      });

      if (errorName === "ExpiredCodeException") {
        throw new AppError(
          StatusCodes.BAD_REQUEST,
          "ExpiredConfirmationCode",
          "Confirmation code expired. Please request a new code.",
        );
      }

      if (errorName === "CodeMismatchException") {
        throw new AppError(
          StatusCodes.BAD_REQUEST,
          "InvalidConfirmationCode",
          "Invalid confirmation code. Please check and try again.",
        );
      }

      if (errorName === "UserNotFoundException") {
        throw new AppError(
          StatusCodes.NOT_FOUND,
          "UserNotFound",
          "User not found in Cognito.",
        );
      }

      if (isAwsCredentialsError(errorName)) {
        throw new AppError(
          StatusCodes.INTERNAL_SERVER_ERROR,
          "AwsCredentialsInvalid",
          "Backend AWS credentials for Cognito are invalid or expired.",
        );
      }

      if (errorName === "NotAuthorizedException") {
        throw new AppError(
          StatusCodes.FORBIDDEN,
          "UserNotAuthorized",
          "User is not authorized to confirm sign up.",
        );
      }

      throw error;
    }
  }

  public static async reviewRegistration(
    registrationId: number,
    payload: ApproveRegistrationPayload,
  ): Promise<{ registration_status: string; app_user_id?: number }> {
    try {
      Logger.debug("ReviewRegistration: Fetching registration", {
        registration_id: registrationId,
      });

      const registration = await prisma.register_user.findUnique({
        where: { id: registrationId },
      });

      if (!registration) {
        Logger.warn("ReviewRegistration: Registration not found", {
          registration_id: registrationId,
        });

        throw new AppError(
          StatusCodes.NOT_FOUND,
          "RegistrationNotFound",
          "Registration request not found.",
        );
      }

      if (registration.status !== "PENDING_APPROVAL") {
        Logger.warn("ReviewRegistration: Invalid registration state", {
          registration_id: registrationId,
          current_status: registration.status,
        });

        throw new AppError(
          StatusCodes.BAD_REQUEST,
          "InvalidRegistrationState",
          "Only pending registrations can be reviewed.",
        );
      }

      if (payload.action === "REJECT") {
        Logger.info("ReviewRegistration: Rejecting registration", {
          registration_id: registrationId,
          reviewed_by: payload.approved_by,
        });

        const rejected = await prisma.register_user.update({
          where: { id: registrationId },
          data: {
            status: "REJECTED",
            reviewed_by: payload.approved_by,
            reviewed_at: new Date(),
            review_note: payload.review_note,
          },
        });

        return {
          registration_status: rejected.status,
        };
      }

      Logger.info("ReviewRegistration: Approving registration", {
        registration_id: registrationId,
        reviewed_by: payload.approved_by,
      });

      let resolvedRoleId: number | null = null;
      if (typeof payload.role_id === "number") {
        resolvedRoleId = payload.role_id;
      } else if (typeof payload.role_id === "string") {
        if (/^\d+$/.test(payload.role_id)) {
          resolvedRoleId = Number(payload.role_id);
        } else {
          const mappedRole = await prisma.roles.findFirst({
            where: {
              role_uid: payload.role_id,
              is_deleted: false,
            },
            select: {
              id: true,
            },
          });

          if (!mappedRole) {
            throw new AppError(
              StatusCodes.BAD_REQUEST,
              "InvalidRole",
              "Selected role was not found.",
            );
          }

          resolvedRoleId = mappedRole.id;
        }
      }

      if (!resolvedRoleId) {
        throw new AppError(
          StatusCodes.BAD_REQUEST,
          "InvalidRole",
          "role_id is required for APPROVE.",
        );
      }

      const appUser = await prisma.$transaction(async (tx) => {
        const updatedRegistration = await tx.register_user.update({
          where: { id: registrationId },
          data: {
            status: "APPROVED",
            reviewed_by: payload.approved_by,
            reviewed_at: new Date(),
            review_note: payload.review_note,
          },
        });

        return tx.app_user.create({
          data: {
            register_user_id: updatedRegistration.id,
            username: updatedRegistration.username,
            email: updatedRegistration.email,
            phone: updatedRegistration.phone,
            first_name: updatedRegistration.first_name,
            last_name: updatedRegistration.last_name,
            role_id: resolvedRoleId,
            site_id: payload.site_id,
            corporation_id: payload.corporation_id,
            status: true,
          },
        });
      });

      Logger.info("ReviewRegistration: User approved and app_user created", {
        registration_id: registrationId,
        app_user_id: appUser.id,
      });

      return {
        registration_status: "APPROVED",
        app_user_id: appUser.id,
      };
    } catch (err: unknown) {
      const error = err instanceof Error ? err : new Error(String(err));
      Logger.error("ReviewRegistration: Failed to review registration", error, {
        registration_id: registrationId,
        action: payload.action,
      });
      throw error;
    }
  }

  public static async listRegistrations(
    query: ListRegistrationsQuery,
  ): Promise<RegistrationListItem[]> {
    const registrations = await prisma.register_user.findMany({
      where: {
        email_verified: true,
        ...(query.status
          ? {
              status: query.status,
            }
          : {}),
      },
      include: {
        app_user: {
          select: {
            id: true,
            role_id: true,
            site_id: true,
            corporation_id: true,
            status: true,
          },
        },
      },
      orderBy: [{ created_at: "desc" }],
    });

    const roleIds = registrations
      .map((item) => item.app_user?.role_id)
      .filter((roleId): roleId is number => typeof roleId === "number");
    const siteIds = registrations
      .map((item) => item.app_user?.site_id)
      .filter((siteId): siteId is number => typeof siteId === "number");
    const corporationIds = registrations
      .map((item) => item.app_user?.corporation_id)
      .filter((corporationId): corporationId is number => typeof corporationId === "number");

    const [roleMap, siteMap, corporationMap] = await Promise.all([
      this.mapRoleNamesByIds(roleIds),
      this.mapSitesByIds(siteIds),
      this.mapCorporationNamesByIds(corporationIds),
    ]);

    return registrations.map((registration) => ({
      registration_id: registration.id,
      username: registration.username,
      first_name: registration.first_name ?? null,
      last_name: registration.last_name ?? null,
      email: registration.email ?? null,
      phone: registration.phone ?? null,
      status: registration.status,
      email_verified: registration.email_verified,
      review_note: registration.review_note ?? null,
      reviewed_by: registration.reviewed_by ?? null,
      reviewed_at: registration.reviewed_at?.toISOString() ?? null,
      created_at: registration.created_at.toISOString(),
      updated_at: registration.updated_at.toISOString(),
      app_user_id: registration.app_user?.id ?? null,
      app_user_status: registration.app_user?.status ?? null,
      role_id:
        typeof registration.app_user?.role_id === "number"
          ? String(registration.app_user.role_id)
          : null,
      role_name:
        typeof registration.app_user?.role_id === "number"
          ? roleMap.get(registration.app_user.role_id) ?? null
          : null,
      site_id: registration.app_user?.site_id ?? null,
      site_name:
        typeof registration.app_user?.site_id === "number"
          ? siteMap.get(registration.app_user.site_id)?.site_name ?? null
          : null,
      corporation_id: registration.app_user?.corporation_id ?? null,
      corporation_name:
        typeof registration.app_user?.corporation_id === "number"
          ? corporationMap.get(registration.app_user.corporation_id) ?? null
          : null,
    }));
  }

  public static async deleteRegistration(
    registrationId: number,
  ): Promise<{ registration_id: number; deleted_app_user_id: number | null }> {
    const registration = await prisma.register_user.findUnique({
      where: { id: registrationId },
      include: {
        app_user: {
          select: {
            id: true,
            status: true,
          },
        },
      },
    });

    if (!registration) {
      throw new AppError(
        StatusCodes.NOT_FOUND,
        "RegistrationNotFound",
        "Registration request not found.",
      );
    }

    const canDeleteRejectedUser = registration.status === "REJECTED";
    const canDeleteDisabledApprovedUser =
      registration.status === "APPROVED" && registration.app_user?.status === false;

    if (!canDeleteRejectedUser && !canDeleteDisabledApprovedUser) {
      throw new AppError(
        StatusCodes.BAD_REQUEST,
        "DeletionNotAllowed",
        "Only rejected users or disabled approved users can be deleted.",
      );
    }

    await this.deleteCognitoUser(registration.username);

    await prisma.$transaction(async (tx) => {
      if (registration.app_user?.id) {
        await tx.app_user.delete({
          where: {
            id: registration.app_user.id,
          },
        });
      }

      await tx.register_user.delete({
        where: {
          id: registration.id,
        },
      });
    });

    Logger.info("DeleteRegistration: User deleted from register_user, app_user and Cognito", {
      registration_id: registrationId,
      username: registration.username,
      registration_status: registration.status,
      deleted_app_user_id: registration.app_user?.id ?? null,
    });

    return {
      registration_id: registrationId,
      deleted_app_user_id: registration.app_user?.id ?? null,
    };
  }

  public static async initiateLogin(payload: LoginInitiatePayload): Promise<
    | {
        challenge_required: false;
        tokens: ReturnType<typeof toPublicTokens>;
        user: LoginUser | null;
      }
    | LoginChallengeResponse
  > {
    try {
      Logger.debug("InitiateLogin: Checking user status", {
        username: payload.username,
      });

      const user = await this.getLoginUser(payload.username);

      if (!user || user.status !== true) {
        Logger.warn("InitiateLogin: User not approved or not active", {
          username: payload.username,
          user_exists: !!user,
          user_status: user?.status,
        });

        throw new AppError(
          StatusCodes.FORBIDDEN,
          "UserNotApproved",
          "User is not approved for login.",
        );
      }

      Logger.debug("InitiateLogin: Initiating Cognito auth", {
        username: payload.username,
      });

      const response = await cognitoClient.send(
        new AdminInitiateAuthCommand({
          AuthFlow: "ADMIN_USER_PASSWORD_AUTH",
          ClientId: COGNITO_CLIENT_ID,
          UserPoolId: COGNITO_USER_POOL_ID,
          AuthParameters: {
            USERNAME: payload.username,
            PASSWORD: payload.password,
          },
        }),
      );

      if (response.ChallengeName) {
        Logger.error("InitiateLogin: Cognito returned an unexpected native challenge", undefined, {
          username: payload.username,
          challenge_name: response.ChallengeName,
        });

        throw new AppError(
          StatusCodes.INTERNAL_SERVER_ERROR,
          "CognitoMfaStillEnabled",
          "Cognito returned a native MFA challenge. Disable built-in Cognito MFA for this app client and user pool before using custom email OTP.",
        );
      }

      const tokens = toPublicTokens(response.AuthenticationResult);
      const email = await this.resolveLoginEmail(user);
      const challengeResponse = await this.createLoginOtpChallenge(
        user,
        email,
        tokens,
      );

      Logger.info("InitiateLogin: Password verified and custom OTP created", {
        username: payload.username,
        challenge_name: challengeResponse.challenge_name,
      });

      return challengeResponse;
    } catch (err: unknown) {
      if (err instanceof AppError) {
        throw err;
      }

      const error: any = err instanceof Error ? err : new Error(String(err));
      let orginalError = error;
      const errorName = getCognitoErrorName(err);
      Logger.error("InitiateLogin: Login failed", error, {
        username: payload.username,
        error_name: errorName,
      });

      if (errorName && errorName !== "Error") {
        throwLoginError(errorName, error.message);
      } else if (orginalError.statusCode === 403) {
        throw new AppError(
          StatusCodes.FORBIDDEN,
          "UserNotFoundOrNotApproved",
          "User is not found or not approved for login.",
        );
      }

      Logger.error("InitiateLogin: Unknown Cognito error", error, {
        username: payload.username,
        error_name: errorName,
      });

      throw new AppError(
        StatusCodes.UNAUTHORIZED,
        "AuthenticationFailed",
        "Authentication failed. Please verify your credentials and try again.",
      );
    }
  }

  public static async respondToChallenge(
    payload: LoginRespondPayload,
  ): Promise<{
    tokens: ReturnType<typeof toPublicTokens>;
    user: LoginUser | null;
  }> {
    try {
      Logger.debug("RespondToChallenge: Processing challenge response", {
        username: payload.username,
        challenge_name: payload.challenge_name,
      });

      if (!isCustomEmailChallenge(payload.challenge_name)) {
        throw new AppError(
          StatusCodes.BAD_REQUEST,
          "UnsupportedChallenge",
          `Unsupported challenge type: ${payload.challenge_name}`,
        );
      }

      const challenge = await this.getLoginChallengeForUser(
        payload.username,
        payload.session,
      );

      const expectedOtpHash = challenge.otp_hash;
      if (!expectedOtpHash || !challenge.token_bundle_ciphertext) {
        await this.finalizeLoginChallenge(challenge.id, "FAILED");
        throw new AppError(
          StatusCodes.UNAUTHORIZED,
          "AuthenticationSessionInvalid",
          "Login session is invalid or has expired. Please sign in again.",
        );
      }

      const submittedOtpHash = hashLoginOtp(
        challenge.challenge_id,
        payload.challenge_code.trim(),
      );

      if (!safeHexEqual(expectedOtpHash, submittedOtpHash)) {
        const nextAttemptCount = challenge.attempt_count + 1;
        const shouldFailChallenge = nextAttemptCount >= challenge.max_attempts;

        await prisma.login_otp_challenge.update({
          where: { id: challenge.id },
          data: {
            attempt_count: nextAttemptCount,
            challenge_status: shouldFailChallenge ? "FAILED" : challenge.challenge_status,
            consumed_at: shouldFailChallenge ? new Date() : challenge.consumed_at,
            otp_hash: shouldFailChallenge ? null : challenge.otp_hash,
            token_bundle_ciphertext: shouldFailChallenge
              ? null
              : challenge.token_bundle_ciphertext,
          },
        });

        if (shouldFailChallenge) {
          throw new AppError(
            StatusCodes.TOO_MANY_REQUESTS,
            "OtpAttemptsExceeded",
            "Maximum OTP attempts reached. Please sign in again.",
          );
        }

        throw new AppError(
          StatusCodes.BAD_REQUEST,
          "InvalidChallengeCode",
          "Invalid login OTP. Please check the code and try again.",
        );
      }

      const user = await this.getLoginUser(payload.username);
      let tokens: PublicTokens;
      try {
        tokens = decryptTokenBundle(challenge.token_bundle_ciphertext);
      } catch (err: unknown) {
        await this.finalizeLoginChallenge(challenge.id, "FAILED");
        throw err;
      }

      await this.finalizeLoginChallenge(challenge.id, "VERIFIED");

      Logger.info("RespondToChallenge: Custom OTP verified successfully", {
        username: payload.username,
        challenge_name: payload.challenge_name,
      });

      return {
        tokens,
        user: user || null,
      };
    } catch (err: unknown) {
      if (err instanceof AppError) {
        throw err;
      }

      const error = err instanceof Error ? err : new Error(String(err));
      const errorName = getCognitoErrorName(err);
      Logger.error(
        "RespondToChallenge: Failed to respond to challenge",
        error,
        {
          username: payload.username,
          challenge_name: payload.challenge_name,
          error_name: errorName,
        },
      );

      if (errorName) {
        throwLoginError(errorName);
      }

      throw error;
    }
  }

  public static async resendLoginOtp(
    payload: LoginResendPayload,
  ): Promise<LoginChallengeResponse> {
    const challenge = await this.getLoginChallengeForUser(
      payload.username,
      payload.session,
    );

    if (challenge.resend_available_at.getTime() > Date.now()) {
      throw new AppError(
        StatusCodes.TOO_MANY_REQUESTS,
        "OtpResendCooldown",
        "Please wait before requesting another login OTP.",
        {
          retry_after_seconds: secondsUntil(challenge.resend_available_at),
        },
      );
    }

    const nextOtp = generateLoginOtp();
    const nextOtpExpiresAt = buildOtpExpiryDate();
    const nextResendAvailableAt = buildResendAvailableDate();
    const previousOtpHash = challenge.otp_hash;
    const previousOtpExpiresAt = challenge.otp_expires_at;
    const previousResendAvailableAt = challenge.resend_available_at;
    const previousLastSentAt = challenge.last_sent_at;
    const previousResendCount = challenge.resend_count;
    const previousAttemptCount = challenge.attempt_count;

    await prisma.login_otp_challenge.update({
      where: { id: challenge.id },
      data: {
        otp_hash: hashLoginOtp(challenge.challenge_id, nextOtp),
        otp_expires_at: nextOtpExpiresAt,
        attempt_count: 0,
        resend_count: challenge.resend_count + 1,
        resend_available_at: nextResendAvailableAt,
        last_sent_at: new Date(),
      },
    });

    try {
      await emailService.sendLoginOtp({
        to: challenge.email,
        username: payload.username,
        otp: nextOtp,
        expiresInMinutes: AUTH_OTP_TTL_MINUTES,
      });
    } catch (err: unknown) {
      await prisma.login_otp_challenge.update({
        where: { id: challenge.id },
        data: {
          otp_hash: previousOtpHash,
          otp_expires_at: previousOtpExpiresAt,
          attempt_count: previousAttemptCount,
          resend_count: previousResendCount,
          resend_available_at: previousResendAvailableAt,
          last_sent_at: previousLastSentAt,
        },
      });

      throw err;
    }

    Logger.info("ResendLoginOtp: Custom OTP resent successfully", {
      username: payload.username,
      challenge_id: challenge.challenge_id,
      resend_count: previousResendCount + 1,
    });

    const user = await this.getLoginUser(payload.username);

    return this.buildLoginChallengeResponse(
      challenge.challenge_id,
      challenge.email,
      nextOtpExpiresAt,
      nextResendAvailableAt,
      user,
    );
  }

  public static async forgotPassword(payload: ForgotPasswordPayload): Promise<{
    destination?: string;
    delivery_medium?: string;
  }> {
    try {
      Logger.debug("ForgotPassword: Initiating forgot password", {
        username: payload.username,
      });

      const response = await cognitoClient.send(
        new ForgotPasswordCommand({
          ClientId: COGNITO_CLIENT_ID,
          Username: payload.username,
        }),
      );

      Logger.info("ForgotPassword: Password reset code sent", {
        username: payload.username,
        delivery_medium: response.CodeDeliveryDetails?.DeliveryMedium,
      });

      return {
        destination: response.CodeDeliveryDetails?.Destination,
        delivery_medium: response.CodeDeliveryDetails?.DeliveryMedium,
      };
    } catch (err: unknown) {
      const error = err instanceof Error ? err : new Error(String(err));
      Logger.error(
        "ForgotPassword: Failed to initiate forgot password",
        error,
        {
          username: payload.username,
        },
      );
      return throwForgotPasswordError(err);
    }
  }

  public static async confirmForgotPassword(
    payload: ConfirmForgotPasswordPayload,
  ): Promise<void> {
    try {
      Logger.debug("ConfirmForgotPassword: Confirming forgot password", {
        username: payload.username,
      });

      await cognitoClient.send(
        new ConfirmForgotPasswordCommand({
          ClientId: COGNITO_CLIENT_ID,
          Username: payload.username,
          ConfirmationCode: payload.confirmation_code,
          Password: payload.new_password,
        }),
      );

      Logger.info("ConfirmForgotPassword: Password reset confirmed", {
        username: payload.username,
      });
    } catch (err: unknown) {
      const error = err instanceof Error ? err : new Error(String(err));
      Logger.error(
        "ConfirmForgotPassword: Failed to confirm forgot password",
        error,
        {
          username: payload.username,
        },
      );
      return throwConfirmForgotPasswordError(err);
    }
  }
}
