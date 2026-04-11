import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { StatusCodes } from "http-status-codes";

import { prisma } from "../prismaClient";
import { AppError } from "../utils/AppError";
import { Logger } from "../utils/Logger";

const OTP_LENGTH = 6;
const OTP_EXPIRY_MINUTES = 5;
const DEFAULT_MAX_ATTEMPTS = 3;

const getOtpHashSecret = (): string => {
  const secret = process.env.LOGIN_OTP_HASH_SECRET?.trim();
  if (!secret) {
    throw new AppError(
      StatusCodes.INTERNAL_SERVER_ERROR,
      "ConfigError",
      "LOGIN_OTP_HASH_SECRET is not configured."
    );
  }

  return secret;
};

const getOtpExpiryDate = (): Date => {
  const expiresAt = new Date();
  expiresAt.setMinutes(expiresAt.getMinutes() + OTP_EXPIRY_MINUTES);
  return expiresAt;
};

const isOtpExpired = (expiresAt: Date): boolean => expiresAt.getTime() <= Date.now();

const safeHashEquals = (left: string, right: string): boolean => {
  const leftBuffer = Buffer.from(left, "utf-8");
  const rightBuffer = Buffer.from(right, "utf-8");

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
};

export class OtpService {
  public static async findActiveChallenge(email: string, challengeId: string) {
    const normalizedEmail = email.trim().toLowerCase();
    const normalizedChallengeId = challengeId.trim();

    return prisma.auth_login_otp.findUnique({
      where: {
        challenge_id: normalizedChallengeId
      }
    }).then((record) => {
      if (!record || record.email !== normalizedEmail) {
        return null;
      }

      return record;
    });
  }

  public static generateOtp(): string {
    return randomInt(0, 10 ** OTP_LENGTH).toString().padStart(OTP_LENGTH, "0");
  }

  public static hashOtp(challengeId: string, otp: string): string {
    if (!challengeId?.trim()) {
      throw new AppError(
        StatusCodes.BAD_REQUEST,
        "InvalidChallengeId",
        "challengeId is required to hash the OTP."
      );
    }

    if (!otp?.trim()) {
      throw new AppError(
        StatusCodes.BAD_REQUEST,
        "InvalidOtp",
        "OTP is required to hash the OTP."
      );
    }

    return createHmac("sha256", getOtpHashSecret())
      .update(`${challengeId.trim()}:${otp.trim()}`)
      .digest("hex");
  }

  public static async createLoginOtp(
    email: string,
    challengeId: string
  ): Promise<{
    challengeId: string;
    otp: string;
    expiresAt: Date;
    maxAttempts: number;
  }> {
    if (!email?.trim()) {
      throw new AppError(StatusCodes.BAD_REQUEST, "InvalidEmail", "Email is required.");
    }

    if (!challengeId?.trim()) {
      throw new AppError(
        StatusCodes.BAD_REQUEST,
        "InvalidChallengeId",
        "challengeId is required."
      );
    }

    try {
      const normalizedEmail = email.trim().toLowerCase();
      const normalizedChallengeId = challengeId.trim();
      const otp = this.generateOtp();
      const expiresAt = getOtpExpiryDate();
      const otpHash = this.hashOtp(normalizedChallengeId, otp);

      await prisma.auth_login_otp.create({
        data: {
          email: normalizedEmail,
          challenge_id: normalizedChallengeId,
          otp_hash: otpHash,
          expires_at: expiresAt,
          max_attempts: DEFAULT_MAX_ATTEMPTS
        }
      });

      Logger.info("Login OTP created", {
        email: normalizedEmail,
        challenge_id: normalizedChallengeId,
        expires_at: expiresAt.toISOString()
      });

      return {
        challengeId: normalizedChallengeId,
        otp,
        expiresAt,
        maxAttempts: DEFAULT_MAX_ATTEMPTS
      };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      Logger.error("Failed to create login OTP", err, {
        email: email.trim().toLowerCase(),
        challenge_id: challengeId.trim()
      });

      throw new AppError(
        StatusCodes.INTERNAL_SERVER_ERROR,
        "LoginOtpCreateFailed",
        "Failed to create login OTP."
      );
    }
  }

