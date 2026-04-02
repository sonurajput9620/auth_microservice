import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createApp } from "../../src/app";
import { PermissionCatalogRepository } from "../../src/repositories/PermissionCatalogRepository";
import { viewerAuthHeader } from "../helpers/auth";

describe("Permission Catalog Routes", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("GET /api/v1/permission-catalog returns active catalog in contract shape", async () => {
    const findManySpy = vi.spyOn(PermissionCatalogRepository.features, "findMany").mockResolvedValue([
      {
        feature_group: "Administration",
        feature_key: "users-roles",
        feature_name: "Users & Roles",
        feature_description: "User and role management",
        is_system_feature: true,
        is_active: true,
        permission_sub_features: [
          {
            sub_feature_key: "users-edit-role",
            sub_feature_name: "Edit Role",
            sub_feature_description: "Edit existing roles",
            is_active: true
          }
        ]
      }
    ] as never);

    const app = createApp();
    const response = await request(app)
      .get("/api/v1/permission-catalog")
      .set("Authorization", viewerAuthHeader());

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data).toEqual({
      features: [
        {
          featureGroup: "Administration",
          featureId: "users-roles",
          featureName: "Users & Roles",
          featureDescription: "User and role management",
          isSystemFeature: true,
          isActive: true,
          subFeatures: [
            {
              subFeatureId: "users-edit-role",
              subFeatureName: "Edit Role",
              subFeatureDescription: "Edit existing roles",
              isActive: true
            }
          ]
        }
      ]
    });

    expect(findManySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { is_active: true },
        orderBy: [
          { feature_group: "asc" },
          { sort_order: "asc" },
          { feature_name: "asc" }
        ]
      })
    );
  });

  it("GET /api/v1/permission-catalog/export?format=json returns json attachment", async () => {
    vi.spyOn(PermissionCatalogRepository.features, "findMany").mockResolvedValue([
      {
        feature_group: "Monitoring",
        feature_key: "pulse",
        feature_name: "Pulse",
        feature_description: "Live KPI",
        is_system_feature: false,
        is_active: true,
        permission_sub_features: [
          {
            sub_feature_key: "pulse-kpi",
            sub_feature_name: "KPI",
            sub_feature_description: "View KPI",
            is_active: true
          }
        ]
      }
    ] as never);

    const app = createApp();
    const response = await request(app)
      .get("/api/v1/permission-catalog/export?format=json")
      .set("Authorization", viewerAuthHeader());

    expect(response.status).toBe(200);
    expect(response.header["content-type"]).toContain("application/json");
    expect(response.header["content-disposition"]).toContain("permission-catalog.json");
    expect(response.body).toEqual({
      features: [
        {
          featureGroup: "Monitoring",
          featureId: "pulse",
          featureName: "Pulse",
          featureDescription: "Live KPI",
          isSystemFeature: false,
          isActive: true,
          subFeatures: [
            {
              subFeatureId: "pulse-kpi",
              subFeatureName: "KPI",
              subFeatureDescription: "View KPI",
              isActive: true
            }
          ]
        }
      ]
    });
  });

  it("GET /api/v1/permission-catalog/export?format=csv returns csv attachment", async () => {
    vi.spyOn(PermissionCatalogRepository.features, "findMany").mockResolvedValue([
      {
        feature_group: "Operations",
        feature_key: "alerts",
        feature_name: "Alerts",
        feature_description: "Alert operations",
        is_system_feature: true,
        is_active: true,
        permission_sub_features: [
          {
            sub_feature_key: "alerts-create",
            sub_feature_name: "Create Alert",
            sub_feature_description: "Create alerts",
            is_active: true
          }
        ]
      }
    ] as never);

    const app = createApp();
    const response = await request(app)
      .get("/api/v1/permission-catalog/export?format=csv")
      .set("Authorization", viewerAuthHeader());

    expect(response.status).toBe(200);
    expect(response.header["content-type"]).toContain("text/csv");
    expect(response.header["content-disposition"]).toContain("permission-catalog.csv");

    const csv = response.text;
    expect(csv).toContain("featureGroup,featureId,featureName");
    expect(csv).toContain("Operations,alerts,Alerts,Alert operations,true,true,alerts-create,Create Alert,Create alerts,true");
  });

  it("GET /api/v1/permission-catalog/export with invalid format returns validation error", async () => {
    const app = createApp();
    const response = await request(app)
      .get("/api/v1/permission-catalog/export?format=xml")
      .set("Authorization", viewerAuthHeader());

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.errorCode).toBe("ValidationError");
  });
});
