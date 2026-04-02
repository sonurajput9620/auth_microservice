import { Prisma } from "@prisma/client";
import { StatusCodes } from "http-status-codes";
import { randomUUID } from "node:crypto";

import { PermissionCatalogRepository } from "../repositories/PermissionCatalogRepository";
import { RoleTemplateRepository } from "../repositories/RoleTemplateRepository";
import { AppError } from "../utils/AppError";
import { CreateRoleTemplatePayload } from "../validations/RoleTemplateValidation";

export interface RoleTemplatePermissionFeatureDto {
  featureId: string;
  enabled: boolean;
  subFeatures: Array<{
    subFeatureId: string;
    enabled: boolean;
  }>;
}

export interface RoleTemplateDto {
  templateId: string;
  templateName: string;
  isActive: boolean;
  permissions: RoleTemplatePermissionFeatureDto[];
  lastModified: string;
}

interface FlatTemplatePermissionRow {
  templateId: number;
  enabled: boolean;
  featureGroup: string;
  featureOrder: number;
  featureName: string;
  featureId: string;
  subFeatureOrder: number;
  subFeatureName: string;
  subFeatureId: string;
}

interface ActiveSubFeature {
  id: number;
  sub_feature_key: string;
  sort_order: number;
  sub_feature_name: string;
  permission_features: {
    feature_key: string;
    feature_group: string;
    sort_order: number;
    feature_name: string;
  };
}

const buildTemplatePermissions = (
  rows: FlatTemplatePermissionRow[]
): Map<number, RoleTemplatePermissionFeatureDto[]> => {
  const groupedByTemplate = new Map<number, RoleTemplatePermissionFeatureDto[]>();
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
    const templateFeatures = groupedByTemplate.get(row.templateId) ?? [];
    let feature = templateFeatures.find((item) => item.featureId === row.featureId);
    if (!feature) {
      feature = {
        featureId: row.featureId,
        enabled: false,
        subFeatures: []
      };
      templateFeatures.push(feature);
      groupedByTemplate.set(row.templateId, templateFeatures);
    }

    feature.subFeatures.push({
      subFeatureId: row.subFeatureId,
      enabled: row.enabled
    });
  }

  for (const [, features] of groupedByTemplate) {
    for (const feature of features) {
      feature.enabled =
        feature.subFeatures.length > 0 &&
        feature.subFeatures.every((subFeature) => subFeature.enabled);
    }
  }

  return groupedByTemplate;
};

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

