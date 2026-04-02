import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { feature_import_status_enum } from "@prisma/client";

import { createApp } from "../../src/app";
import { FeatureImportJobRepository } from "../../src/repositories/FeatureImportJobRepository";
import { PermissionCatalogRepository } from "../../src/repositories/PermissionCatalogRepository";
import { adminAuthHeader } from "../helpers/auth";

const previewCatalog = {
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
};

describe("Permission Catalog Import Routes", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("POST /api/v1/permission-catalog/import/:importId/apply succeeds with transactional apply", async () => {
    vi.spyOn(FeatureImportJobRepository.importJobs, "findFirst").mockResolvedValue({
      id: 501,
      status: feature_import_status_enum.VALIDATED,
      warnings_json: { previewCatalog }
    } as never);

    vi.spyOn(PermissionCatalogRepository.prisma, "$transaction").mockImplementation(
      async (callback: any) => callback({
        permission_catalog_versions: {
          create: vi.fn().mockResolvedValue({ id: 901 })
        },
        permission_features: {
          upsert: vi.fn().mockResolvedValue({ id: 1 }),
          updateMany: vi.fn().mockResolvedValue({ count: 0 })
        },
        permission_sub_features: {
          upsert: vi.fn().mockResolvedValue({ id: 11 }),
          updateMany: vi.fn().mockResolvedValue({ count: 0 })
        },
        $executeRaw: vi.fn()
          .mockResolvedValueOnce(10)
          .mockResolvedValueOnce(3)
      })
    );

    vi.spyOn(FeatureImportJobRepository.importJobs, "update").mockResolvedValue({} as never);

    const app = createApp();
    const response = await request(app)
      .post("/api/v1/permission-catalog/import/import-123/apply")
      .set("Authorization", adminAuthHeader());

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.status).toBe("APPLIED");
    expect(response.body.data.remap).toEqual({ insertedRows: 10, disabledRows: 3 });
  });

  it("POST /api/v1/permission-catalog/import/:importId/apply returns error and records failed audit on transactional error", async () => {
    vi.spyOn(FeatureImportJobRepository.importJobs, "findFirst").mockResolvedValue({
      id: 502,
      status: feature_import_status_enum.VALIDATED,
      warnings_json: { previewCatalog }
    } as never);

    vi.spyOn(PermissionCatalogRepository.prisma, "$transaction").mockRejectedValue(
      new Error("transaction failed") as never
    );

    const updateSpy = vi
      .spyOn(FeatureImportJobRepository.importJobs, "update")
      .mockResolvedValue({} as never);

    const app = createApp();
    const response = await request(app)
      .post("/api/v1/permission-catalog/import/import-err/apply")
      .set("Authorization", adminAuthHeader());

    expect(response.status).toBe(500);
    expect(response.body.success).toBe(false);
    expect(response.body.errorCode).toBe("CATALOG_IMPORT_APPLY_FAILED");
    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 502 },
        data: expect.objectContaining({
          status: feature_import_status_enum.FAILED
        })
      })
    );
  });
});
