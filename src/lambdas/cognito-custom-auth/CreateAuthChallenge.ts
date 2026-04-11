import { otpGateway } from "./OtpGateway";
import type { CreateAuthChallengeEvent } from "./types";
import { buildMetadata, createChallengeId, parseMetadata } from "./utils";

export const handler = async (
  event: CreateAuthChallengeEvent
): Promise<CreateAuthChallengeEvent> => {
  event.response.publicChallengeParameters = {};
  event.response.privateChallengeParameters = {};

  if (event.request.challengeName !== "CUSTOM_CHALLENGE") {
    return event;
  }

  const email = event.request.userAttributes.email?.trim().toLowerCase();
  if (!email) {
    throw new Error("email attribute is required for custom challenge.");
  }

  const lastCustomChallenge = [...(event.request.session ?? [])]
    .reverse()
    .find((entry) => entry.challengeName === "CUSTOM_CHALLENGE");

  const parsedMetadata = parseMetadata(lastCustomChallenge?.challengeMetadata);
  const shouldReuseChallenge = Boolean(
    lastCustomChallenge?.challengeResult === false && parsedMetadata?.challengeId
  );

  const challengeId = shouldReuseChallenge
    ? parsedMetadata!.challengeId
    : createChallengeId();

  if (!shouldReuseChallenge) {
    const created = await otpGateway.createOtp(email, challengeId);

    event.response.publicChallengeParameters = {
      challengeId: created.challengeId,
      destination: created.destination,
      deliveryMedium: "EMAIL",
      expiresIn: String(created.expiresIn),
      maxAttempts: String(created.maxAttempts)
    };
  } else {
    event.response.publicChallengeParameters = {
      challengeId,
      destination: email,
      deliveryMedium: "EMAIL",
      expiresIn: "300",
      maxAttempts: "3"
    };
  }

  event.response.privateChallengeParameters = {
    challengeId,
    email
  };

  event.response.challengeMetadata = buildMetadata(challengeId);
  return event;
};
