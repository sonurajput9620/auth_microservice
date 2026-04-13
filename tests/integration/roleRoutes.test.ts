import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { role_status_enum, role_type_enum } from "@prisma/client";

import { createApp } from "../../src/app";
import { PermissionCatalogRepository } from "../../src/repositories/PermissionCatalogRepository";
import { RoleRepository } from "../../src/repositories/RoleRepository";
import { UserRepository } from "../../src/repositories/UserRepository";
import { managerAuthHeader, viewerAuthHeader } from "../helpers/auth";

const activeSubFeatures = [
  {
    id: 1,
    sub_feature_key: "users-edit-role",
    sort_order: 1,
    sub_feature_name: "Edit Role",
    permission_features: {
      feature_key: "users-roles",
      feature_group: "Administration",
      sort_order: 1,
      feature_name: "Users & Roles"
    }
  },
  {
    id: 2,
    sub_feature_key: "alerts-create",
    sort_order: 1,
    sub_feature_name: "Create Alert",
    permission_features: {
      feature_key: "alerts",
      feature_group: "Operations",
      sort_order: 2,
      feature_name: "Alerts"
    }
  }
];

const groupedPermissionRows = [
  {
    role_id: 101,
    is_enabled: true,
    permission_sub_features: {
      sub_feature_key: "users-edit-role",
      sort_order: 1,
      sub_feature_name: "Edit Role",
      permission_features: {
        feature_key: "users-roles",
        feature_group: "Administration",
        sort_order: 1,
        feature_name: "Users & Roles"
      }
    }
  },
  {
    role_id: 101,
    is_enabled: false,
    permission_sub_features: {
      sub_feature_key: "alerts-create",
      sort_order: 1,
      sub_feature_name: "Create Alert",
      permission_features: {
        feature_key: "alerts",
        feature_group: "Operations",
        sort_order: 2,
        feature_name: "Alerts"
      }
    }
  }
];

