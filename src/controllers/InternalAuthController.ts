import { Request, Response } from "express";

import { AuthService } from "../services/AuthService";
import { ApiResponse } from "../utils/ApiResponse";
import {
  internalCreateLoginOtpSchema,
  internalValidateLoginOtpSchema
} from "../validations/AuthValidation";

export class InternalAuthController {
  public static async createLoginOtp(req: Request, res: Response): Promise<void> {
    const payload = internalCreateLoginOtpSchema.parse(req.body);
    const data = await AuthService.createInternalLoginOtp(payload);

    ApiResponse.ok(res, "Internal login OTP created.", data);
  }

  public static async validateLoginOtp(req: Request, res: Response): Promise<void> {
    const payload = internalValidateLoginOtpSchema.parse(req.body);
    const data = await AuthService.validateInternalLoginOtp(payload);

    ApiResponse.ok(res, "Internal login OTP validated.", data);
  }
}
