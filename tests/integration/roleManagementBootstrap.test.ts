import request from "supertest";
import { describe, expect, it } from "vitest";

import { createApp } from "../../src/app";
import { viewerAuthHeader } from "../helpers/auth";

describe("Role Management Bootstrap Route", () => {
  it("GET /api/v1/role-management/bootstrap returns schema with non-empty seed data", async () => {
    const app = createApp();
    const response = await request(app)
      .get("/api/v1/role-management/bootstrap")
      .set("Authorization", viewerAuthHeader());

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);

    const data = response.body.data;
    expect(data).toBeDefined();
    expect(Array.isArray(data.catalog.features)).toBe(true);
    expect(Array.isArray(data.roles)).toBe(true);
    expect(Array.isArray(data.templates)).toBe(true);

    expect(data.catalog.features.length).toBeGreaterThan(0);
    expect(data.roles.length).toBeGreaterThan(0);
    expect(data.templates.length).toBeGreaterThan(0);

    const firstFeature = data.catalog.features[0];
    expect(typeof firstFeature.featureId).toBe("string");
    expect(Array.isArray(firstFeature.subFeatures)).toBe(true);

    const firstRole = data.roles[0];
    expect(typeof firstRole.roleId).toBe("string");
    expect(Array.isArray(firstRole.permissions)).toBe(true);

    const firstTemplate = data.templates[0];
    expect(typeof firstTemplate.templateId).toBe("string");
    expect(Array.isArray(firstTemplate.permissions)).toBe(true);
  });
});