const loadActiveSubFeatures = async (): Promise<ActiveSubFeature[]> =>
  PermissionCatalogRepository.subFeatures.findMany({
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

const checkTemplateNameExists = async (
  templateName: string,
  excludeTemplateId?: number
): Promise<boolean> => {
  const exclusion = excludeTemplateId
    ? Prisma.sql`AND id <> ${excludeTemplateId}`
    : Prisma.empty;

  const rows = await RoleTemplateRepository.prisma.$queryRaw<Array<{ id: number }>>(
    Prisma.sql`
      SELECT id
      FROM role_templates
      WHERE is_active = 1
        AND LOWER(template_name) = LOWER(${templateName})
        ${exclusion}
      LIMIT 1
    `
  );

  return rows.length > 0;
};

const mapTemplateDto = (
  template: {
    id: number;
    template_uid: string;
    template_name: string;
    is_active: boolean;
    updated_at: Date;
  },
  permissions: RoleTemplatePermissionFeatureDto[]
): RoleTemplateDto => ({
  templateId: template.template_uid,
  templateName: template.template_name,
  isActive: template.is_active,
  permissions,
  lastModified: template.updated_at.toISOString()
});

export class RoleTemplateService {
  public static async getTemplates(): Promise<RoleTemplateDto[]> {
    const templates = await RoleTemplateRepository.templates.findMany({
      where: {
        is_active: true
      },
      orderBy: [{ template_name: "asc" }],
      select: {
        id: true,
        template_uid: true,
        template_name: true,
        is_active: true,
        updated_at: true
      }
    });

    if (templates.length === 0) {
      return [];
    }

    const templateIds = templates.map((template) => template.id);

    const permissionRows = await RoleTemplateRepository.templatePermissions.findMany({
      where: {
        template_id: { in: templateIds },
        permission_sub_features: {
          is_active: true,
          permission_features: {
            is_active: true
          }
        }
      },
      select: {
        template_id: true,
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

    const permissionMap = buildTemplatePermissions(
      permissionRows.map((row) => ({
        templateId: row.template_id,
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

    return templates.map((template) =>
      mapTemplateDto(template, permissionMap.get(template.id) ?? [])
    );
  }

  public static async createTemplate(
    payload: CreateRoleTemplatePayload
  ): Promise<RoleTemplateDto> {
    const templateName = payload.templateName.trim();
    if (await checkTemplateNameExists(templateName)) {
      throw new AppError(
        StatusCodes.CONFLICT,
        "TEMPLATE_NAME_EXISTS",
        "Template name already exists."
      );
    }

    const activeSubFeatures = await loadActiveSubFeatures();
    const activeSubFeatureMap = new Map(
      activeSubFeatures.map((item) => [item.sub_feature_key, item])
    );
    const enabledBySubFeature = flattenEnabledSubFeatures(payload.permissions);

    for (const [subFeatureId, featureId] of enabledBySubFeature) {
      const existing = activeSubFeatureMap.get(subFeatureId);
      if (!existing || existing.permission_features.feature_key !== featureId) {
        throw new AppError(
          StatusCodes.BAD_REQUEST,
          "INVALID_PERMISSION_REFERENCE",
          `Invalid permission reference: ${subFeatureId}`
        );
      }
    }

    const template = await RoleTemplateRepository.templates.create({
      data: {
        template_uid: randomUUID(),
        template_name: templateName,
        is_active: true
      },
      select: {
        id: true,
        template_uid: true,
        template_name: true,
        is_active: true,
        updated_at: true
      }
    });

    await RoleTemplateRepository.templatePermissions.createMany({
      data: activeSubFeatures.map((subFeature) => ({
        template_id: template.id,
        sub_feature_id: subFeature.id,
        is_enabled: enabledBySubFeature.has(subFeature.sub_feature_key)
      }))
    });

    return this.applyPreview(template.template_uid).then((permissions) =>
      mapTemplateDto(template, permissions)
    );
  }

  public static async deleteTemplate(templateId: string): Promise<void> {
    const template = await RoleTemplateRepository.templates.findFirst({
      where: {
        template_uid: templateId,
        is_active: true
      },
      select: {
        id: true
      }
    });

    if (!template) {
      throw new AppError(
        StatusCodes.NOT_FOUND,
        "TEMPLATE_NOT_FOUND",
        "Template not found."
      );
    }

    await RoleTemplateRepository.templates.delete({
      where: {
        id: template.id
      }
    });
  }

  public static async applyPreview(
    templateId: string
  ): Promise<RoleTemplatePermissionFeatureDto[]> {
    const template = await RoleTemplateRepository.templates.findFirst({
      where: {
        template_uid: templateId,
        is_active: true
      },
      select: {
        id: true
      }
    });

    if (!template) {
      throw new AppError(
        StatusCodes.NOT_FOUND,
        "TEMPLATE_NOT_FOUND",
        "Template not found."
      );
    }

    const [activeSubFeatures, templatePermissions] = await Promise.all([
      loadActiveSubFeatures(),
      RoleTemplateRepository.templatePermissions.findMany({
        where: {
          template_id: template.id
        },
        select: {
          sub_feature_id: true,
          is_enabled: true
        }
      })
    ]);

    const permissionLookup = new Map<number, boolean>(
      templatePermissions.map((permission) => [
        permission.sub_feature_id,
        permission.is_enabled
      ])
    );

    const flatRows: FlatTemplatePermissionRow[] = activeSubFeatures.map((subFeature) => ({
      templateId: template.id,
      enabled: permissionLookup.get(subFeature.id) ?? false,
      featureGroup: subFeature.permission_features.feature_group,
      featureOrder: subFeature.permission_features.sort_order,
      featureName: subFeature.permission_features.feature_name,
      featureId: subFeature.permission_features.feature_key,
      subFeatureOrder: subFeature.sort_order,
      subFeatureName: subFeature.sub_feature_name,
      subFeatureId: subFeature.sub_feature_key
    }));

    return buildTemplatePermissions(flatRows).get(template.id) ?? [];
  }

  public static async createDefaultTemplateIfMissing(
    templateUid: string,
    templateName: string,
    enabledSubFeatureKeys: Set<string>
  ): Promise<void> {
    const template = await RoleTemplateRepository.templates.upsert({
      where: {
        template_uid: templateUid
      },
      update: {
        template_name: templateName,
        is_active: true
      },
      create: {
        template_uid: templateUid,
        template_name: templateName,
        is_active: true
      }
    });

    const activeSubFeatures = await PermissionCatalogRepository.subFeatures.findMany({
      where: {
        is_active: true,
        permission_features: {
          is_active: true
        }
      },
      select: {
        id: true,
        sub_feature_key: true
      }
    });

    for (const subFeature of activeSubFeatures) {
      await RoleTemplateRepository.templatePermissions.upsert({
        where: {
          template_id_sub_feature_id: {
            template_id: template.id,
            sub_feature_id: subFeature.id
          }
        },
        update: {
          is_enabled: enabledSubFeatureKeys.has(subFeature.sub_feature_key)
        },
        create: {
          template_id: template.id,
          sub_feature_id: subFeature.id,
          is_enabled: enabledSubFeatureKeys.has(subFeature.sub_feature_key)
        }
      });
    }
  }
}
