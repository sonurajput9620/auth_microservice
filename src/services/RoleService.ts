import { Prisma, role_status_enum, role_type_enum } from "@prisma/client";
import { StatusCodes } from "http-status-codes";
import { randomUUID } from "node:crypto";

import { PermissionCatalogRepository } from "../repositories/PermissionCatalogRepository";
import { RoleRepository } from "../repositories/RoleRepository";
import { UserRepository } from "../repositories/UserRepository";
import { AppError } from "../utils/AppError";
import {
  CreateRolePayload,
  DuplicateRolePayload,
  RolePermissionsLookupPayload,
  UpdateRolePayload
} from "../validations/RoleValidation";

interface FlatPermissionRow {
  roleId: number;
  enabled: boolean;
  featureGroup: string;
  featureOrder: number;
  featureName: string;
  featureId: string;
  subFeatureOrder: number;
  subFeatureName: string;
  subFeatureId: string;
}

interface RolePermissionFeatureDto {
  featureId: string;
  enabled: boolean;
  subFeatures: Array<{
    subFeatureId: string;
    enabled: boolean;
  }>;
}

export interface RoleDto {
  roleId: string;
  roleName: string;
  roleDescription: string;
  roleCategory: string | null;
  roleType: "System" | "Custom";
  status: "Active" | "Inactive";
  assignedUsersCount: number;
  permissions: RolePermissionFeatureDto[];
  lastModified: string;
}

export interface RoleCompareDto {
  roleA: {
    roleId: string;
    roleName: string;
    status: "Active" | "Inactive";
    assignedUsersCount: number;
  };
  roleB: {
    roleId: string;
    roleName: string;
    status: "Active" | "Inactive";
    assignedUsersCount: number;
  };
  matrix: Array<{
    featureId: string;
    featureName: string;
    subFeatures: Array<{
      subFeatureId: string;
      subFeatureName: string;
      roleAEnabled: boolean;
      roleBEnabled: boolean;
      different: boolean;
    }>;
  }>;
  summary: {
    differentSubFeatureCount: number;
  };
}

const toApiStatus = (value: role_status_enum): "Active" | "Inactive" =>
  value === role_status_enum.ACTIVE ? "Active" : "Inactive";

const toDbStatus = (value: "Active" | "Inactive"): role_status_enum =>
  value === "Active" ? role_status_enum.ACTIVE : role_status_enum.INACTIVE;

const toApiRoleType = (value: role_type_enum): "System" | "Custom" =>
  value === role_type_enum.SYSTEM ? "System" : "Custom";

const flattenEnabledSubFeatures = (
  permissions: Array<{
    featureId: string;
    subFeatures: Array<{ subFeatureId: string; enabled: boolean }>;
  }>
): Map<string, string> => {
  const map = new Map<string, string>();

  for (const feature of permissions) {
    for (const subFeature of feature.subFeatures) {
      if (subFeature.enabled) {
        map.set(subFeature.subFeatureId, feature.featureId);
      }
    }
  }

  return map;
};

const checkRoleNameExists = async (
  roleName: string,
  excludeRoleId?: number
): Promise<boolean> => {
  const exclusion = excludeRoleId
    ? Prisma.sql`AND id <> ${excludeRoleId}`
    : Prisma.empty;

  const rows = await RoleRepository.prisma.$queryRaw<Array<{ id: number }>>(
    Prisma.sql`
      SELECT id
      FROM roles
      WHERE is_deleted = 0
        AND LOWER(role_name) = LOWER(${roleName})
        ${exclusion}
      LIMIT 1
    `
  );

  return rows.length > 0;
};

const loadActiveSubFeatures = async (): Promise<
  Array<{
    id: number;
    sub_feature_key: string;
    feature_key: string;
    feature_group: string;
    feature_sort_order: number;
    feature_name: string;
    sub_feature_sort_order: number;
    sub_feature_name: string;
  }>
