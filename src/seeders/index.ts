import {
  catalog_source_enum,
  Prisma,
  role_status_enum,
  role_type_enum
} from "@prisma/client";

import { prisma } from "../prismaClient";
import {
  DEFAULT_CATALOG_VERSION_CODE,
  DEFAULT_PERMISSION_CATALOG
} from "./data/defaultCatalog";
import { DEFAULT_SYSTEM_ROLES } from "./data/defaultRoles";

const OPERATOR_DISABLED_SUB_FEATURES = new Set<string>([
  "users-create",
  "users-disable",
  "users-edit-role",
  "alerts-delete",
  "sites-delete",
  "settings-security",
  "settings-api-keys",
  "settings-audit-logs",
  "dashboards-delete",
  "data-upload-rollback",
  "ai-suggest-permissions"
]);

const EXECUTIVE_ENABLED_SUB_FEATURES = new Set<string>([
  "users-list",
  "alerts-list",
  "alerts-history",
  "maint-equipment",
  "maint-schedules",
  "pulse-kpi",
  "pulse-trends",
  "pulse-anomalies",
  "pulse-drilldown",
  "reports-list",
  "reports-run",
  "reports-export",
  "dashboards-list",
  "notifications-view",
  "sites-list",
  "analytics-overview",
  "analytics-funnels",
  "analytics-segments",
  "analytics-cohorts",
  "analytics-export",
  "data-upload-history",
  "settings-general",
  "settings-audit-logs",
  "ai-chat",
  "ai-history"
]);

const DEFAULT_TEMPLATE_UID = "1fce8f66-2d2b-4f45-9b3c-000000000010";
const DEFAULT_TEMPLATE_NAME = "Standard Operator";

const getPermissionEnabled = (roleName: string, subFeatureKey: string): boolean => {
  if (roleName === "Administrator") {
    return true;
  }

  if (roleName === "Operator") {
    return !OPERATOR_DISABLED_SUB_FEATURES.has(subFeatureKey);
  }

  if (roleName === "Executive Viewer") {
    return EXECUTIVE_ENABLED_SUB_FEATURES.has(subFeatureKey);
  }

  return false;
};

const seedCatalog = async (): Promise<Map<string, number>> => {
  const catalogVersion = await prisma.permission_catalog_versions.upsert({
    where: {
      version_code: DEFAULT_CATALOG_VERSION_CODE
    },
    update: {
      source: catalog_source_enum.DEMO,
      notes: "Default demo permission catalog",
      payload_json: DEFAULT_PERMISSION_CATALOG as unknown as Prisma.InputJsonValue
    },
    create: {
      version_code: DEFAULT_CATALOG_VERSION_CODE,
      source: catalog_source_enum.DEMO,
      notes: "Default demo permission catalog",
      payload_json: DEFAULT_PERMISSION_CATALOG as unknown as Prisma.InputJsonValue
    }
  });

  const subFeatureIdByKey = new Map<string, number>();

  for (const feature of DEFAULT_PERMISSION_CATALOG) {
    const upsertedFeature = await prisma.permission_features.upsert({
      where: {
        feature_key: feature.key
      },
      update: {
        feature_group: feature.group,
        feature_name: feature.name,
        feature_description: feature.description,
        is_system_feature: feature.isSystemFeature,
        is_active: true,
        sort_order: feature.sortOrder,
        catalog_version_id: catalogVersion.id
      },
      create: {
        feature_key: feature.key,
        feature_group: feature.group,
        feature_name: feature.name,
        feature_description: feature.description,
        is_system_feature: feature.isSystemFeature,
        is_active: true,
        sort_order: feature.sortOrder,
        catalog_version_id: catalogVersion.id
      }
    });

    for (let index = 0; index < feature.subFeatures.length; index += 1) {
      const subFeature = feature.subFeatures[index];
      const upsertedSubFeature = await prisma.permission_sub_features.upsert({
        where: {
          sub_feature_key: subFeature.key
        },
        update: {
          feature_id: upsertedFeature.id,
          sub_feature_name: subFeature.name,
          sub_feature_description: subFeature.description,
          is_active: true,
          sort_order: index + 1
        },
        create: {
          feature_id: upsertedFeature.id,
          sub_feature_key: subFeature.key,
          sub_feature_name: subFeature.name,
          sub_feature_description: subFeature.description,
          is_active: true,
          sort_order: index + 1
        }
      });

      subFeatureIdByKey.set(subFeature.key, upsertedSubFeature.id);
    }
  }

  return subFeatureIdByKey;
};

