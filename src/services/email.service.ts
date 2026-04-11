import nodemailer, { type Transporter } from "nodemailer";
import { StatusCodes } from "http-status-codes";

import { AppError } from "../utils/AppError";
import { Logger } from "../utils/Logger";

type SendEmailPayload = {
  to: string;
  subject: string;
  html: string;
  text: string;
};

type SendLoginOtpPayload = {
  to: string;
  username: string;
  otp: string;
  expiresInMinutes: number;
};

type MailCredentials = {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  fromEmail: string;
  fromName: string;
};

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

const getRequiredEnv = (key: string): string => {
  const value = process.env[key]?.trim();
  if (!value) {
    throw new AppError(
      StatusCodes.INTERNAL_SERVER_ERROR,
      "ConfigError",
      `${key} is not configured.`,
    );
  }
  return value;
};

const parseSecureFlag = (): boolean => process.env.SMTP_SECURE === "true";

const parsePort = (): number => {
  const rawPort = getRequiredEnv("SMTP_PORT");
  const port = Number(rawPort);

  if (!Number.isInteger(port) || port <= 0) {
    throw new AppError(
      StatusCodes.INTERNAL_SERVER_ERROR,
      "ConfigError",
      "SMTP_PORT must be a valid positive integer.",
    );
  }

  return port;
};

class EmailService {
  private transporter: Transporter | null = null;
  private credentialsPromise: Promise<MailCredentials> | null = null;

  private async getGmailCredentialsFromSecrets(): Promise<{
    user: string;
    pass: string;
  }> {
    const secretName = process.env.GMAIL_SECRET_NAME?.trim();
    if (!secretName) {
      throw new Error("GMAIL_SECRET_NAME is not configured.");
    }

    const { SecretsManagerClient, GetSecretValueCommand } = await import(
      "@aws-sdk/client-secrets-manager"
    );

    const client = new SecretsManagerClient({
      region: process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "ap-south-1",
    });

    const response = await client.send(
      new GetSecretValueCommand({
        SecretId: secretName,
      }),
    );

    const secret = JSON.parse(response.SecretString || "{}") as Record<string, unknown>;
    const user = typeof secret.GMAIL_USER === "string" ? secret.GMAIL_USER.trim() : "";
    const pass =
      typeof secret.GMAIL_APP_PASSWORD === "string"
        ? secret.GMAIL_APP_PASSWORD.trim()
        : "";

    if (!user || !pass) {
      throw new Error(
        "Gmail credentials not found in Secrets Manager. Expected GMAIL_USER and GMAIL_APP_PASSWORD.",
      );
    }

    return { user, pass };
  }

  private async getGmailCredentialsFromSsm(): Promise<{
    user: string;
    pass: string;
  }> {
    const basePath = process.env.GMAIL_SSM_BASE_PATH?.trim() || "/purebi/gmail";
    const { SSMClient, GetParametersCommand } = await import("@aws-sdk/client-ssm");

    const client = new SSMClient({
      region: process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "ap-south-1",
    });

    const response = await client.send(
      new GetParametersCommand({
        Names: [`${basePath}/user`, `${basePath}/app-password`],
        WithDecryption: true,
      }),
    );

    const parameters = response.Parameters ?? [];
    const user =
      parameters.find((parameter) => parameter.Name?.endsWith("/user"))?.Value?.trim() || "";
    const pass =
      parameters
        .find((parameter) => parameter.Name?.endsWith("/app-password"))
        ?.Value?.trim() || "";

    if (!user || !pass) {
      throw new Error(
        "Gmail credentials not found in SSM. Expected user and app-password parameters.",
      );
    }

    return { user, pass };
  }

