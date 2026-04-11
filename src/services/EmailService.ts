import nodemailer from "nodemailer";
import { StatusCodes } from "http-status-codes";

import { AppError } from "../utils/AppError";
import { Logger } from "../utils/Logger";

type SendLoginOtpPayload = {
  email: string;
  otp: string;
  expiresAt: Date;
};

type EmailCredentials = {
  gmailUser: string;
  gmailPassword: string;
};

const maskEmail = (email: string): string => {
  const [localPart, domain = ""] = email.split("@");
  if (!localPart || !domain) {
    return "***";
  }

  const visible = localPart.slice(0, 2);
  return `${visible}${"*".repeat(Math.max(localPart.length - 2, 1))}@${domain}`;
};

export class EmailService {
  private static async getGmailCredentialsFromSecrets(): Promise<EmailCredentials> {
    const { GetSecretValueCommand, SecretsManagerClient } = await import(
      "@aws-sdk/client-secrets-manager"
    );

    const client = new SecretsManagerClient({
      region: process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "ap-south-1"
    });

    const secretName = process.env.GMAIL_SECRET_NAME?.trim() || "purebi/gmail-credentials";
    const response = await client.send(
      new GetSecretValueCommand({
        SecretId: secretName
      })
    );

    const secret = JSON.parse(response.SecretString || "{}") as Record<string, unknown>;

    if (typeof secret.GMAIL_USER !== "string" || typeof secret.GMAIL_APP_PASSWORD !== "string") {
      throw new Error(
        "Gmail credentials not found in secret. Expected GMAIL_USER and GMAIL_APP_PASSWORD."
      );
    }

    return {
      gmailUser: secret.GMAIL_USER,
      gmailPassword: secret.GMAIL_APP_PASSWORD
    };
  }

  private static async getGmailCredentialsFromSSM(): Promise<EmailCredentials> {
    const { GetParametersCommand, SSMClient } = await import("@aws-sdk/client-ssm");

    const client = new SSMClient({
      region: process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "ap-south-1"
    });

    const basePath = process.env.GMAIL_SSM_BASE_PATH?.trim() || "/purebi/gmail";
    const response = await client.send(
      new GetParametersCommand({
        Names: [`${basePath}/user`, `${basePath}/app-password`],
        WithDecryption: true
      })
    );

    const parameters = response.Parameters ?? [];
    const creds: Partial<EmailCredentials> = {};

    parameters.forEach((param) => {
      if (param.Name?.endsWith("/user") && param.Value) {
        creds.gmailUser = param.Value;
      }
      if (param.Name?.endsWith("/app-password") && param.Value) {
        creds.gmailPassword = param.Value;
      }
    });

    if (!creds.gmailUser || !creds.gmailPassword) {
      throw new Error("Gmail credentials not found in SSM.");
    }

    return creds as EmailCredentials;
  }

  private static async getGmailCredentials(): Promise<EmailCredentials> {
    if (process.env.GMAIL_SECRET_NAME?.trim()) {
      try {
        return await this.getGmailCredentialsFromSecrets();
      } catch (error) {
        Logger.warn("Failed to load Gmail credentials from Secrets Manager. Falling back.", {
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    if (process.env.USE_SSM_FOR_GMAIL === "true") {
      try {
        return await this.getGmailCredentialsFromSSM();
      } catch (error) {
        Logger.warn("Failed to load Gmail credentials from SSM. Falling back.", {
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    const gmailUser = process.env.GMAIL_USER?.trim();
    const gmailPassword = process.env.GMAIL_APP_PASSWORD?.trim();

    if (!gmailUser || !gmailPassword) {
      throw new AppError(
        StatusCodes.INTERNAL_SERVER_ERROR,
        "ConfigError",
        "Gmail credentials are not configured."
      );
    }

    return { gmailUser, gmailPassword };
  }

  public static async sendLoginOtp(payload: SendLoginOtpPayload): Promise<{
    destination: string;
    delivery_medium: "EMAIL";
  }> {
    try {
      const { gmailPassword, gmailUser } = await this.getGmailCredentials();

      const transporter = nodemailer.createTransport({
        service: "gmail",
        host: "smtp.gmail.com",
        port: 587,
        secure: false,
        auth: {
          user: gmailUser,
          pass: gmailPassword
        }
      });

      const subject = "Your login verification code";
      const text = [
        `Your verification code is ${payload.otp}.`,
        "It expires in 5 minutes.",
        "If you did not attempt to sign in, you can safely ignore this message."
      ].join(" ");

      const html = `
        <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #1f2937;">
          <h2 style="margin-bottom: 16px;">Login Verification Code</h2>
          <p>Your verification code is:</p>
          <div style="font-size: 28px; font-weight: 700; letter-spacing: 6px; margin: 16px 0;">
            ${payload.otp}
          </div>
          <p>This code expires in 5 minutes.</p>
          <p>If you did not attempt to sign in, you can safely ignore this email.</p>
        </div>
      `;

      Logger.info("Sending login OTP email", {
        email: payload.email,
        destination: maskEmail(payload.email),
        expires_at: payload.expiresAt.toISOString()
      });

      await transporter.sendMail({
        from: `"Auth Service" <${gmailUser}>`,
        to: payload.email,
        subject,
        text,
        html
      });

      return {
        destination: maskEmail(payload.email),
        delivery_medium: "EMAIL"
      };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      Logger.error("Failed to send login OTP email", err, {
        email: payload.email
      });

      throw new AppError(
        StatusCodes.INTERNAL_SERVER_ERROR,
        "EmailSendFailed",
        "Failed to send login OTP email."
      );
    }
  }
}
