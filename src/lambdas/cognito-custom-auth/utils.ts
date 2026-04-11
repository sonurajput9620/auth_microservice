import { randomUUID } from "node:crypto";

export const createChallengeId = (): string => randomUUID();

export const buildMetadata = (challengeId: string): string => `EMAIL_OTP:${challengeId}`;

export const parseMetadata = (value?: string): { type: string; challengeId: string } | null => {
  if (!value) {
    return null;
  }

  const [type, challengeId] = value.split(":");
  if (!type || !challengeId) {
    return null;
  }

  return { type, challengeId };
};