  private async resolveGmailCredentials(): Promise<{
    user: string;
    pass: string;
  }> {
    if (process.env.GMAIL_SECRET_NAME?.trim()) {
      try {
        return await this.getGmailCredentialsFromSecrets();
      } catch (err: unknown) {
        const error = err instanceof Error ? err : new Error(String(err));
        Logger.warn("Failed to load Gmail credentials from Secrets Manager", {
          error: error.message,
        });
      }
    }

    if (process.env.USE_SSM_FOR_GMAIL === "true" || process.env.GMAIL_SSM_BASE_PATH?.trim()) {
      try {
        return await this.getGmailCredentialsFromSsm();
      } catch (err: unknown) {
        const error = err instanceof Error ? err : new Error(String(err));
        Logger.warn("Failed to load Gmail credentials from SSM", {
          error: error.message,
        });
      }
    }

    const user = process.env.GMAIL_USER?.trim() || "";
    const pass = process.env.GMAIL_APP_PASSWORD?.trim() || "";

    if (!user || !pass) {
      throw new AppError(
        StatusCodes.INTERNAL_SERVER_ERROR,
        "ConfigError",
        "Gmail credentials are not configured. Set GMAIL_SECRET_NAME, or GMAIL_USER and GMAIL_APP_PASSWORD.",
      );
    }

    return { user, pass };
  }

  private async resolveMailCredentials(): Promise<MailCredentials> {
    const smtpHost = process.env.SMTP_HOST?.trim();

    if (smtpHost) {
      const user = getRequiredEnv("SMTP_USER");

      return {
        host: smtpHost,
        port: parsePort(),
        secure: parseSecureFlag(),
        user,
        pass: getRequiredEnv("SMTP_PASS"),
        fromEmail: process.env.SMTP_FROM_EMAIL?.trim() || user,
        fromName: process.env.SMTP_FROM_NAME?.trim() || "Auth Service",
      };
    }

    const gmailCredentials = await this.resolveGmailCredentials();

    return {
      host: "smtp.gmail.com",
      port: 587,
      secure: false,
      user: gmailCredentials.user,
      pass: gmailCredentials.pass,
      fromEmail: process.env.SMTP_FROM_EMAIL?.trim() || gmailCredentials.user,
      fromName: process.env.SMTP_FROM_NAME?.trim() || "Auth Service",
    };
  }

  private async getTransporter(): Promise<Transporter> {
    if (this.transporter) {
      return this.transporter;
    }

    if (!this.credentialsPromise) {
      this.credentialsPromise = this.resolveMailCredentials();
    }

    const credentials = await this.credentialsPromise;

    this.transporter = nodemailer.createTransport({
      host: credentials.host,
      port: credentials.port,
      secure: credentials.secure,
      auth: {
        user: credentials.user,
        pass: credentials.pass,
      },
    });

    return this.transporter;
  }

  private async getFromAddress(): Promise<string> {
    if (!this.credentialsPromise) {
      this.credentialsPromise = this.resolveMailCredentials();
    }

    const credentials = await this.credentialsPromise;
    return `"${credentials.fromName}" <${credentials.fromEmail}>`;
  }

  public async sendEmail(payload: SendEmailPayload): Promise<void> {
    try {
      const transporter = await this.getTransporter();
      const info = await transporter.sendMail({
        from: await this.getFromAddress(),
        to: payload.to,
        subject: payload.subject,
        html: payload.html,
        text: payload.text,
      });

      Logger.info("Email sent successfully", {
        message_id: info.messageId,
        subject: payload.subject,
      });
    } catch (err: unknown) {
      const error = err instanceof Error ? err : new Error(String(err));

      Logger.error("Failed to send email", error, {
        to: payload.to,
        subject: payload.subject,
      });

      throw new AppError(
        StatusCodes.BAD_GATEWAY,
        "EmailDeliveryFailed",
        "Failed to send email.",
      );
    }
  }

  public async sendLoginOtp(payload: SendLoginOtpPayload): Promise<void> {
    const safeUsername = escapeHtml(payload.username);
    const html = `
      <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #111827;">
        <p>Hello ${safeUsername},</p>
        <p>Your login verification code is:</p>
        <p style="font-size: 28px; font-weight: 700; letter-spacing: 4px; margin: 16px 0;">
          ${payload.otp}
        </p>
        <p>This code will expire in ${payload.expiresInMinutes} minute(s).</p>
        <p>If you did not try to sign in, please reset your password immediately.</p>
      </div>
    `;

    await this.sendEmail({
      to: payload.to,
      subject: "Your login verification code",
      html,
      text: [
        `Hello ${payload.username},`,
        "",
        `Your login verification code is: ${payload.otp}`,
        `This code will expire in ${payload.expiresInMinutes} minute(s).`,
        "If you did not try to sign in, please reset your password immediately.",
      ].join("\n"),
    });
  }
}

export const emailService = new EmailService();
