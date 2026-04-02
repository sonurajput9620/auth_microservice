import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createApp } from "../../src/app";
import { PermissionCatalogRepository } from "../../src/repositories/PermissionCatalogRepository";
import { RoleTemplateRepository } from "../../src/repositories/RoleTemplateRepository";
import { managerAuthHeader, viewerAuthHeader } from "../helpers/auth";

describe("Role Template Routes", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("POST /api/v1/role-templates saves template with unique name and persists remapped permissions", async () => {
    const activeSubFeatures = [
      {
        id: 1,
        sub_feature_key: "users-list",
        sort_order: 1,
        sub_feature_name: "List Users",
        permission_features: {
          feature_key: "users-roles",
          feature_group: "Administration",
          sort_order: 1,
          feature_name: "Users & Roles"
        }
      },
      {
        id: 2,
        sub_feature_key: "users-edit-role",
        sort_order: 2,
        sub_feature_name: "Edit Role",
        permission_features: {
          feature_key: "users-roles",
          feature_group: "Administration",
          sort_order: 1,
          feature_name: "Users & Roles"
        }
      }
    ];

    vi.spyOn(RoleTemplateRepository.prisma, "$queryRaw").mockResolvedValue([] as never);
    vi.spyOn(PermissionCatalogRepository.subFeatures, "findMany").mockResolvedValue(activeSubFeatures as never);
    vi.spyOn(RoleTemplateRepository.templates, "create").mockResolvedValue({
      id: 201,
      template_uid: "3b1c1f6e-0fef-4f76-b6e8-5d084e1d2050",
      template_name: "Ops Template",
      is_active: true,
      updated_at: new Date("2026-04-01T10:00:00.000Z")
    } as never);
    vi.spyOn(RoleTemplateRepository.templatePermissions, "createMany").mockResolvedValue({ count: 2 } as never);
    vi.spyOn(RoleTemplateRepository.templates, "findFirst").mockResolvedValue({ id: 201 } as never);
    vi.spyOn(RoleTemplateRepository.templatePermissions, "findMany").mockResolvedValue([
      { sub_feature_id: 1, is_enabled: true }
    ] as never);

    const app = createApp();
    const response = await request(app)
      .post("/api/v1/role-templates")
      .set("Authorization", managerAuthHeader())
      .send({
        templateName: "Ops Template",
        permissions: [
          {
            featureId: "users-roles",
            subFeatures: [{ subFeatureId: "users-list", enabled: true }]
          }
        ]
      });

    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);
    expect(response.body.data.templateName).toBe("Ops Template");
    expect(response.body.data.permissions).toEqual([
      {
        featureId: "users-roles",
        enabled: false,
        subFeatures: [
          { subFeatureId: "users-list", enabled: true },
          { subFeatureId: "users-edit-role", enabled: false }
        ]
      }
    ]);
  });

  it("POST /api/v1/role-templates/:templateId/apply-preview remaps to active catalog and excludes inactive items", async () => {
    const activeSubFeatures = [
      {
        id: 1,
        sub_feature_key: "alerts-list",
        sort_order: 1,
        sub_feature_name: "List Alerts",
        permission_features: {
          feature_key: "alerts",
          feature_group: "Operations",
          sort_order: 2,
          feature_name: "Alerts"
        }
      },
      {
        id: 2,
        sub_feature_key: "alerts-close",
        sort_order: 2,
        sub_feature_name: "Close Alert",
        permission_features: {
          feature_key: "alerts",
          feature_group: "Operations",
          sort_order: 2,
          feature_name: "Alerts"
        }
      }
    ];

    vi.spyOn(RoleTemplateRepository.templates, "findFirst").mockResolvedValue({ id: 201 } as never);
    vi.spyOn(PermissionCatalogRepository.subFeatures, "findMany").mockResolvedValue(activeSubFeatures as never);
    vi.spyOn(RoleTemplateRepository.templatePermissions, "findMany").mockResolvedValue([
      { sub_feature_id: 1, is_enabled: true },
      { sub_feature_id: 999, is_enabled: true }
    ] as never);

    const app = createApp();
    const response = await request(app)
      .post("/api/v1/role-templates/3b1c1f6e-0fef-4f76-b6e8-5d084e1d2050/apply-preview")
      .set("Authorization", viewerAuthHeader());

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data).toEqual([
      {
        featureId: "alerts",
        enabled: false,
        subFeatures: [
          { subFeatureId: "alerts-list", enabled: true },
          { subFeatureId: "alerts-close", enabled: false }
        ]
      }
    ]);
  });
});
