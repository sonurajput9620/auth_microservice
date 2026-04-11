import {
  AdminGetUserCommand,
  AdminUpdateUserAttributesCommand,
  CognitoIdentityProviderClient,
  ConfirmForgotPasswordCommand,
  ConfirmSignUpCommand,
  ForgotPasswordCommand,
  SignUpCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import { StatusCodes } from "http-status-codes";

import { prisma } from "../prismaClient";
import { CognitoService } from "./CognitoService";
import { EmailService } from "./EmailService";
import { OtpService } from "./otp.service";
import { AppError } from "../utils/AppError";
import { Logger } from "../utils/Logger";
import {
  ApproveRegistrationPayload,
  ConfirmForgotPasswordPayload,
  ConfirmSignUpPayload,
  ForgotPasswordPayload,
  InternalCreateLoginOtpPayload,
  InternalValidateLoginOtpPayload,
  ListRegistrationsQuery,
  LoginInitiatePayload,
  ResendLoginOtpPayload,
  SignUpPayload,
  VerifyLoginOtpPayload,
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
const AWS_REGION = getEnv("AWS_DEFAULT_REGION");
const cognitoClient = new CognitoIdentityProviderClient({
  region: AWS_REGION,
});

const normalizePhone = (phone: string): string => {
  if (phone.startsWith("+")) {
    return phone;
  }
  return `+${phone}`;
};

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

const getCognitoErrorName = (err: unknown): string | undefined =>
  (err as { name?: string })?.name;

const throwLoginError = (errorName: string | undefined): never => {
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

  if (errorName === "InvalidParameterException") {
    throw new AppError(
      StatusCodes.INTERNAL_SERVER_ERROR,
      "CognitoClientMisconfigured",
      "Cognito app client auth flow is not enabled for this login path.",
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
  role_id: string | null;
  role_name: string | null;
  site_id: number | null;
  site_name: string | null;
  corporation_id: number | null;
  corporation_name: string | null;
};

export class AuthService {
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

  private static async getLoginUserByEmail(email: string): Promise<LoginUser | null> {
    const normalizedEmail = email.trim().toLowerCase();

    const user = await prisma.app_user.findFirst({
      where: { email: normalizedEmail },
      select: {
        username: true
      }
    });

    if (!user?.username) {
      return null;
    }

    return this.getLoginUser(user.username);
  }

  public static async checkUsernameAvailability(
    payload: UsernameAvailabilityPayload
  ): Promise<{
    username: string;
    available: boolean;
    source: "database" | "cognito";
  }> {
    const username = payload.username.trim();

    const [existingAppUser, existingRegistration] = await Promise.all([
      prisma.app_user.findUnique({
        where: { username },
        select: { id: true },
      }),
      prisma.register_user.findUnique({
        where: { username },
        select: { id: true },
      }),
    ]);

    if (existingAppUser || existingRegistration) {
      return {
        username,
        available: false,
        source: "database",
      };
    }

    try {
      await cognitoClient.send(
        new AdminGetUserCommand({
          UserPoolId: COGNITO_USER_POOL_ID,
          Username: username,
        })
      );

      return {
        username,
        available: false,
        source: "cognito",
      };
    } catch (err: unknown) {
      const errorName = getCognitoErrorName(err);
      if (errorName === "UserNotFoundException") {
        return {
          username,
          available: true,
          source: "cognito",
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
      Logger.debug("SignUp: Creating user in Cognito", {
        username: payload.username,
        email: payload.email,
      });

      const response = await cognitoClient.send(
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
            { Name: "phone_number", Value: normalizePhone(payload.phone) },
          ],
        }),
      );

      Logger.info("SignUp: User created successfully in Cognito", {
        username: payload.username,
        user_sub: response.UserSub,
      });

      const existingRegistration = await prisma.register_user.findUnique({
        where: { username: payload.username },
      });

      if (existingRegistration) {
        await prisma.register_user.update({
          where: { id: existingRegistration.id },
          data: {
            first_name: payload.first_name,
            last_name: payload.last_name,
            email: payload.email,
            phone: normalizePhone(payload.phone),
          },
        });
      } else {
        await prisma.register_user.create({
          data: {
            username: payload.username,
            first_name: payload.first_name,
            last_name: payload.last_name,
            email: payload.email,
            phone: normalizePhone(payload.phone),
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

      await cognitoClient.send(
        new ConfirmSignUpCommand({
          ClientId: COGNITO_CLIENT_ID,
          Username: payload.username,
          ConfirmationCode: payload.confirmation_code,
        }),
      );

      // ConfirmSignUp verifies the sign-up code but does not reliably set the
      // recovery attribute as verified for this username-based pool setup.
      await cognitoClient.send(
        new AdminUpdateUserAttributesCommand({
          UserPoolId: COGNITO_USER_POOL_ID,
          Username: payload.username,
          UserAttributes: [{ Name: "email_verified", Value: "true" }],
        }),
      );

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
      where: query.status
        ? {
            status: query.status,
          }
        : undefined,
      include: {
        app_user: {
          select: {
            id: true,
            role_id: true,
            site_id: true,
            corporation_id: true,
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

  public static async initiateLogin(payload: LoginInitiatePayload): Promise<{
    status: "OTP_REQUIRED";
    challenge_id: string;
    cognito_session: string;
    otp: {
      delivery_medium: "EMAIL";
      destination: string;
      expires_in: number;
      max_attempts: number;
    };
    user_hint: {
      email: string | null;
      username: string;
    };
  }> {
    try {
      Logger.debug("InitiateLogin: Checking user status", {
        email: payload.email,
      });

      const user = await this.getLoginUserByEmail(payload.email);

      if (!user || user.status !== true) {
        Logger.warn("InitiateLogin: User not approved or not active", {
          email: payload.email,
          user_exists: !!user,
          user_status: user?.status,
        });

        throw new AppError(
          StatusCodes.FORBIDDEN,
          "UserNotApproved",
          "User is not approved for login.",
        );
      }

      const cognito = await CognitoService.loginWithPassword(
        payload.email.trim().toLowerCase(),
        payload.password
      );

      const challengeId = cognito.challengeParameters.challengeId?.trim();

      if (!challengeId) {
        throw new AppError(
          StatusCodes.UNAUTHORIZED,
          "ChallengeSessionMissing",
          "Cognito did not return an OTP challenge identifier."
        );
      }

      return {
        status: "OTP_REQUIRED",
        challenge_id: challengeId,
        cognito_session: cognito.session,
        otp: {
          delivery_medium: "EMAIL",
          destination: cognito.challengeParameters.destination ?? (user.email ?? payload.email),
          expires_in: Number.parseInt(cognito.challengeParameters.expiresIn ?? "300", 10) || 300,
          max_attempts: Number.parseInt(cognito.challengeParameters.maxAttempts ?? "3", 10) || 3
        },
        user_hint: {
          email: user.email ?? null,
          username: user.username
        }
      };
    } catch (err: unknown) {
      const error: any = err instanceof Error ? err : new Error(String(err));
      const errorName = getCognitoErrorName(err);
      Logger.error("InitiateLogin: Login failed", error, {
        email: payload.email,
        error_name: errorName,
      });

      if (err instanceof AppError) {
        throw err;
      }

      throw new AppError(
        StatusCodes.BAD_GATEWAY,
        "AuthenticationFailed",
        "Authentication failed. Please verify your credentials and try again."
      );
    }
  }

  public static async verifyLoginOtp(
    payload: VerifyLoginOtpPayload,
  ): Promise<{
    tokens: ReturnType<typeof toPublicTokens>;
    user: LoginUser | null;
  }> {
    try {
      Logger.debug("VerifyLoginOtp: Processing login OTP", {
        email: payload.email,
        challenge_id: payload.challenge_id,
      });

      const verification = await OtpService.verifyLoginOtp(
        payload.email,
        payload.challenge_id,
        payload.otp_code
      );

      if (!verification.valid) {
        throw new AppError(
          StatusCodes.BAD_REQUEST,
          "InvalidLoginOtp",
          "Invalid login OTP.",
          { attempts_remaining: verification.attempts_remaining }
        );
      }

      const response = await CognitoService.respondToCustomChallenge({
        email: payload.email,
        session: payload.cognito_session,
        otpCode: payload.otp_code
      });

      await OtpService.consumeOtp(payload.challenge_id);

      const user = await this.getLoginUserByEmail(payload.email);

      Logger.info("VerifyLoginOtp: Login successful after custom OTP", {
        email: payload.email,
        challenge_id: payload.challenge_id,
      });

      return {
        tokens: response.tokens,
        user: user || null,
      };
    } catch (err: unknown) {
      const error = err instanceof Error ? err : new Error(String(err));
      Logger.error(
        "VerifyLoginOtp: Failed to verify login OTP",
        error,
        {
          email: payload.email,
          challenge_id: payload.challenge_id,
        },
      );

      if (err instanceof AppError) {
        throw err;
      }

      throw new AppError(
        StatusCodes.BAD_GATEWAY,
        "LoginOtpVerificationFailed",
        "Failed to verify login OTP."
      );
    }
  }

  public static async resendLoginOtp(
    payload: ResendLoginOtpPayload,
  ): Promise<{
    status: "OTP_REQUIRED";
    challenge_id: string;
    otp: {
      delivery_medium: "EMAIL";
      destination: string;
      expires_in: number;
      max_attempts: number;
    };
  }> {
    const regenerated = await OtpService.resendLoginOtp(
      payload.email,
      payload.challenge_id
    );

    const delivery = await EmailService.sendLoginOtp({
      email: payload.email.trim().toLowerCase(),
      otp: regenerated.otp,
      expiresAt: regenerated.expiresAt
    });

    return {
      status: "OTP_REQUIRED",
      challenge_id: regenerated.challengeId,
      otp: {
        delivery_medium: delivery.delivery_medium,
        destination: delivery.destination,
        expires_in: 300,
        max_attempts: regenerated.maxAttempts
      }
    };
  }

  public static async createInternalLoginOtp(
    payload: InternalCreateLoginOtpPayload
  ): Promise<{
    challengeId: string;
    destination: string;
    expiresIn: number;
    maxAttempts: number;
  }> {
    const created = await OtpService.createLoginOtp(payload.email, payload.challengeId);
    const delivery = await EmailService.sendLoginOtp({
      email: payload.email.trim().toLowerCase(),
      otp: created.otp,
      expiresAt: created.expiresAt
    });

    return {
      challengeId: created.challengeId,
      destination: delivery.destination,
      expiresIn: 300,
      maxAttempts: created.maxAttempts
    };
  }

  public static async validateInternalLoginOtp(
    payload: InternalValidateLoginOtpPayload
  ): Promise<{ valid: boolean }> {
    try {
      const result = await OtpService.verifyLoginOtp(
        payload.email,
        payload.challengeId,
        payload.otp
      );

      return {
        valid: result.valid
      };
    } catch (error) {
      if (error instanceof AppError) {
        if (
          error.errorCode === "LoginOtpExpired" ||
          error.errorCode === "LoginOtpAlreadyUsed" ||
          error.errorCode === "LoginOtpAttemptsExceeded" ||
          error.errorCode === "LoginOtpNotFound"
        ) {
          return { valid: false };
        }

        throw error;
      }

      throw error;
    }
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
