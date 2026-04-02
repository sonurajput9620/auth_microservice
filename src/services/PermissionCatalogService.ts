import {
  catalog_source_enum,
  feature_import_source_type_enum,
  feature_import_status_enum,
  Prisma,
  PrismaClient
} from "@prisma/client";
import { StatusCodes } from "http-status-codes";
import { randomUUID } from "node:crypto";

import { DEFAULT_PERMISSION_CATALOG } from "../seeders/data/defaultCatalog";
import { AppError } from "../utils/AppError";
import { FeatureImportJobRepository } from "../repositories/FeatureImportJobRepository";
import { PermissionCatalogRepository } from "../repositories/PermissionCatalogRepository";
import { ImportValidatePayload } from "../validations/PermissionCatalogValidation";

export interface PermissionCatalogSubFeatureDto {
  subFeatureId: string;
  subFeatureName: string;
  subFeatureDescription: string | null;
  isActive: boolean;
}

export interface PermissionCatalogFeatureDto {
  featureGroup: string;
  featureId: string;
  featureName: string;
  featureDescription: string | null;
  isSystemFeature: boolean;
  isActive: boolean;
  subFeatures: PermissionCatalogSubFeatureDto[];
}

export interface PermissionCatalogDto {
  features: PermissionCatalogFeatureDto[];
}

export interface ImportIssue {
  row?: number;
  message: string;
}

export interface ImportValidateResult {
  importId: string;
  valid: boolean;
  totalRows: number;
  validRows: number;
  errors: ImportIssue[];
  warnings: ImportIssue[];
  previewCatalog: PermissionCatalogDto;
}

const escapeCsvCell = (value: string): string => {
  if (value.includes(",") || value.includes("\"") || value.includes("\n")) {
    return `"${value.replace(/"/g, "\"\"")}"`;
  }
  return value;
};

const parseBoolean = (value: unknown, defaultValue: boolean): boolean => {
  if (typeof value !== "string") {
    return defaultValue;
  }

  const normalized = value.trim().toLowerCase();
  if (["true", "1", "yes", "y"].includes(normalized)) return true;
  if (["false", "0", "no", "n"].includes(normalized)) return false;
  return defaultValue;
};

const splitCsvLine = (line: string): string[] => {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];

    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      result.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  result.push(current);
  return result.map((item) => item.trim());
};

const normalizeAndSortCatalog = (catalog: PermissionCatalogDto): PermissionCatalogDto => ({
  features: [...catalog.features]
    .map((feature) => ({
      ...feature,
      subFeatures: [...feature.subFeatures].sort(
        (a, b) => a.subFeatureName.localeCompare(b.subFeatureName) || a.subFeatureId.localeCompare(b.subFeatureId)
      )
    }))
    .sort(
      (a, b) =>
        a.featureGroup.localeCompare(b.featureGroup) ||
        a.featureName.localeCompare(b.featureName) ||
        a.featureId.localeCompare(b.featureId)
    )
});