> => {
  const rows = await PermissionCatalogRepository.subFeatures.findMany({
    where: {
      is_active: true,
      permission_features: {
        is_active: true
      }
    },
    select: {
      id: true,
      sub_feature_key: true,
      sort_order: true,
      sub_feature_name: true,
      permission_features: {
        select: {
          feature_key: true,
          feature_group: true,
          sort_order: true,
          feature_name: true
        }
      }
    }
  });

  return rows.map((row) => ({
    id: row.id,
    sub_feature_key: row.sub_feature_key,
    feature_key: row.permission_features.feature_key,
    feature_group: row.permission_features.feature_group,
    feature_sort_order: row.permission_features.sort_order,
    feature_name: row.permission_features.feature_name,
    sub_feature_sort_order: row.sort_order,
    sub_feature_name: row.sub_feature_name
  }));
};

const buildPermissionsByRole = (
  rows: FlatPermissionRow[]
): Map<number, RolePermissionFeatureDto[]> => {
  const groupedByRole = new Map<number, RolePermissionFeatureDto[]>();

  const sortedRows = [...rows].sort((a, b) => {
    const groupCmp = a.featureGroup.localeCompare(b.featureGroup);
    if (groupCmp !== 0) return groupCmp;
    if (a.featureOrder !== b.featureOrder) return a.featureOrder - b.featureOrder;
    const nameCmp = a.featureName.localeCompare(b.featureName);
    if (nameCmp !== 0) return nameCmp;
    if (a.subFeatureOrder !== b.subFeatureOrder) {
      return a.subFeatureOrder - b.subFeatureOrder;
    }
    return a.subFeatureName.localeCompare(b.subFeatureName);
  });

  for (const row of sortedRows) {
    const roleFeatures = groupedByRole.get(row.roleId) ?? [];
    let feature = roleFeatures.find((item) => item.featureId === row.featureId);
    if (!feature) {
      feature = {
        featureId: row.featureId,
        enabled: false,
        subFeatures: []
      };
      roleFeatures.push(feature);
      groupedByRole.set(row.roleId, roleFeatures);
    }

    feature.subFeatures.push({
      subFeatureId: row.subFeatureId,
      enabled: row.enabled
    });
  }

  for (const [, features] of groupedByRole) {
    for (const feature of features) {
      feature.enabled =
        feature.subFeatures.length > 0 &&
        feature.subFeatures.every((subFeature) => subFeature.enabled);
    }
  }

  return groupedByRole;
};

const mapRoleDto = (
  role: {
    id: number;
    role_uid: string;
    role_name: string;
    role_description: string;
    role_category: string | null;
    role_type: role_type_enum;
    status: role_status_enum;
    updated_at: Date;
  },
  assignedUsersCount: number,
  permissions: RolePermissionFeatureDto[]
): RoleDto => ({
  roleId: role.role_uid,
  roleName: role.role_name,
  roleDescription: role.role_description,
  roleCategory: role.role_category,
  roleType: toApiRoleType(role.role_type),
  status: toApiStatus(role.status),
  assignedUsersCount,
  permissions,
  lastModified: role.updated_at.toISOString()
});

