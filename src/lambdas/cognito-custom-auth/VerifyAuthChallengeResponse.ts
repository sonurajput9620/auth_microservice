import { otpGateway } from "./OtpGateway";
import type { VerifyAuthChallengeResponseEvent } from "./types";

export const handler = async (
  event: VerifyAuthChallengeResponseEvent
): Promise<VerifyAuthChallengeResponseEvent> => {
  event.response.answerCorrect = false;

  if (event.request.userNotFound) {
    return event;
  }

  const email = event.request.privateChallengeParameters.email?.trim().toLowerCase();
  const challengeId = event.request.privateChallengeParameters.challengeId;
  const otp = event.request.challengeAnswer?.trim();

  if (!email || !challengeId || !otp) {
    return event;
  }

  const result = await otpGateway.validateOtp(email, challengeId, otp);
  event.response.answerCorrect = result.valid;
  return event;
};
