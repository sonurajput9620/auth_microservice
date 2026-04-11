import { InitiateAuthCommand, CognitoIdentityProviderClient, RespondToAuthChallengeCommand } from "@aws-sdk/client-cognito-identity-provider";
import { StatusCodes } from "http-status-codes";

import { AppError } from "../utils/AppError";

const getEnv = (key: string): string => {
  const value = process.env[key]?.trim();
  if (!value) {
    throw new AppError(
      StatusCodes.INTERNAL_SERVER_ERROR,
      "ConfigError",
      `${key} is not configured.`
    );
  }

  return value;
};

const cognitoClient = new CognitoIdentityProviderClient({
  region: getEnv("AWS_DEFAULT_REGION")
});

const COGNITO_CLIENT_ID = getEnv("COGNITO_CLIENT_ID");

const mapCognitoError = (err: unknown): never => {
  const errorName = (err as { name?: string })?.name;
  const message = err instanceof Error ? err.message : String(err);

  if (errorName === "NotAuthorizedException") {
    throw new AppError(
      StatusCodes.UNAUTHORIZED,
      "InvalidCredentials",
      "Invalid email or password."
    );
  }

  if (errorName === "PasswordResetRequiredException") {
    throw new AppError(
      StatusCodes.FORBIDDEN,
      "PasswordResetRequired",
      "Password reset is required before login."
    );
  }

  if (errorName === "UserNotConfirmedException") {
    throw new AppError(
      StatusCodes.FORBIDDEN,
      "UserNotConfirmed",
      "User account is not confirmed."
    );
  }

  if (errorName === "UserNotFoundException") {
    throw new AppError(
      StatusCodes.NOT_FOUND,
      "UserNotFound",
      "User not found in Cognito."
    );
  }

  throw new AppError(
    StatusCodes.BAD_GATEWAY,
    "CognitoAuthFailed",
    message || "Cognito authentication failed."
  );
};

export class CognitoService {
  public static async loginWithPassword(email: string, password: string): Promise<{
    session: string;
    challengeName: string;
    challengeParameters: Record<string, string>;
  }> {
    try {
      /*
        Integration point:
        For a full Cognito CUSTOM_AUTH password-first flow, wire in your SRP helper here.
        This placeholder starts CUSTOM_AUTH and expects your Lambda flow / adapter to complete
        the password-verification sequence before CUSTOM_CHALLENGE is returned.
      */
      const response = await cognitoClient.send(
        new InitiateAuthCommand({
          AuthFlow: "CUSTOM_AUTH",
          ClientId: COGNITO_CLIENT_ID,
          AuthParameters: {
            USERNAME: email,
            PASSWORD: password
          }
        })
      );

      if (!response.Session || !response.ChallengeName) {
        throw new AppError(
          StatusCodes.UNAUTHORIZED,
          "ChallengeSessionMissing",
          "Cognito did not return a custom challenge session."
        );
      }

      return {
        session: response.Session,
        challengeName: response.ChallengeName,
        challengeParameters: response.ChallengeParameters ?? {}
      };
    } catch (err: unknown) {
      mapCognitoError(err);
    }
  }

  public static async respondToCustomChallenge(payload: {
    email: string;
    session: string;
    otpCode: string;
  }): Promise<{
    tokens: {
      access_token: string;
      id_token: string;
      refresh_token: string | null;
      expires_in: number | null;
    };
  }> {
    try {
      const response = await cognitoClient.send(
        new RespondToAuthChallengeCommand({
          ClientId: COGNITO_CLIENT_ID,
          ChallengeName: "CUSTOM_CHALLENGE",
          Session: payload.session,
          ChallengeResponses: {
            USERNAME: payload.email,
            ANSWER: payload.otpCode
          }
        })
      );

      if (!response.AuthenticationResult?.AccessToken || !response.AuthenticationResult?.IdToken) {
        throw new AppError(
          StatusCodes.UNAUTHORIZED,
          "AuthenticationIncomplete",
          "Authentication did not complete successfully."
        );
      }

      return {
        tokens: {
          access_token: response.AuthenticationResult.AccessToken,
          id_token: response.AuthenticationResult.IdToken,
          refresh_token: response.AuthenticationResult.RefreshToken ?? null,
          expires_in: response.AuthenticationResult.ExpiresIn ?? null
        }
      };
    } catch (err: unknown) {
      mapCognitoError(err);
    }
  }
}