export class RoleService {
  public static async getRoles(includePermissions: boolean): Promise<RoleDto[]> {
    const roles = await RoleRepository.roles.findMany({
      where: {
        is_deleted: false
      },
      orderBy: [{ role_name: "asc" }],
      select: {
        id: true,
        role_uid: true,
        role_name: true,
        role_description: true,
        role_category: true,
        role_type: true,
        status: true,
        updated_at: true
      }
    });

    if (roles.length === 0) {
      return [];
    }

    const roleIds = roles.map((role) => role.id);

    const assignedCounts = await UserRepository.appUser.groupBy({
      by: ["role_id"],
      where: {
        role_id: { in: roleIds },
        status: true
      },
      _count: {
        _all: true
      }
    });

    const assignedCountMap = new Map<number, number>();
    for (const row of assignedCounts) {
      if (row.role_id) {
        assignedCountMap.set(row.role_id, row._count._all);
      }
    }

    let permissionsMap = new Map<number, RolePermissionFeatureDto[]>();
    if (includePermissions) {
      const permissionRows = await RoleRepository.rolePermissions.findMany({
        where: {
          role_id: { in: roleIds },
          permission_sub_features: {
            is_active: true,
            permission_features: {
              is_active: true
            }
          }
        },
        select: {
          role_id: true,
          is_enabled: true,
          permission_sub_features: {
            select: {
              sub_feature_key: true,
              sort_order: true,
              sub_feature_name: true,
              permission_features: {
                select: {
                  feature_key: true,
                  feature_group: true,
                  sort_order: true,
                  feature_name: true
                }
              }
            }
          }
        }
      });

      permissionsMap = buildPermissionsByRole(
        permissionRows.map((row) => ({
          roleId: row.role_id,
          enabled: row.is_enabled,
          featureGroup: row.permission_sub_features.permission_features.feature_group,
          featureOrder: row.permission_sub_features.permission_features.sort_order,
          featureName: row.permission_sub_features.permission_features.feature_name,
          featureId: row.permission_sub_features.permission_features.feature_key,
          subFeatureOrder: row.permission_sub_features.sort_order,
          subFeatureName: row.permission_sub_features.sub_feature_name,
          subFeatureId: row.permission_sub_features.sub_feature_key
        }))
      );
    }

    return roles.map((role) =>
      mapRoleDto(
        role,
        assignedCountMap.get(role.id) ?? 0,
        includePermissions ? permissionsMap.get(role.id) ?? [] : []
      )
    );
  }

  public static async getRoleById(roleId: string): Promise<RoleDto> {
    const role = await RoleRepository.roles.findFirst({
      where: {
        role_uid: roleId,
        is_deleted: false
      },
      select: {
        id: true,
        role_uid: true,
        role_name: true,
        role_description: true,
        role_category: true,
        role_type: true,
        status: true,
        updated_at: true
      }
    });

    if (!role) {
      throw new AppError(StatusCodes.NOT_FOUND, "ROLE_NOT_FOUND", "Role not found.");
    }

    const [assignedUsersCount, permissionRows] = await Promise.all([
      UserRepository.appUser.count({
        where: {
          role_id: role.id,
          status: true
        }
      }),
      RoleRepository.rolePermissions.findMany({
        where: {
          role_id: role.id,
          permission_sub_features: {
            is_active: true,
            permission_features: {
              is_active: true
            }
          }
        },
        select: {
          role_id: true,
          is_enabled: true,
          permission_sub_features: {
            select: {
              sub_feature_key: true,
              sort_order: true,
              sub_feature_name: true,
              permission_features: {
                select: {
                  feature_key: true,
                  feature_group: true,
                  sort_order: true,
                  feature_name: true
                }
              }
            }
          }
        }
      })
    ]);

    const permissionMap = buildPermissionsByRole(
      permissionRows.map((row) => ({
        roleId: row.role_id,
        enabled: row.is_enabled,
        featureGroup: row.permission_sub_features.permission_features.feature_group,
        featureOrder: row.permission_sub_features.permission_features.sort_order,
        featureName: row.permission_sub_features.permission_features.feature_name,
        featureId: row.permission_sub_features.permission_features.feature_key,
        subFeatureOrder: row.permission_sub_features.sort_order,
        subFeatureName: row.permission_sub_features.sub_feature_name,
        subFeatureId: row.permission_sub_features.sub_feature_key
      }))
    );

    return mapRoleDto(role, assignedUsersCount, permissionMap.get(role.id) ?? []);
  }