  public static async verifyLoginOtp(
    email: string,
    challengeId: string,
    otp: string
  ): Promise<{
    valid: boolean;
    attempts_remaining: number;
  }> {
    if (!email?.trim()) {
      throw new AppError(StatusCodes.BAD_REQUEST, "InvalidEmail", "Email is required.");
    }

    if (!challengeId?.trim()) {
      throw new AppError(
        StatusCodes.BAD_REQUEST,
        "InvalidChallengeId",
        "challengeId is required."
      );
    }

    if (!otp?.trim()) {
      throw new AppError(StatusCodes.BAD_REQUEST, "InvalidOtp", "OTP is required.");
    }

    const normalizedEmail = email.trim().toLowerCase();
    const normalizedChallengeId = challengeId.trim();

    try {
      const loginOtp = await prisma.auth_login_otp.findUnique({
        where: {
          challenge_id: normalizedChallengeId
        }
      });

      if (!loginOtp || loginOtp.email !== normalizedEmail) {
        throw new AppError(
          StatusCodes.NOT_FOUND,
          "LoginOtpNotFound",
          "Login OTP challenge was not found."
        );
      }

      if (loginOtp.consumed_at) {
        throw new AppError(
          StatusCodes.BAD_REQUEST,
          "LoginOtpAlreadyUsed",
          "Login OTP has already been used."
        );
      }

      if (isOtpExpired(loginOtp.expires_at)) {
        throw new AppError(
          StatusCodes.BAD_REQUEST,
          "LoginOtpExpired",
          "Login OTP has expired."
        );
      }

      if (loginOtp.attempt_count >= loginOtp.max_attempts) {
        throw new AppError(
          StatusCodes.TOO_MANY_REQUESTS,
          "LoginOtpAttemptsExceeded",
          "Maximum OTP verification attempts exceeded.",
          { attempts_remaining: 0 }
        );
      }

      const hashedOtp = this.hashOtp(normalizedChallengeId, otp);

      if (!safeHashEquals(hashedOtp, loginOtp.otp_hash)) {
        const attemptCount = await this.incrementAttempts(normalizedChallengeId);
        if (attemptCount >= loginOtp.max_attempts) {
          throw new AppError(
            StatusCodes.TOO_MANY_REQUESTS,
            "LoginOtpAttemptsExceeded",
            "Maximum OTP verification attempts exceeded.",
            { attempts_remaining: 0 }
          );
        }

        return {
          valid: false,
          attempts_remaining: Math.max(loginOtp.max_attempts - attemptCount, 0)
        };
      }

      return {
        valid: true,
        attempts_remaining: Math.max(loginOtp.max_attempts - loginOtp.attempt_count, 0)
      };
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }

      const err = error instanceof Error ? error : new Error(String(error));
      Logger.error("Failed to verify login OTP", err, {
        email: normalizedEmail,
        challenge_id: normalizedChallengeId
      });

      throw new AppError(
        StatusCodes.INTERNAL_SERVER_ERROR,
        "LoginOtpVerifyFailed",
        "Failed to verify login OTP."
      );
    }
  }

  public static async incrementAttempts(challengeId: string): Promise<number> {
    if (!challengeId?.trim()) {
      throw new AppError(
        StatusCodes.BAD_REQUEST,
        "InvalidChallengeId",
        "challengeId is required."
      );
    }

    try {
      const updated = await prisma.auth_login_otp.update({
        where: {
          challenge_id: challengeId.trim()
        },
        data: {
          attempt_count: {
            increment: 1
          }
        },
        select: {
          attempt_count: true
        }
      });

      return updated.attempt_count;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      Logger.error("Failed to increment login OTP attempts", err, {
        challenge_id: challengeId.trim()
      });

      throw new AppError(
        StatusCodes.INTERNAL_SERVER_ERROR,
        "LoginOtpAttemptUpdateFailed",
        "Failed to update OTP attempt count."
      );
    }
  }

  public static async consumeOtp(challengeId: string): Promise<void> {
    if (!challengeId?.trim()) {
      throw new AppError(
        StatusCodes.BAD_REQUEST,
        "InvalidChallengeId",
        "challengeId is required."
      );
    }

    try {
      const result = await prisma.auth_login_otp.updateMany({
        where: {
          challenge_id: challengeId.trim(),
          consumed_at: null
        },
        data: {
          consumed_at: new Date()
        }
      });

      if (result.count === 0) {
        throw new AppError(
          StatusCodes.NOT_FOUND,
          "LoginOtpNotFound",
          "Login OTP challenge was not found or already consumed."
        );
      }
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }

      const err = error instanceof Error ? error : new Error(String(error));
      Logger.error("Failed to consume login OTP", err, {
        challenge_id: challengeId.trim()
      });

      throw new AppError(
        StatusCodes.INTERNAL_SERVER_ERROR,
        "LoginOtpConsumeFailed",
        "Failed to consume login OTP."
      );
    }
  }

  public static async deleteExpiredOtps(): Promise<number> {
    try {
      const result = await prisma.auth_login_otp.deleteMany({
        where: {
          expires_at: {
            lt: new Date()
          }
        }
      });

      if (result.count > 0) {
        Logger.info("Expired login OTPs deleted", {
          deleted_count: result.count
        });
      }

      return result.count;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      Logger.error("Failed to delete expired login OTPs", err);

      throw new AppError(
        StatusCodes.INTERNAL_SERVER_ERROR,
        "LoginOtpCleanupFailed",
        "Failed to delete expired login OTPs."
      );
    }
  }

  public static async resendLoginOtp(
    email: string,
    challengeId: string
  ): Promise<{
    challengeId: string;
    otp: string;
    expiresAt: Date;
    maxAttempts: number;
  }> {
    if (!email?.trim()) {
      throw new AppError(StatusCodes.BAD_REQUEST, "InvalidEmail", "Email is required.");
    }

    if (!challengeId?.trim()) {
      throw new AppError(
        StatusCodes.BAD_REQUEST,
        "InvalidChallengeId",
        "challengeId is required."
      );
    }

    const existing = await this.findActiveChallenge(email, challengeId);

    if (!existing) {
      throw new AppError(
        StatusCodes.NOT_FOUND,
        "LoginOtpNotFound",
        "Login OTP challenge was not found."
      );
    }

    if (existing.consumed_at) {
      throw new AppError(
        StatusCodes.BAD_REQUEST,
        "LoginOtpAlreadyUsed",
        "Login OTP has already been used."
      );
    }

    const otp = this.generateOtp();
    const expiresAt = getOtpExpiryDate();

    await prisma.auth_login_otp.update({
      where: {
        challenge_id: challengeId.trim()
      },
      data: {
        otp_hash: this.hashOtp(challengeId, otp),
        attempt_count: 0,
        expires_at: expiresAt
      }
    });

    return {
      challengeId: challengeId.trim(),
      otp,
      expiresAt,
      maxAttempts: existing.max_attempts
    };
  }
}