const parseJsonCatalog = (rawData: string): {
  catalog: PermissionCatalogDto;
  totalRows: number;
  validRows: number;
  errors: ImportIssue[];
  warnings: ImportIssue[];
} => {
  const errors: ImportIssue[] = [];
  const warnings: ImportIssue[] = [];
  let parsed: unknown;

  try {
    parsed = JSON.parse(rawData);
  } catch {
    return {
      catalog: { features: [] },
      totalRows: 0,
      validRows: 0,
      errors: [{ message: "rawData is not valid JSON." }],
      warnings
    };
  }

  const features = (parsed as { features?: unknown })?.features;
  if (!Array.isArray(features)) {
    return {
      catalog: { features: [] },
      totalRows: 0,
      validRows: 0,
      errors: [{ message: "JSON must contain a features array." }],
      warnings
    };
  }

  const featureMap = new Map<string, PermissionCatalogFeatureDto>();
  const subFeatureOwner = new Map<string, string>();
  let validRows = 0;

  for (let featureIndex = 0; featureIndex < features.length; featureIndex += 1) {
    const rawFeature = features[featureIndex] as {
      featureGroup?: unknown;
      featureId?: unknown;
      featureName?: unknown;
      featureDescription?: unknown;
      isSystemFeature?: unknown;
      isActive?: unknown;
      subFeatures?: unknown;
    };

    const featureGroup = String(rawFeature.featureGroup ?? "").trim();
    const featureId = String(rawFeature.featureId ?? "").trim();
    const featureName = String(rawFeature.featureName ?? "").trim();

    if (!featureGroup || !featureId || !featureName) {
      errors.push({
        row: featureIndex + 1,
        message: "featureGroup, featureId and featureName are required."
      });
      continue;
    }

    const subFeatures = Array.isArray(rawFeature.subFeatures)
      ? rawFeature.subFeatures
      : [];

    if (!featureMap.has(featureId)) {
      featureMap.set(featureId, {
        featureGroup,
        featureId,
        featureName,
        featureDescription:
          rawFeature.featureDescription == null
            ? null
            : String(rawFeature.featureDescription),
        isSystemFeature:
          typeof rawFeature.isSystemFeature === "boolean"
            ? rawFeature.isSystemFeature
            : parseBoolean(String(rawFeature.isSystemFeature ?? ""), false),
        isActive:
          typeof rawFeature.isActive === "boolean"
            ? rawFeature.isActive
            : parseBoolean(String(rawFeature.isActive ?? ""), true),
        subFeatures: []
      });
    }

    for (let subIndex = 0; subIndex < subFeatures.length; subIndex += 1) {
      const rawSubFeature = subFeatures[subIndex] as {
        subFeatureId?: unknown;
        subFeatureName?: unknown;
        subFeatureDescription?: unknown;
        isActive?: unknown;
      };

      const subFeatureId = String(rawSubFeature.subFeatureId ?? "").trim();
      const subFeatureName = String(rawSubFeature.subFeatureName ?? "").trim();

      if (!subFeatureId || !subFeatureName) {
        errors.push({
          row: featureIndex + 1,
          message: `subFeatureId and subFeatureName are required in feature ${featureId}.`
        });
        continue;
      }

      const owner = subFeatureOwner.get(subFeatureId);
      if (owner && owner !== featureId) {
        errors.push({
          row: featureIndex + 1,
          message: `subFeatureId ${subFeatureId} is assigned to multiple features.`
        });
        continue;
      }
      subFeatureOwner.set(subFeatureId, featureId);

      featureMap.get(featureId)?.subFeatures.push({
        subFeatureId,
        subFeatureName,
        subFeatureDescription:
          rawSubFeature.subFeatureDescription == null
            ? null
            : String(rawSubFeature.subFeatureDescription),
        isActive:
          typeof rawSubFeature.isActive === "boolean"
            ? rawSubFeature.isActive
            : parseBoolean(String(rawSubFeature.isActive ?? ""), true)
      });

      validRows += 1;
    }
  }

  return {
    catalog: normalizeAndSortCatalog({ features: Array.from(featureMap.values()) }),
    totalRows: features.reduce((acc, feature) => {
      const subFeatures = (feature as { subFeatures?: unknown }).subFeatures;
      return acc + (Array.isArray(subFeatures) ? subFeatures.length : 0);
    }, 0),
    validRows,
    errors,
    warnings
  };
};