  public static async getPermissionsByRoleId(
    roleId: RolePermissionsLookupPayload["roleId"]
  ): Promise<string[]> {
    const role = await RoleRepository.roles.findFirst({
      where: {
        id: roleId,
        is_deleted: false
      },
      select: {
        id: true,
        status: true
      }
    });

    if (!role) {
      throw new AppError(StatusCodes.NOT_FOUND, "ROLE_NOT_FOUND", "Role not found.");
    }

    const permissionRows = await RoleRepository.rolePermissions.findMany({
      where: {
        role_id: role.id,
        permission_sub_features: {
          is_active: true,
          permission_features: {
            is_active: true
          }
        }
      },
      select: {
        role_id: true,
        is_enabled: true,
        permission_sub_features: {
          select: {
            sub_feature_key: true,
            sort_order: true,
            sub_feature_name: true,
            permission_features: {
              select: {
                feature_key: true,
                feature_group: true,
                sort_order: true,
                feature_name: true
              }
            }
          }
        }
      }
    });

    if (role.status !== role_status_enum.ACTIVE) {
      return [];
    }

    return Array.from(
      new Set(
        permissionRows
          .filter((row) => row.is_enabled)
          .map((row) => row.permission_sub_features.sub_feature_key)
      )
    ).sort((left, right) => left.localeCompare(right));
  }

  public static async createRole(payload: CreateRolePayload): Promise<RoleDto> {
    if (await checkRoleNameExists(payload.roleName)) {
      throw new AppError(
        StatusCodes.CONFLICT,
        "ROLE_NAME_EXISTS",
        "Role name already exists."
      );
    }

    const activeSubFeatures = await loadActiveSubFeatures();
    const activeSubFeatureMap = new Map(
      activeSubFeatures.map((item) => [item.sub_feature_key, item])
    );
    const enabledBySubFeature = flattenEnabledSubFeatures(payload.permissions);

    for (const [subFeatureId, featureId] of enabledBySubFeature) {
      const existing = activeSubFeatureMap.get(subFeatureId);
      if (!existing || existing.feature_key !== featureId) {
        throw new AppError(
          StatusCodes.BAD_REQUEST,
          "INVALID_PERMISSION_REFERENCE",
          `Invalid permission reference: ${subFeatureId}`
        );
      }
    }

    const role = await RoleRepository.roles.create({
      data: {
        role_uid: randomUUID(),
        role_name: payload.roleName.trim(),
        role_description: payload.roleDescription,
        role_category: payload.roleCategory ?? null,
        role_type: role_type_enum.CUSTOM,
        status: toDbStatus(payload.status),
        is_deleted: false
      }
    });

    await RoleRepository.rolePermissions.createMany({
      data: activeSubFeatures.map((subFeature) => ({
        role_id: role.id,
        sub_feature_id: subFeature.id,
        is_enabled: enabledBySubFeature.has(subFeature.sub_feature_key)
      }))
    });

    return this.getRoleById(role.role_uid);
  }

  public static async updateRole(
    roleId: string,
    payload: UpdateRolePayload
  ): Promise<RoleDto> {
    const existingRole = await RoleRepository.roles.findFirst({
      where: {
        role_uid: roleId,
        is_deleted: false
      },
      select: {
        id: true
      }
    });

    if (!existingRole) {
      throw new AppError(StatusCodes.NOT_FOUND, "ROLE_NOT_FOUND", "Role not found.");
    }

    if (await checkRoleNameExists(payload.roleName, existingRole.id)) {
      throw new AppError(
        StatusCodes.CONFLICT,
        "ROLE_NAME_EXISTS",
        "Role name already exists."
      );
    }

    const activeSubFeatures = await loadActiveSubFeatures();
    const activeSubFeatureMap = new Map(
      activeSubFeatures.map((item) => [item.sub_feature_key, item])
    );
    const enabledBySubFeature = flattenEnabledSubFeatures(payload.permissions);

    for (const [subFeatureId, featureId] of enabledBySubFeature) {
      const existing = activeSubFeatureMap.get(subFeatureId);
      if (!existing || existing.feature_key !== featureId) {
        throw new AppError(
          StatusCodes.BAD_REQUEST,
          "INVALID_PERMISSION_REFERENCE",
          `Invalid permission reference: ${subFeatureId}`
        );
      }
    }

    await RoleRepository.roles.update({
      where: { id: existingRole.id },
      data: {
        role_name: payload.roleName.trim(),
        role_description: payload.roleDescription,
        role_category: payload.roleCategory ?? null,
        status: toDbStatus(payload.status),
        deleted_at: null
      }
    });

    await RoleRepository.rolePermissions.deleteMany({
      where: {
        role_id: existingRole.id
      }
    });

    await RoleRepository.rolePermissions.createMany({
      data: activeSubFeatures.map((subFeature) => ({
        role_id: existingRole.id,
        sub_feature_id: subFeature.id,
        is_enabled: enabledBySubFeature.has(subFeature.sub_feature_key)
      }))
    });

    return this.getRoleById(roleId);
  }

