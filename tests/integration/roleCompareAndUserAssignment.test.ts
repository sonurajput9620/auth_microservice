import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { role_status_enum } from "@prisma/client";

import { createApp } from "../../src/app";
import { PermissionCatalogRepository } from "../../src/repositories/PermissionCatalogRepository";
import { RoleRepository } from "../../src/repositories/RoleRepository";
import { UserRepository } from "../../src/repositories/UserRepository";
import { managerAuthHeader, viewerAuthHeader } from "../helpers/auth";

describe("Role Compare and User Assignment Routes", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("POST /api/v1/roles/compare returns side-by-side diff matrix", async () => {
    vi.spyOn(RoleRepository.roles, "findMany").mockResolvedValue([
      {
        id: 11,
        role_uid: "role-a",
        role_name: "Operator",
        status: role_status_enum.ACTIVE
      },
      {
        id: 12,
        role_uid: "role-b",
        role_name: "Executive Viewer",
        status: role_status_enum.ACTIVE
      }
    ] as never);

    vi.spyOn(UserRepository.appUser, "groupBy").mockResolvedValue([
      { role_id: 11, _count: { _all: 5 } },
      { role_id: 12, _count: { _all: 2 } }
    ] as never);

    vi.spyOn(PermissionCatalogRepository.subFeatures, "findMany").mockResolvedValue([
      {
        sub_feature_key: "alerts-list",
        sub_feature_name: "List Alerts",
        permission_features: {
          feature_key: "alerts",
          feature_name: "Alerts"
        }
      },
      {
        sub_feature_key: "alerts-close",
        sub_feature_name: "Close Alert",
        permission_features: {
          feature_key: "alerts",
          feature_name: "Alerts"
        }
      }
    ] as never);

    vi.spyOn(RoleRepository.rolePermissions, "findMany").mockResolvedValue([
      {
        role_id: 11,
        is_enabled: true,
        permission_sub_features: { sub_feature_key: "alerts-list" }
      },
      {
        role_id: 12,
        is_enabled: false,
        permission_sub_features: { sub_feature_key: "alerts-list" }
      },
      {
        role_id: 11,
        is_enabled: true,
        permission_sub_features: { sub_feature_key: "alerts-close" }
      },
      {
        role_id: 12,
        is_enabled: true,
        permission_sub_features: { sub_feature_key: "alerts-close" }
      }
    ] as never);

    const app = createApp();
    const response = await request(app)
      .post("/api/v1/roles/compare")
      .set("Authorization", viewerAuthHeader())
      .send({ roleAId: "role-a", roleBId: "role-b" });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.roleA.assignedUsersCount).toBe(5);
    expect(response.body.data.roleB.assignedUsersCount).toBe(2);
    expect(response.body.data.matrix).toEqual([
      {
        featureId: "alerts",
        featureName: "Alerts",
        subFeatures: [
          {
            subFeatureId: "alerts-list",
            subFeatureName: "List Alerts",
            roleAEnabled: true,
            roleBEnabled: false,
            different: true
          },
          {
            subFeatureId: "alerts-close",
            subFeatureName: "Close Alert",
            roleAEnabled: true,
            roleBEnabled: true,
            different: false
          }
        ]
      }
    ]);
    expect(response.body.data.summary.differentSubFeatureCount).toBe(1);
  });

  it("PATCH /api/v1/users/:userId/role rejects assignment to non-existent role", async () => {
    vi.spyOn(UserRepository.appUser, "findUnique").mockResolvedValue({ id: 77 } as never);
    vi.spyOn(RoleRepository.roles, "findFirst").mockResolvedValue(null as never);

    const app = createApp();
    const response = await request(app)
      .patch("/api/v1/users/77/role")
      .set("Authorization", managerAuthHeader())
      .send({ roleId: "missing-role" });

    expect(response.status).toBe(404);
    expect(response.body.errorCode).toBe("ROLE_NOT_FOUND");
  });

  it("PATCH /api/v1/users/:userId/role rejects assignment to inactive role", async () => {
    vi.spyOn(UserRepository.appUser, "findUnique").mockResolvedValue({ id: 77 } as never);
    vi.spyOn(RoleRepository.roles, "findFirst").mockResolvedValue({
      id: 9,
      status: role_status_enum.INACTIVE
    } as never);

    const app = createApp();
    const response = await request(app)
      .patch("/api/v1/users/77/role")
      .set("Authorization", managerAuthHeader())
      .send({ roleId: "inactive-role" });

    expect(response.status).toBe(400);
    expect(response.body.errorCode).toBe("ROLE_INACTIVE");
  });
});
