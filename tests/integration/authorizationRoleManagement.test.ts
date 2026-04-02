import request from "supertest";
import { describe, expect, it } from "vitest";

import { createApp } from "../../src/app";
import { buildBearerToken, managerAuthHeader, viewerAuthHeader } from "../helpers/auth";

const unrelatedAuthHeader = (): string =>
  `Bearer ${buildBearerToken({
    sub: "plain-user",
    role: "user",
    permissions: ["users.read"]
  })}`;

describe("Role Management Authorization", () => {
  it("returns 401 for missing bearer token", async () => {
    const app = createApp();
    const response = await request(app).get("/api/v1/roles");

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
    expect(response.body.errorCode).toBe("UNAUTHORIZED");
  });

  it("returns 403 for role read without viewer permission", async () => {
    const app = createApp();
    const response = await request(app)
      .get("/api/v1/roles")
      .set("Authorization", unrelatedAuthHeader());

    expect(response.status).toBe(403);
    expect(response.body.success).toBe(false);
    expect(response.body.errorCode).toBe("FORBIDDEN");
  });

  it("returns 403 for role create with viewer-only permission", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/v1/roles")
      .set("Authorization", viewerAuthHeader())
      .send({
        roleName: "Should Not Create",
        roleDescription: "Forbidden",
        roleCategory: "Ops",
        status: "Active",
        permissions: []
      });

    expect(response.status).toBe(403);
    expect(response.body.success).toBe(false);
    expect(response.body.errorCode).toBe("FORBIDDEN");
  });

  it("returns 403 for import restore endpoint when caller is non-admin", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/v1/permission-catalog/restore-demo")
      .set("Authorization", managerAuthHeader());

    expect(response.status).toBe(403);
    expect(response.body.success).toBe(false);
    expect(response.body.errorCode).toBe("FORBIDDEN");
  });
});