  public static async deleteRole(roleId: string): Promise<void> {
    const role = await RoleRepository.roles.findFirst({
      where: {
        role_uid: roleId,
        is_deleted: false
      },
      select: {
        id: true,
        role_type: true
      }
    });

    if (!role) {
      throw new AppError(StatusCodes.NOT_FOUND, "ROLE_NOT_FOUND", "Role not found.");
    }

    if (role.role_type === role_type_enum.SYSTEM) {
      throw new AppError(
        StatusCodes.BAD_REQUEST,
        "ROLE_DELETE_SYSTEM_FORBIDDEN",
        "System role cannot be deleted."
      );
    }

    const assignedUsers = await UserRepository.appUser.count({
      where: {
        role_id: role.id,
        status: true
      }
    });

    if (assignedUsers > 0) {
      throw new AppError(
        StatusCodes.BAD_REQUEST,
        "ROLE_DELETE_ASSIGNED_USERS",
        "Role cannot be deleted because active users are assigned."
      );
    }

    await RoleRepository.roles.update({
      where: {
        id: role.id
      },
      data: {
        is_deleted: true,
        deleted_at: new Date(),
        status: role_status_enum.INACTIVE
      }
    });
  }

  public static async duplicateRole(
    roleId: string,
    payload: DuplicateRolePayload
  ): Promise<RoleDto> {
    const sourceRole = await RoleRepository.roles.findFirst({
      where: {
        role_uid: roleId,
        is_deleted: false
      },
      select: {
        id: true,
        role_name: true,
        role_description: true,
        role_category: true,
        status: true
      }
    });

    if (!sourceRole) {
      throw new AppError(StatusCodes.NOT_FOUND, "ROLE_NOT_FOUND", "Role not found.");
    }

    const suffix = payload.nameSuffix || " (Copy)";
    let candidateName = `${sourceRole.role_name}${suffix}`;
    let increment = 2;

    while (await checkRoleNameExists(candidateName)) {
      candidateName = `${sourceRole.role_name}${suffix} ${increment}`;
      increment += 1;
    }

    const sourcePermissions = await RoleRepository.rolePermissions.findMany({
      where: {
        role_id: sourceRole.id
      },
      select: {
        sub_feature_id: true,
        is_enabled: true
      }
    });

    const createdRole = await RoleRepository.roles.create({
      data: {
        role_uid: randomUUID(),
        role_name: candidateName,
        role_description: sourceRole.role_description,
        role_category: sourceRole.role_category,
        role_type: role_type_enum.CUSTOM,
        status: sourceRole.status,
        is_deleted: false
      }
    });

    if (sourcePermissions.length > 0) {
      await RoleRepository.rolePermissions.createMany({
        data: sourcePermissions.map((permission) => ({
          role_id: createdRole.id,
          sub_feature_id: permission.sub_feature_id,
          is_enabled: permission.is_enabled
        }))
      });
    }

    return this.getRoleById(createdRole.role_uid);
  }

