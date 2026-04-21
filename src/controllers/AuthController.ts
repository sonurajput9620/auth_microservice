import { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";

import { prisma } from "../prismaClient";
import { AuthService } from "../services/AuthService";
import { ApiResponse } from "../utils/ApiResponse";
import { AppError } from "../utils/AppError";
import { Logger } from "../utils/Logger";
import {
  approveRegistrationSchema,
  confirmForgotPasswordSchema,
  confirmSignUpSchema,
  forgotPasswordSchema,
  listRegistrationsQuerySchema,
  loginInitiateSchema,
  loginResendSchema,
  loginRespondSchema,
  signUpSchema,
  usernameAvailabilitySchema
} from "../validations/AuthValidation";

export class AuthController {
  public static async checkUsernameAvailability(
    req: Request,
    res: Response
  ): Promise<void> {
    const payload = usernameAvailabilitySchema.parse(req.body);
    const data = await AuthService.checkUsernameAvailability(payload);

    ApiResponse.ok(
      res,
      data.available ? "Username is available." : "Username is already taken.",
      data
    );
  }

  public static async signUp(req: Request, res: Response): Promise<void> {
    const payload = signUpSchema.parse(req.body);
    Logger.debug("SignUp initiated", { username: payload.username });

    const [existingRegistration, existingAppUser] = await Promise.all([
      prisma.register_user.findUnique({
        where: { email: payload.email },
        select: { id: true }
      }),
      prisma.app_user.findFirst({
        where: { email: payload.email },
        select: { id: true }
      })
    ]);

    if (existingRegistration || existingAppUser) {
      Logger.warn("SignUp blocked because email is already registered", {
        username: payload.username,
        email: payload.email,
        source: existingRegistration ? "register_user" : "app_user"
      });

      throw new AppError(
        StatusCodes.CONFLICT,
        "UserAlreadyRegistered",
        "User already registered."
      );
    }

    const data = await AuthService.signUp(payload);

    Logger.info("User signed up successfully", {
      username: payload.username,
      user_sub: data.user_sub
    });

    ApiResponse.created(
      res,
      "Sign up initiated. Please verify email with the confirmation code.",
      data
    );
  }

  public static async confirmSignUp(req: Request, res: Response): Promise<void> {
    const payload = confirmSignUpSchema.parse(req.body);
    Logger.debug("ConfirmSignUp initiated", { username: payload.username });
    
    const data = await AuthService.confirmSignUp(payload);

    Logger.info("Email verified successfully", {
      username: payload.username,
      registration_id: data.registration_id
    });

    ApiResponse.ok(
      res,
      "Email verified. Registration is pending admin approval.",
      data
    );
  }

  public static async reviewRegistration(req: Request, res: Response): Promise<void> {
    const id = Number(req.params.id);
    const payload = approveRegistrationSchema.parse(req.body);
    Logger.debug("ReviewRegistration initiated", {
      registration_id: id,
      action: payload.action
    });

    const data = await AuthService.reviewRegistration(id, payload);

    Logger.info("Registration reviewed", {
      registration_id: id,
      action: payload.action,
      reviewed_by: payload.approved_by
    });

    ApiResponse.ok(
      res,
      payload.action === "APPROVE"
        ? "User approved successfully."
        : "User rejected successfully.",
      data
    );
  }

  public static async listRegistrations(req: Request, res: Response): Promise<void> {
    const query = listRegistrationsQuerySchema.parse(req.query);
    const data = await AuthService.listRegistrations(query);

    ApiResponse.ok(res, "Registration requests fetched successfully.", data);
  }

  public static async initiateLogin(req: Request, res: Response): Promise<void> {
    const payload = loginInitiateSchema.parse(req.body);
    Logger.debug("Login initiation started", { username: payload.username });

    const data = await AuthService.initiateLogin(payload);

    if (data.challenge_required) {
      Logger.info("Custom login OTP challenge created", {
        username: payload.username,
        challenge_name: data.challenge_name
      });
    } else {
      Logger.info("Login completed", { username: payload.username });
    }

    ApiResponse.ok(
      res,
      data.challenge_required ? "Login OTP sent." : "Login successful.",
      data
    );
  }

  public static async respondToChallenge(req: Request, res: Response): Promise<void> {
    const payload = loginRespondSchema.parse(req.body);
    Logger.debug("Challenge response initiated", {
      username: payload.username,
      challenge_name: payload.challenge_name
    });

    const data = await AuthService.respondToChallenge(payload);

    Logger.info("Login OTP verified and login successful", {
      username: payload.username
    });

    ApiResponse.ok(res, "Login OTP verified. Login successful.", data);
  }

  public static async resendLoginOtp(req: Request, res: Response): Promise<void> {
    const payload = loginResendSchema.parse(req.body);
    Logger.debug("Login OTP resend initiated", {
      username: payload.username
    });

    const data = await AuthService.resendLoginOtp(payload);

    Logger.info("Login OTP resent successfully", {
      username: payload.username
    });

    ApiResponse.ok(res, "A new login OTP has been sent.", data);
  }

  public static async forgotPassword(req: Request, res: Response): Promise<void> {
    const payload = forgotPasswordSchema.parse(req.body);
    Logger.debug("Forgot password initiated", { username: payload.username });

    const data = await AuthService.forgotPassword(payload);

    Logger.info("Password reset code sent", { username: payload.username });

    ApiResponse.ok(res, "Password reset code sent.", data);
  }

  public static async confirmForgotPassword(req: Request, res: Response): Promise<void> {
    const payload = confirmForgotPasswordSchema.parse(req.body);
    Logger.debug("Confirm forgot password initiated", { username: payload.username });

    await AuthService.confirmForgotPassword(payload);

    Logger.info("Password reset successful", { username: payload.username });

    ApiResponse.ok(res, "Password reset successful.", null);
  }

}