const parseCsvCatalog = (rawData: string): {
  catalog: PermissionCatalogDto;
  totalRows: number;
  validRows: number;
  errors: ImportIssue[];
  warnings: ImportIssue[];
} => {
  const errors: ImportIssue[] = [];
  const warnings: ImportIssue[] = [];

  const lines = rawData
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length < 2) {
    return {
      catalog: { features: [] },
      totalRows: 0,
      validRows: 0,
      errors: [{ message: "CSV must include a header row and at least one data row." }],
      warnings
    };
  }

  const header = splitCsvLine(lines[0]);
  const headerMap = new Map<string, number>(
    header.map((column, index) => [column.trim(), index])
  );

  const requiredColumns = [
    "featureGroup",
    "featureId",
    "featureName",
    "subFeatureId",
    "subFeatureName"
  ];

  for (const column of requiredColumns) {
    if (!headerMap.has(column)) {
      errors.push({ message: `Missing required CSV column: ${column}` });
    }
  }

  if (errors.length > 0) {
    return {
      catalog: { features: [] },
      totalRows: lines.length - 1,
      validRows: 0,
      errors,
      warnings
    };
  }

  const getValue = (row: string[], column: string): string => {
    const index = headerMap.get(column);
    if (index == null) return "";
    return row[index] ?? "";
  };

  const featureMap = new Map<string, PermissionCatalogFeatureDto>();
  const subFeatureOwner = new Map<string, string>();
  let validRows = 0;

  for (let i = 1; i < lines.length; i += 1) {
    const row = splitCsvLine(lines[i]);

    const featureGroup = getValue(row, "featureGroup").trim();
    const featureId = getValue(row, "featureId").trim();
    const featureName = getValue(row, "featureName").trim();
    const subFeatureId = getValue(row, "subFeatureId").trim();
    const subFeatureName = getValue(row, "subFeatureName").trim();

    if (!featureGroup || !featureId || !featureName || !subFeatureId || !subFeatureName) {
      errors.push({
        row: i,
        message:
          "featureGroup, featureId, featureName, subFeatureId and subFeatureName are required."
      });
      continue;
    }

    if (!featureMap.has(featureId)) {
      featureMap.set(featureId, {
        featureGroup,
        featureId,
        featureName,
        featureDescription: getValue(row, "featureDescription") || null,
        isSystemFeature: parseBoolean(getValue(row, "isSystemFeature"), false),
        isActive: parseBoolean(getValue(row, "isActive"), true),
        subFeatures: []
      });
    }

    const existingOwner = subFeatureOwner.get(subFeatureId);
    if (existingOwner && existingOwner !== featureId) {
      errors.push({
        row: i,
        message: `subFeatureId ${subFeatureId} is assigned to multiple features.`
      });
      continue;
    }
    subFeatureOwner.set(subFeatureId, featureId);

    featureMap.get(featureId)?.subFeatures.push({
      subFeatureId,
      subFeatureName,
      subFeatureDescription: getValue(row, "subFeatureDescription") || null,
      isActive: parseBoolean(getValue(row, "subFeatureActive"), true)
    });

    validRows += 1;
  }

  return {
    catalog: normalizeAndSortCatalog({ features: Array.from(featureMap.values()) }),
    totalRows: lines.length - 1,
    validRows,
    errors,
    warnings
  };
};

const toPermissionCatalog = (): PermissionCatalogDto => ({
  features: DEFAULT_PERMISSION_CATALOG.map((feature) => ({
    featureGroup: feature.group,
    featureId: feature.key,
    featureName: feature.name,
    featureDescription: feature.description,
    isSystemFeature: feature.isSystemFeature,
    isActive: true,
    subFeatures: feature.subFeatures.map((subFeature) => ({
      subFeatureId: subFeature.key,
      subFeatureName: subFeature.name,
      subFeatureDescription: subFeature.description,
      isActive: true
    }))
  }))
});

