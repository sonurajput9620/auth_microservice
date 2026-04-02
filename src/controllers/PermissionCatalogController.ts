import { Request, Response } from "express";

import { PermissionCatalogService } from "../services/PermissionCatalogService";
import { ApiResponse } from "../utils/ApiResponse";
import {
  exportCatalogQuerySchema,
  importIdParamSchema,
  importValidateSchema
} from "../validations/PermissionCatalogValidation";

export class PermissionCatalogController {
  public static async getCatalog(_req: Request, res: Response): Promise<void> {
    const catalog = await PermissionCatalogService.getCatalog();
    ApiResponse.ok(res, "Permission catalog fetched successfully.", catalog);
  }

  public static async exportCatalog(req: Request, res: Response): Promise<void> {
    const query = exportCatalogQuerySchema.parse(req.query);
    const catalog = await PermissionCatalogService.getCatalog();

    if (query.format === "json") {
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        "attachment; filename=\"permission-catalog.json\""
      );
      res.status(200).send(JSON.stringify(catalog, null, 2));
      return;
    }

    const csv = PermissionCatalogService.toCsv(catalog);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      "attachment; filename=\"permission-catalog.csv\""
    );
    res.status(200).send(csv);
  }

  public static async validateImport(req: Request, res: Response): Promise<void> {
    const payload = importValidateSchema.parse(req.body);
    const result = await PermissionCatalogService.validateImport(payload);
    ApiResponse.ok(res, "Catalog import validation completed.", result);
  }

  public static async applyImport(req: Request, res: Response): Promise<void> {
    const { importId } = importIdParamSchema.parse(req.params);
    const result = await PermissionCatalogService.applyImport(importId);
    ApiResponse.ok(res, "Catalog import applied successfully.", result);
  }

  public static async restoreDemo(_req: Request, res: Response): Promise<void> {
    const result = await PermissionCatalogService.restoreDemoCatalog();
    ApiResponse.ok(res, "Demo catalog restored successfully.", result);
  }

  public static async remapRoles(_req: Request, res: Response): Promise<void> {
    const result = await PermissionCatalogService.remapRoles();
    ApiResponse.ok(res, "Role permissions remapped successfully.", result);
  }
}
