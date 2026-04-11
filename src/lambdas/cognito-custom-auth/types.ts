export type SessionEntry = {
  challengeName: string;
  challengeResult: boolean;
  challengeMetadata?: string;
};

export type DefineAuthChallengeEvent = {
  userName: string;
  request: {
    userAttributes: Record<string, string>;
    session: SessionEntry[];
    userNotFound?: boolean;
  };
  response: {
    challengeName?: string;
    issueTokens: boolean;
    failAuthentication: boolean;
  };
};

export type CreateAuthChallengeEvent = {
  userName: string;
  request: {
    userAttributes: Record<string, string>;
    session: SessionEntry[];
    challengeName: string;
    userNotFound?: boolean;
  };
  response: {
    publicChallengeParameters: Record<string, string>;
    privateChallengeParameters: Record<string, string>;
    challengeMetadata?: string;
  };
};

export type VerifyAuthChallengeResponseEvent = {
  userName: string;
  request: {
    userAttributes: Record<string, string>;
    privateChallengeParameters: Record<string, string>;
    challengeAnswer: string;
    userNotFound?: boolean;
  };
  response: {
    answerCorrect: boolean;
  };
};