const applyCatalogInTransaction = async (
  tx: Prisma.TransactionClient,
  catalog: PermissionCatalogDto,
  source: catalog_source_enum,
  notes: string
): Promise<{ catalogVersionId: number }> => {
  const catalogVersion = await tx.permission_catalog_versions.create({
    data: {
      version_code: `${source.toLowerCase()}-${Date.now()}-${randomUUID().slice(0, 8)}`,
      source,
      notes,
      payload_json: catalog as unknown as Prisma.InputJsonValue
    }
  });

  const importedFeatureKeys: string[] = [];
  const importedSubFeatureKeys: string[] = [];

  for (let featureIndex = 0; featureIndex < catalog.features.length; featureIndex += 1) {
    const feature = catalog.features[featureIndex];
    importedFeatureKeys.push(feature.featureId);

    const upsertedFeature = await tx.permission_features.upsert({
      where: {
        feature_key: feature.featureId
      },
      update: {
        feature_group: feature.featureGroup,
        feature_name: feature.featureName,
        feature_description: feature.featureDescription,
        is_system_feature: feature.isSystemFeature,
        is_active: feature.isActive,
        sort_order: featureIndex + 1,
        catalog_version_id: catalogVersion.id
      },
      create: {
        feature_key: feature.featureId,
        feature_group: feature.featureGroup,
        feature_name: feature.featureName,
        feature_description: feature.featureDescription,
        is_system_feature: feature.isSystemFeature,
        is_active: feature.isActive,
        sort_order: featureIndex + 1,
        catalog_version_id: catalogVersion.id
      }
    });

    for (let subIndex = 0; subIndex < feature.subFeatures.length; subIndex += 1) {
      const subFeature = feature.subFeatures[subIndex];
      importedSubFeatureKeys.push(subFeature.subFeatureId);

      await tx.permission_sub_features.upsert({
        where: {
          sub_feature_key: subFeature.subFeatureId
        },
        update: {
          feature_id: upsertedFeature.id,
          sub_feature_name: subFeature.subFeatureName,
          sub_feature_description: subFeature.subFeatureDescription,
          is_active: subFeature.isActive,
          sort_order: subIndex + 1
        },
        create: {
          feature_id: upsertedFeature.id,
          sub_feature_key: subFeature.subFeatureId,
          sub_feature_name: subFeature.subFeatureName,
          sub_feature_description: subFeature.subFeatureDescription,
          is_active: subFeature.isActive,
          sort_order: subIndex + 1
        }
      });
    }
  }

  await tx.permission_features.updateMany({
    where: {
      feature_key: {
        notIn: importedFeatureKeys
      }
    },
    data: {
      is_active: false
    }
  });

  await tx.permission_sub_features.updateMany({
    where: {
      sub_feature_key: {
        notIn: importedSubFeatureKeys
      }
    },
    data: {
      is_active: false
    }
  });

  return {
    catalogVersionId: catalogVersion.id
  };
};

const remapRolesInTransaction = async (
  tx: Prisma.TransactionClient
): Promise<{ insertedRows: number; disabledRows: number }> => {
  const insertedRows = Number(
    await tx.$executeRaw`
      INSERT INTO role_sub_feature_permissions (role_id, sub_feature_id, is_enabled, created_at, updated_at)
      SELECT r.id, sf.id, 0, NOW(), NOW()
      FROM roles r
      CROSS JOIN permission_sub_features sf
      LEFT JOIN role_sub_feature_permissions rp
        ON rp.role_id = r.id
       AND rp.sub_feature_id = sf.id
      WHERE r.is_deleted = 0
        AND sf.is_active = 1
        AND rp.role_id IS NULL
    `
  );

  const disabledRows = Number(
    await tx.$executeRaw`
      UPDATE role_sub_feature_permissions rp
      INNER JOIN permission_sub_features sf
        ON sf.id = rp.sub_feature_id
      SET rp.is_enabled = 0
      WHERE sf.is_active = 0
    `
  );

  return {
    insertedRows,
    disabledRows
  };
};

