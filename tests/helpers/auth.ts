const toBase64Url = (value: string): string =>
  Buffer.from(value, "utf8")
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");

export const buildBearerToken = (payload: Record<string, unknown>): string => {
  const header = { alg: "none", typ: "JWT" };
  return `${toBase64Url(JSON.stringify(header))}.${toBase64Url(JSON.stringify(payload))}.test-signature`;
};

export const viewerAuthHeader = (): string =>
  `Bearer ${buildBearerToken({
    sub: "viewer-user",
    role: "viewer",
    permissions: ["role-management.view", "roles.read"]
  })}`;

export const managerAuthHeader = (): string =>
  `Bearer ${buildBearerToken({
    sub: "manager-user",
    role: "manager",
    permissions: ["role-management.manage", "roles.write", "role-management.view", "roles.read"]
  })}`;

export const adminAuthHeader = (): string =>
  `Bearer ${buildBearerToken({
    sub: "admin-user",
    role: "administrator",
    permissions: []
  })}`;
