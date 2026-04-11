import { z } from "zod";

export const signUpSchema = z.object({
  username: z.string().min(3),
  first_name: z.string().min(1),
  last_name: z.string().min(1),
  email: z.string().email(),
  phone: z.string().min(8),
  password: z.string().min(8)
});

export const usernameAvailabilitySchema = z.object({
  username: z.string().min(3)
});

export const confirmSignUpSchema = z.object({
  username: z.string().min(3),
  confirmation_code: z.string().min(4)
});

export const approveRegistrationSchema = z.object({
  action: z.enum(["APPROVE", "REJECT"]),
  review_note: z.string().min(1).optional(),
  role_id: z.union([z.number().int().positive(), z.string().min(1)]).optional(),
  site_id: z.number().int().positive().optional(),
  corporation_id: z.number().int().positive().optional(),
  approved_by: z.number().int().positive().optional()
}).superRefine((data, ctx) => {
  if (data.action === "APPROVE") {
    if (!data.role_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "role_id is required for APPROVE.",
        path: ["role_id"]
      });
    }
    if (!data.site_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "site_id is required for APPROVE.",
        path: ["site_id"]
      });
    }
    if (!data.corporation_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "corporation_id is required for APPROVE.",
        path: ["corporation_id"]
      });
    }
  }
});

export const listRegistrationsQuerySchema = z.object({
  status: z.enum(["PENDING_APPROVAL", "APPROVED", "REJECTED"]).optional()
});

export const loginInitiateSchema = z.object({
  username: z.string().min(3),
  password: z.string().min(8)
});

export const loginRespondSchema = z.object({
  username: z.string().min(3),
  session: z.string().min(1),
  challenge_name: z.enum(["CUSTOM_EMAIL_OTP", "EMAIL_OTP"]),
  challenge_code: z.string().trim().regex(/^\d{6}$/, "challenge_code must be a 6 digit OTP")
});

export const loginResendSchema = z.object({
  username: z.string().min(3),
  session: z.string().min(1)
});

export const forgotPasswordSchema = z.object({
  username: z.string().min(3)
});

export const confirmForgotPasswordSchema = z.object({
  username: z.string().min(3),
  confirmation_code: z.string().min(4),
  new_password: z.string().min(8)
});

export type SignUpPayload = z.infer<typeof signUpSchema>;
export type UsernameAvailabilityPayload = z.infer<typeof usernameAvailabilitySchema>;
export type ConfirmSignUpPayload = z.infer<typeof confirmSignUpSchema>;
export type ApproveRegistrationPayload = z.infer<typeof approveRegistrationSchema>;
export type ListRegistrationsQuery = z.infer<typeof listRegistrationsQuerySchema>;
export type LoginInitiatePayload = z.infer<typeof loginInitiateSchema>;
export type LoginRespondPayload = z.infer<typeof loginRespondSchema>;
export type LoginResendPayload = z.infer<typeof loginResendSchema>;
export type ForgotPasswordPayload = z.infer<typeof forgotPasswordSchema>;
export type ConfirmForgotPasswordPayload = z.infer<typeof confirmForgotPasswordSchema>;