export class PermissionCatalogService {
  public static async getCatalog(): Promise<PermissionCatalogDto> {
    const features = await PermissionCatalogRepository.features.findMany({
      where: {
        is_active: true
      },
      orderBy: [
        { feature_group: "asc" },
        { sort_order: "asc" },
        { feature_name: "asc" }
      ],
      select: {
        feature_group: true,
        feature_key: true,
        feature_name: true,
        feature_description: true,
        is_system_feature: true,
        is_active: true,
        permission_sub_features: {
          where: {
            is_active: true
          },
          orderBy: [{ sort_order: "asc" }, { sub_feature_name: "asc" }],
          select: {
            sub_feature_key: true,
            sub_feature_name: true,
            sub_feature_description: true,
            is_active: true
          }
        }
      }
    });

    return {
      features: features.map((feature) => ({
        featureGroup: feature.feature_group,
        featureId: feature.feature_key,
        featureName: feature.feature_name,
        featureDescription: feature.feature_description,
        isSystemFeature: feature.is_system_feature,
        isActive: feature.is_active,
        subFeatures: feature.permission_sub_features.map((subFeature) => ({
          subFeatureId: subFeature.sub_feature_key,
          subFeatureName: subFeature.sub_feature_name,
          subFeatureDescription: subFeature.sub_feature_description,
          isActive: subFeature.is_active
        }))
      }))
    };
  }

  public static toCsv(catalog: PermissionCatalogDto): string {
    const header = [
      "featureGroup",
      "featureId",
      "featureName",
      "featureDescription",
      "isSystemFeature",
      "isActive",
      "subFeatureId",
      "subFeatureName",
      "subFeatureDescription",
      "subFeatureActive"
    ];

    const rows: string[] = [header.join(",")];

    for (const feature of catalog.features) {
      for (const subFeature of feature.subFeatures) {
        rows.push(
          [
            feature.featureGroup,
            feature.featureId,
            feature.featureName,
            feature.featureDescription ?? "",
            String(feature.isSystemFeature),
            String(feature.isActive),
            subFeature.subFeatureId,
            subFeature.subFeatureName,
            subFeature.subFeatureDescription ?? "",
            String(subFeature.isActive)
          ]
            .map((cell) => escapeCsvCell(cell))
            .join(",")
        );
      }
    }

    return rows.join("\n");
  }

  public static async validateImport(
    payload: ImportValidatePayload
  ): Promise<ImportValidateResult> {
    const parsed = payload.format === "csv"
      ? parseCsvCatalog(payload.rawData)
      : parseJsonCatalog(payload.rawData);

    const valid = parsed.errors.length === 0;
    const importId = randomUUID();

    await FeatureImportJobRepository.importJobs.create({
      data: {
        import_uid: importId,
        source_type:
          payload.format === "csv"
            ? feature_import_source_type_enum.CSV
            : feature_import_source_type_enum.JSON,
        status: valid
          ? feature_import_status_enum.VALIDATED
          : feature_import_status_enum.FAILED,
        total_rows: parsed.totalRows,
        valid_rows: parsed.validRows,
        error_count: parsed.errors.length,
        warning_count: parsed.warnings.length,
        errors_json: parsed.errors as unknown as Prisma.InputJsonValue,
        warnings_json: {
          warnings: parsed.warnings,
          previewCatalog: parsed.catalog
        } as unknown as Prisma.InputJsonValue,
        started_at: new Date(),
        completed_at: valid ? null : new Date()
      }
    });

    return {
      importId,
      valid,
      totalRows: parsed.totalRows,
      validRows: parsed.validRows,
      errors: parsed.errors,
      warnings: parsed.warnings,
      previewCatalog: parsed.catalog
    };
  }

