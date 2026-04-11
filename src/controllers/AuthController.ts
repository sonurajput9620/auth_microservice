import { Request, Response } from "express";

import { AuthService } from "../services/AuthService";
import { ApiResponse } from "../utils/ApiResponse";
import { Logger } from "../utils/Logger";
import {
  approveRegistrationSchema,
  confirmForgotPasswordSchema,
  confirmSignUpSchema,
  forgotPasswordSchema,
  listRegistrationsQuerySchema,
  loginInitiateSchema,
  resendLoginOtpSchema,
  signUpSchema,
  usernameAvailabilitySchema,
  verifyLoginOtpSchema
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
    Logger.debug("Login initiation started", { email: payload.email });

    const data = await AuthService.initiateLogin(payload);

    Logger.info("Custom login OTP required", {
      email: payload.email,
      challenge_id: data.challenge_id
    });

    ApiResponse.ok(res, "OTP sent to your email.", data);
  }

  public static async verifyLoginOtp(req: Request, res: Response): Promise<void> {
    const payload = verifyLoginOtpSchema.parse(req.body);
    Logger.debug("Login OTP verification initiated", {
      email: payload.email,
      challenge_id: payload.challenge_id
    });

    const data = await AuthService.verifyLoginOtp(payload);

    Logger.info("Login OTP verified successfully", {
      email: payload.email
    });

    ApiResponse.ok(res, "Login successful.", data);
  }

  public static async resendLoginOtp(req: Request, res: Response): Promise<void> {
    const payload = resendLoginOtpSchema.parse(req.body);
    Logger.debug("Resend login OTP initiated", {
      email: payload.email,
      challenge_id: payload.challenge_id
    });

    const data = await AuthService.resendLoginOtp(payload);

    Logger.info("Login OTP resent successfully", {
      email: payload.email,
      challenge_id: payload.challenge_id
    });

    ApiResponse.ok(res, "A new OTP has been sent.", data);
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
