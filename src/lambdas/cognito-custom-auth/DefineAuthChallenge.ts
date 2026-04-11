import type { DefineAuthChallengeEvent } from "./types";

export const handler = async (
  event: DefineAuthChallengeEvent
): Promise<DefineAuthChallengeEvent> => {
  const session = event.request.session ?? [];
  const last = session[session.length - 1];
  const failedCustomAttempts = session.filter(
    (entry) => entry.challengeName === "CUSTOM_CHALLENGE" && entry.challengeResult === false
  ).length;

  event.response.issueTokens = false;
  event.response.failAuthentication = false;
  delete event.response.challengeName;

  if (event.request.userNotFound) {
    event.response.failAuthentication = true;
    return event;
  }

  if (failedCustomAttempts >= 3) {
    event.response.failAuthentication = true;
    return event;
  }

  if (session.length === 0 || last?.challengeName === "SRP_A") {
    event.response.challengeName = "PASSWORD_VERIFIER";
    return event;
  }

  if (last?.challengeName === "PASSWORD_VERIFIER" && last.challengeResult === true) {
    event.response.challengeName = "CUSTOM_CHALLENGE";
    return event;
  }

  if (last?.challengeName === "CUSTOM_CHALLENGE" && last.challengeResult === true) {
    event.response.issueTokens = true;
    return event;
  }

  if (last?.challengeName === "CUSTOM_CHALLENGE" && last.challengeResult === false) {
    event.response.challengeName = "CUSTOM_CHALLENGE";
    return event;
  }

  event.response.failAuthentication = true;
  return event;
};