const seedSystemRoles = async (): Promise<Map<string, number>> => {
  const roleIdByName = new Map<string, number>();

  for (const role of DEFAULT_SYSTEM_ROLES) {
    const upsertedRole = await prisma.roles.upsert({
      where: {
        role_uid: role.uid
      },
      update: {
        role_name: role.name,
        role_description: role.description,
        role_category: role.category,
        role_type: role_type_enum.SYSTEM,
        status: role_status_enum.ACTIVE,
        is_deleted: false,
        deleted_at: null
      },
      create: {
        role_uid: role.uid,
        role_name: role.name,
        role_description: role.description,
        role_category: role.category,
        role_type: role_type_enum.SYSTEM,
        status: role_status_enum.ACTIVE,
        is_deleted: false
      }
    });

    roleIdByName.set(role.name, upsertedRole.id);
  }

  return roleIdByName;
};

const seedRolePermissions = async (
  roleIdByName: Map<string, number>,
  subFeatureIdByKey: Map<string, number>
): Promise<void> => {
  for (const [roleName, roleId] of roleIdByName.entries()) {
    for (const [subFeatureKey, subFeatureId] of subFeatureIdByKey.entries()) {
      await prisma.role_sub_feature_permissions.upsert({
        where: {
          role_id_sub_feature_id: {
            role_id: roleId,
            sub_feature_id: subFeatureId
          }
        },
        update: {
          is_enabled: getPermissionEnabled(roleName, subFeatureKey)
        },
        create: {
          role_id: roleId,
          sub_feature_id: subFeatureId,
          is_enabled: getPermissionEnabled(roleName, subFeatureKey)
        }
      });
    }
  }
};

const seedDefaultTemplate = async (
  subFeatureIdByKey: Map<string, number>
): Promise<void> => {
  const template = await prisma.role_templates.upsert({
    where: {
      template_uid: DEFAULT_TEMPLATE_UID
    },
    update: {
      template_name: DEFAULT_TEMPLATE_NAME,
      is_active: true
    },
    create: {
      template_uid: DEFAULT_TEMPLATE_UID,
      template_name: DEFAULT_TEMPLATE_NAME,
      is_active: true
    }
  });

  for (const [subFeatureKey, subFeatureId] of subFeatureIdByKey.entries()) {
    const enabled = getPermissionEnabled("Operator", subFeatureKey);
    await prisma.role_template_sub_feature_permissions.upsert({
      where: {
        template_id_sub_feature_id: {
          template_id: template.id,
          sub_feature_id: subFeatureId
        }
      },
      update: {
        is_enabled: enabled
      },
      create: {
        template_id: template.id,
        sub_feature_id: subFeatureId,
        is_enabled: enabled
      }
    });
  }
};

const seed = async (): Promise<void> => {
  const subFeatureIdByKey = await seedCatalog();
  const roleIdByName = await seedSystemRoles();
  await seedRolePermissions(roleIdByName, subFeatureIdByKey);
  await seedDefaultTemplate(subFeatureIdByKey);

  // eslint-disable-next-line no-console
  console.log(
    `Seed complete: ${DEFAULT_PERMISSION_CATALOG.length} features, ${subFeatureIdByKey.size} sub-features, ${roleIdByName.size} system roles, 1 default template.`
  );
};

seed()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (err: unknown) => {
    // eslint-disable-next-line no-console
    console.error("Seeding failed:", err);
    await prisma.$disconnect();
    process.exit(1);
  });