  public static async compareRoles(
    roleAId: string,
    roleBId: string
  ): Promise<RoleCompareDto> {
    if (roleAId === roleBId) {
      throw new AppError(
        StatusCodes.BAD_REQUEST,
        "INVALID_COMPARE_REQUEST",
        "roleAId and roleBId must be different."
      );
    }

    const roles = await RoleRepository.roles.findMany({
      where: {
        role_uid: { in: [roleAId, roleBId] },
        is_deleted: false
      },
      select: {
        id: true,
        role_uid: true,
        role_name: true,
        status: true
      }
    });

    const roleA = roles.find((role) => role.role_uid === roleAId);
    const roleB = roles.find((role) => role.role_uid === roleBId);

    if (!roleA || !roleB) {
      throw new AppError(StatusCodes.NOT_FOUND, "ROLE_NOT_FOUND", "Role not found.");
    }

    const [assignedCounts, activeSubFeatures, permissionRows] = await Promise.all([
      UserRepository.appUser.groupBy({
        by: ["role_id"],
        where: {
          role_id: { in: [roleA.id, roleB.id] },
          status: true
        },
        _count: {
          _all: true
        }
      }),
      PermissionCatalogRepository.subFeatures.findMany({
        where: {
          is_active: true,
          permission_features: {
            is_active: true
          }
        },
        orderBy: [
          { permission_features: { feature_group: "asc" } },
          { permission_features: { sort_order: "asc" } },
          { permission_features: { feature_name: "asc" } },
          { sort_order: "asc" },
          { sub_feature_name: "asc" }
        ],
        select: {
          sub_feature_key: true,
          sub_feature_name: true,
          permission_features: {
            select: {
              feature_key: true,
              feature_name: true
            }
          }
        }
      }),
      RoleRepository.rolePermissions.findMany({
        where: {
          role_id: { in: [roleA.id, roleB.id] },
          permission_sub_features: {
            is_active: true,
            permission_features: {
              is_active: true
            }
          }
        },
        select: {
          role_id: true,
          is_enabled: true,
          permission_sub_features: {
            select: {
              sub_feature_key: true
            }
          }
        }
      })
    ]);

    const assignedCountMap = new Map<number, number>();
    for (const row of assignedCounts) {
      if (row.role_id) {
        assignedCountMap.set(row.role_id, row._count._all);
      }
    }

    const permissionLookup = new Map<number, Map<string, boolean>>();
    for (const row of permissionRows) {
      const rolePermissions = permissionLookup.get(row.role_id) ?? new Map<string, boolean>();
      rolePermissions.set(row.permission_sub_features.sub_feature_key, row.is_enabled);
      permissionLookup.set(row.role_id, rolePermissions);
    }

    const grouped = new Map<
      string,
      {
        featureName: string;
        subFeatures: Array<{
          subFeatureId: string;
          subFeatureName: string;
          roleAEnabled: boolean;
          roleBEnabled: boolean;
          different: boolean;
        }>;
      }
    >();

    for (const subFeature of activeSubFeatures) {
      const roleAEnabled =
        permissionLookup.get(roleA.id)?.get(subFeature.sub_feature_key) ?? false;
      const roleBEnabled =
        permissionLookup.get(roleB.id)?.get(subFeature.sub_feature_key) ?? false;

      const featureId = subFeature.permission_features.feature_key;
      const featureName = subFeature.permission_features.feature_name;

      const existing = grouped.get(featureId) ?? {
        featureName,
        subFeatures: []
      };

      existing.subFeatures.push({
        subFeatureId: subFeature.sub_feature_key,
        subFeatureName: subFeature.sub_feature_name,
        roleAEnabled,
        roleBEnabled,
        different: roleAEnabled !== roleBEnabled
      });

      grouped.set(featureId, existing);
    }

    const matrix = Array.from(grouped.entries()).map(([featureId, value]) => ({
      featureId,
      featureName: value.featureName,
      subFeatures: value.subFeatures
    }));

    const differentSubFeatureCount = matrix.reduce(
      (count, feature) =>
        count + feature.subFeatures.filter((subFeature) => subFeature.different).length,
      0
    );

    return {
      roleA: {
        roleId: roleA.role_uid,
        roleName: roleA.role_name,
        status: toApiStatus(roleA.status),
        assignedUsersCount: assignedCountMap.get(roleA.id) ?? 0
      },
      roleB: {
        roleId: roleB.role_uid,
        roleName: roleB.role_name,
        status: toApiStatus(roleB.status),
        assignedUsersCount: assignedCountMap.get(roleB.id) ?? 0
      },
      matrix,
      summary: {
        differentSubFeatureCount
      }
    };
  }
}