describe("Role Routes", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("POST /api/v1/roles creates role and returns feature-grouped permissions", async () => {
    vi.spyOn(RoleRepository.prisma, "$queryRaw").mockResolvedValue([] as never);
    vi.spyOn(PermissionCatalogRepository.subFeatures, "findMany").mockResolvedValue(activeSubFeatures as never);
    vi.spyOn(RoleRepository.roles, "create").mockResolvedValue({
      id: 101,
      role_uid: "d8a7bb2e-8407-4e59-9a88-5f6832ec7701"
    } as never);
    vi.spyOn(RoleRepository.rolePermissions, "createMany").mockResolvedValue({ count: 2 } as never);
    vi.spyOn(RoleRepository.roles, "findFirst").mockResolvedValue({
      id: 101,
      role_uid: "d8a7bb2e-8407-4e59-9a88-5f6832ec7701",
      role_name: "Site Supervisor",
      role_description: "Role for site supervisors",
      role_category: "Operations",
      role_type: role_type_enum.CUSTOM,
      status: role_status_enum.ACTIVE,
      updated_at: new Date("2026-04-01T10:00:00.000Z")
    } as never);
    vi.spyOn(UserRepository.appUser, "count").mockResolvedValue(0 as never);
    vi.spyOn(RoleRepository.rolePermissions, "findMany").mockResolvedValue(groupedPermissionRows as never);

    const app = createApp();
    const response = await request(app)
      .post("/api/v1/roles")
      .set("Authorization", managerAuthHeader())
      .send({
        roleName: "Site Supervisor",
        roleDescription: "Role for site supervisors",
        roleCategory: "Operations",
        status: "Active",
        permissions: [
          {
            featureId: "users-roles",
            subFeatures: [{ subFeatureId: "users-edit-role", enabled: true }]
          }
        ]
      });

    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);
    expect(response.body.data.roleName).toBe("Site Supervisor");
    expect(response.body.data.permissions).toEqual([
      {
        featureId: "users-roles",
        enabled: true,
        subFeatures: [{ subFeatureId: "users-edit-role", enabled: true }]
      },
      {
        featureId: "alerts",
        enabled: false,
        subFeatures: [{ subFeatureId: "alerts-create", enabled: false }]
      }
    ]);
  });

  it("PUT /api/v1/roles/:roleId updates role and permissions", async () => {
    vi.spyOn(RoleRepository.roles, "findFirst")
      .mockResolvedValueOnce({ id: 101 } as never)
      .mockResolvedValueOnce({
        id: 101,
        role_uid: "d8a7bb2e-8407-4e59-9a88-5f6832ec7701",
        role_name: "Site Supervisor Updated",
        role_description: "Updated description",
        role_category: "Operations",
        role_type: role_type_enum.CUSTOM,
        status: role_status_enum.INACTIVE,
        updated_at: new Date("2026-04-01T11:00:00.000Z")
      } as never);

    vi.spyOn(RoleRepository.prisma, "$queryRaw").mockResolvedValue([] as never);
    vi.spyOn(PermissionCatalogRepository.subFeatures, "findMany").mockResolvedValue(activeSubFeatures as never);
    vi.spyOn(RoleRepository.roles, "update").mockResolvedValue({} as never);
    vi.spyOn(RoleRepository.rolePermissions, "deleteMany").mockResolvedValue({ count: 2 } as never);
    vi.spyOn(RoleRepository.rolePermissions, "createMany").mockResolvedValue({ count: 2 } as never);
    vi.spyOn(UserRepository.appUser, "count").mockResolvedValue(0 as never);
    vi.spyOn(RoleRepository.rolePermissions, "findMany").mockResolvedValue([
      {
        role_id: 101,
        is_enabled: false,
        permission_sub_features: {
          sub_feature_key: "users-edit-role",
          sort_order: 1,
          sub_feature_name: "Edit Role",
          permission_features: {
            feature_key: "users-roles",
            feature_group: "Administration",
            sort_order: 1,
            feature_name: "Users & Roles"
          }
        }
      },
      {
        role_id: 101,
        is_enabled: true,
        permission_sub_features: {
          sub_feature_key: "alerts-create",
          sort_order: 1,
          sub_feature_name: "Create Alert",
          permission_features: {
            feature_key: "alerts",
            feature_group: "Operations",
            sort_order: 2,
            feature_name: "Alerts"
          }
        }
      }
    ] as never);

    const app = createApp();
    const response = await request(app)
      .put("/api/v1/roles/d8a7bb2e-8407-4e59-9a88-5f6832ec7701")
      .set("Authorization", managerAuthHeader())
      .send({
        roleName: "Site Supervisor Updated",
        roleDescription: "Updated description",
        roleCategory: "Operations",
        status: "Inactive",
        permissions: [
          {
            featureId: "alerts",
            subFeatures: [{ subFeatureId: "alerts-create", enabled: true }]
          }
        ]
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.status).toBe("Inactive");
  });

  it("POST /api/v1/roles/:roleId/duplicate duplicates role", async () => {
    vi.spyOn(RoleRepository.roles, "findFirst")
      .mockResolvedValueOnce({
        id: 101,
        role_name: "Operator",
        role_description: "Operational access",
        role_category: "Operations",
        status: role_status_enum.ACTIVE
      } as never)
      .mockResolvedValueOnce({
        id: 102,
        role_uid: "f4a7a4dd-b9f8-4f20-8101-6e4788d2a299",
        role_name: "Operator (Copy)",
        role_description: "Operational access",
        role_category: "Operations",
        role_type: role_type_enum.CUSTOM,
        status: role_status_enum.ACTIVE,
        updated_at: new Date("2026-04-01T12:00:00.000Z")
      } as never);

    vi.spyOn(RoleRepository.prisma, "$queryRaw").mockResolvedValue([] as never);
    vi.spyOn(RoleRepository.rolePermissions, "findMany")
      .mockResolvedValueOnce([
        { sub_feature_id: 1, is_enabled: true },
        { sub_feature_id: 2, is_enabled: false }
      ] as never)
      .mockResolvedValueOnce([
        {
          role_id: 102,
          is_enabled: true,
          permission_sub_features: {
            sub_feature_key: "users-edit-role",
            sort_order: 1,
            sub_feature_name: "Edit Role",
            permission_features: {
              feature_key: "users-roles",
              feature_group: "Administration",
              sort_order: 1,
              feature_name: "Users & Roles"
            }
          }
        }
      ] as never);

    vi.spyOn(RoleRepository.roles, "create").mockResolvedValue({
      id: 102,
      role_uid: "f4a7a4dd-b9f8-4f20-8101-6e4788d2a299"
    } as never);
    vi.spyOn(RoleRepository.rolePermissions, "createMany").mockResolvedValue({ count: 2 } as never);
    vi.spyOn(UserRepository.appUser, "count").mockResolvedValue(0 as never);

    const app = createApp();
    const response = await request(app)
      .post("/api/v1/roles/d8a7bb2e-8407-4e59-9a88-5f6832ec7701/duplicate")
      .set("Authorization", managerAuthHeader())
      .send({ nameSuffix: " (Copy)" });

    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);
    expect(response.body.data.roleName).toBe("Operator (Copy)");
  });

  it("DELETE /api/v1/roles/:roleId rejects deletion for system role", async () => {
    vi.spyOn(RoleRepository.roles, "findFirst").mockResolvedValue({
      id: 1,
      role_type: role_type_enum.SYSTEM
    } as never);

    const app = createApp();
    const response = await request(app)
      .delete("/api/v1/roles/system-role")
      .set("Authorization", managerAuthHeader());

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.errorCode).toBe("ROLE_DELETE_SYSTEM_FORBIDDEN");
  });

  it("DELETE /api/v1/roles/:roleId rejects deletion when active users are assigned", async () => {
    vi.spyOn(RoleRepository.roles, "findFirst").mockResolvedValue({
      id: 2,
      role_type: role_type_enum.CUSTOM
    } as never);
    vi.spyOn(UserRepository.appUser, "count").mockResolvedValue(4 as never);

    const app = createApp();
    const response = await request(app)
      .delete("/api/v1/roles/custom-role")
      .set("Authorization", managerAuthHeader());

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.errorCode).toBe("ROLE_DELETE_ASSIGNED_USERS");
  });

  it("GET /api/v1/roles allowed for viewer permission", async () => {
    vi.spyOn(RoleRepository.roles, "findMany").mockResolvedValue([] as never);
    const app = createApp();
    const response = await request(app)
      .get("/api/v1/roles")
      .set("Authorization", viewerAuthHeader());

    expect(response.status).toBe(200);
  });

  it("POST /api/v1/roles/permissions returns a flat permission array for a numeric role id", async () => {
    vi.spyOn(RoleRepository.roles, "findFirst").mockResolvedValue({
      id: 101,
      status: role_status_enum.ACTIVE
    } as never);
    vi.spyOn(RoleRepository.rolePermissions, "findMany").mockResolvedValue(groupedPermissionRows as never);

    const app = createApp();
    const response = await request(app)
      .post("/api/v1/roles/permissions")
      .set("Authorization", viewerAuthHeader())
      .send({ roleId: 101 });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data).toEqual(["users-edit-role"]);
  });

  it("GET /api/v1/roles/permissions returns a flat permission array for roleId query", async () => {
    vi.spyOn(RoleRepository.roles, "findFirst").mockResolvedValue({
      id: 101,
      status: role_status_enum.ACTIVE
    } as never);
    vi.spyOn(RoleRepository.rolePermissions, "findMany").mockResolvedValue(groupedPermissionRows as never);

    const app = createApp();
    const response = await request(app)
      .get("/api/v1/roles/permissions")
      .query({ roleId: "101" })
      .set("Authorization", viewerAuthHeader());

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data).toEqual(["users-edit-role"]);
  });
});
