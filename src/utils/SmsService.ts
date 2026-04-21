import { PublishCommand, SNSClient } from "@aws-sdk/client-sns";
import { StatusCodes } from "http-status-codes";

import { AppError } from "./AppError";
import { Logger } from "./Logger";

const getEnv = (key: string, defaultValue?: string): string => {
  const value = process.env[key];
  if (!value && !defaultValue) {
    throw new AppError(
      StatusCodes.INTERNAL_SERVER_ERROR,
      "ConfigError",
      `${key} is not configured.`
    );
  }
  return value || defaultValue || "";
};

const AWS_REGION =
  process.env.AWS_REGION?.trim() ||
  process.env.AWS_DEFAULT_REGION?.trim() ||
  "ap-south-1";
const SMS_MOCK_MODE = getEnv("SMS_MOCK_MODE", "true") === "true";
const snsClient = new SNSClient({ region: AWS_REGION });

export class SmsService {
  /**
   * Send SMS verification code to phone number
   * In mock mode (SMS_MOCK_MODE=true), only logs the code without sending SMS
   */
  public static async sendVerificationCode(
    phoneNumber: string,
    code: string
  ): Promise<void> {
    try {
      Logger.debug("Sending SMS verification code", {
        phone: phoneNumber.replace(/\d(?=\d{4})/g, "*"),
        mock_mode: SMS_MOCK_MODE
      });

      if (SMS_MOCK_MODE) {
        // Mock mode - just log the code (for development without AWS SNS permissions)
        Logger.warn("🔐 MOCK SMS MODE - Verification Code", {
          phone: phoneNumber,
          code: code,
          message: "Copy this code to verify the phone number"
        });

        Logger.info("SMS verification code sent successfully (MOCK MODE)", {
          phone: phoneNumber.replace(/\d(?=\d{4})/g, "*")
        });
        return;
      }

      // Real SMS mode - send via AWS SNS
      const message = `Your verification code is: ${code}. This code will expire in 10 minutes. Do not share this code with anyone.`;

      Logger.info("Attempting to send SMS via AWS SNS", {
        phone: phoneNumber.replace(/\d(?=\d{4})/g, "*"),
        message_length: message.length,
        region: AWS_REGION
      });

      const response = await snsClient.send(
        new PublishCommand({
          PhoneNumber: phoneNumber,
          Message: message,
          MessageAttributes: {
            "AWS.SNS.SMS.SenderID": {
              DataType: "String",
              StringValue: "PureBi"
            },
            "AWS.SNS.SMS.SMSType": {
              DataType: "String",
              StringValue: "Transactional"
            }
          }
        })
      );

      Logger.info("SMS verification code sent successfully via AWS SNS", {
        phone: phoneNumber.replace(/\d(?=\d{4})/g, "*"),
        message_id: response.MessageId,
        success: true
      });
    } catch (err: unknown) {
      const error = err instanceof Error ? err : new Error(String(err));
      Logger.error("Failed to send SMS", error, {
        phone: phoneNumber.replace(/\d(?=\d{4})/g, "*")
      });
      throw new AppError(
        StatusCodes.INTERNAL_SERVER_ERROR,
        "SmsSendFailed",
        "Failed to send SMS verification code. Please try again."
      );
    }
  }

  /**
   * Generate a random 6-digit verification code
   */
  public static generateVerificationCode(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }
}