  public static async applyImport(importId: string): Promise<{
    importId: string;
    status: "APPLIED";
    catalogVersionId: number;
    remap: { insertedRows: number; disabledRows: number };
  }> {
    const job = await FeatureImportJobRepository.importJobs.findFirst({
      where: {
        import_uid: importId
      },
      select: {
        id: true,
        status: true,
        warnings_json: true
      }
    });

    if (!job) {
      throw new AppError(
        StatusCodes.NOT_FOUND,
        "CATALOG_IMPORT_NOT_FOUND",
        "Import job not found."
      );
    }

    if (job.status !== feature_import_status_enum.VALIDATED) {
      throw new AppError(
        StatusCodes.BAD_REQUEST,
        "CATALOG_IMPORT_INVALID",
        "Import job is not in VALIDATED state."
      );
    }

    const previewCatalog = (job.warnings_json as {
      previewCatalog?: PermissionCatalogDto;
    } | null)?.previewCatalog;

    if (!previewCatalog?.features || previewCatalog.features.length === 0) {
      throw new AppError(
        StatusCodes.BAD_REQUEST,
        "CATALOG_IMPORT_INVALID",
        "Validated import does not contain a preview catalog."
      );
    }

    try {
      const applied = await PermissionCatalogRepository.prisma.$transaction(
        async (tx) => {
          const { catalogVersionId } = await applyCatalogInTransaction(
            tx,
            previewCatalog,
            catalog_source_enum.IMPORT,
            `Applied import ${importId}`
          );

          const remap = await remapRolesInTransaction(tx);

          return {
            catalogVersionId,
            remap
          };
        }
      );

      await FeatureImportJobRepository.importJobs.update({
        where: {
          id: job.id
        },
        data: {
          status: feature_import_status_enum.APPLIED,
          catalog_version_id: applied.catalogVersionId,
          completed_at: new Date()
        }
      });

      return {
        importId,
        status: "APPLIED",
        catalogVersionId: applied.catalogVersionId,
        remap: applied.remap
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);

      await FeatureImportJobRepository.importJobs.update({
        where: {
          id: job.id
        },
        data: {
          status: feature_import_status_enum.FAILED,
          completed_at: new Date(),
          error_count: { increment: 1 },
          errors_json: [{ message }] as unknown as Prisma.InputJsonValue
        }
      });

      throw new AppError(
        StatusCodes.INTERNAL_SERVER_ERROR,
        "CATALOG_IMPORT_APPLY_FAILED",
        "Failed to apply validated import.",
        { cause: message }
      );
    }
  }

  public static async restoreDemoCatalog(): Promise<{
    importId: string;
    status: "APPLIED";
    catalogVersionId: number;
    remap: { insertedRows: number; disabledRows: number };
  }> {
    const importId = randomUUID();
    const demoCatalog = toPermissionCatalog();

    const result = await PermissionCatalogRepository.prisma.$transaction(async (tx) => {
      const { catalogVersionId } = await applyCatalogInTransaction(
        tx,
        demoCatalog,
        catalog_source_enum.DEMO,
        "Demo catalog restore"
      );

      const remap = await remapRolesInTransaction(tx);

      const totalRows = demoCatalog.features.reduce(
        (acc, feature) => acc + feature.subFeatures.length,
        0
      );

      await tx.feature_import_jobs.create({
        data: {
          import_uid: importId,
          source_type: feature_import_source_type_enum.DEMO_RESTORE,
          status: feature_import_status_enum.APPLIED,
          total_rows: totalRows,
          valid_rows: totalRows,
          error_count: 0,
          warning_count: 0,
          errors_json: [],
          warnings_json: {
            warnings: [],
            previewCatalog: demoCatalog
          } as unknown as Prisma.InputJsonValue,
          catalog_version_id: catalogVersionId,
          started_at: new Date(),
          completed_at: new Date()
        }
      });

      return {
        catalogVersionId,
        remap
      };
    });

    return {
      importId,
      status: "APPLIED",
      catalogVersionId: result.catalogVersionId,
      remap: result.remap
    };
  }

  public static async remapRoles(): Promise<{
    insertedRows: number;
    disabledRows: number;
  }> {
    return PermissionCatalogRepository.prisma.$transaction(async (tx) =>
      remapRolesInTransaction(tx)
    );
  }
}
