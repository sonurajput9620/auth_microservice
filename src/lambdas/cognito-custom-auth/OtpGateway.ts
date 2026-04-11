type CreateOtpResult = {
  challengeId: string;
  destination: string;
  expiresIn: number;
  maxAttempts: number;
};

type ValidateOtpResult = {
  valid: boolean;
};

export interface OtpGateway {
  createOtp(email: string, challengeId: string): Promise<CreateOtpResult>;
  validateOtp(email: string, challengeId: string, otp: string): Promise<ValidateOtpResult>;
}

/*
  Integration point:
  These endpoints should be protected and routed to the existing Node backend,
  which already owns Prisma access and the OTP table.
*/
export class HttpOtpGateway implements OtpGateway {
  private readonly baseUrl = process.env.INTERNAL_AUTH_BASE_URL?.replace(/\/+$/, "") ?? "";
  private readonly apiKey = process.env.INTERNAL_AUTH_API_KEY ?? "";

  private unwrapData<T>(payload: unknown): T {
    const response = payload as { success?: boolean; data?: T };
    if (response && response.success === true) {
      return response.data as T;
    }

    throw new Error("OTP gateway response did not contain a successful data payload.");
  }

  private async request<T>(path: string, body: unknown): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-internal-api-key": this.apiKey
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      throw new Error(`OTP gateway request failed with status ${response.status}`);
    }

    const payload = (await response.json()) as unknown;
    return this.unwrapData<T>(payload);
  }

  public createOtp(email: string, challengeId: string): Promise<CreateOtpResult> {
    return this.request("/api/v1/internal/auth/login-otp/create", { email, challengeId });
  }

  public validateOtp(email: string, challengeId: string, otp: string): Promise<ValidateOtpResult> {
    return this.request("/api/v1/internal/auth/login-otp/validate", { email, challengeId, otp });
  }
}

export const otpGateway: OtpGateway = new HttpOtpGateway();
