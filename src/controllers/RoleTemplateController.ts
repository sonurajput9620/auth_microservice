import { Request, Response } from "express";

import { RoleTemplateService } from "../services/RoleTemplateService";
import { ApiResponse } from "../utils/ApiResponse";
import {
  createRoleTemplateSchema,
  templateIdParamSchema
} from "../validations/RoleTemplateValidation";

export class RoleTemplateController {
  public static async getTemplates(_req: Request, res: Response): Promise<void> {
    const templates = await RoleTemplateService.getTemplates();
    ApiResponse.ok(res, "Role templates fetched successfully.", templates);
  }

  public static async createTemplate(req: Request, res: Response): Promise<void> {
    const payload = createRoleTemplateSchema.parse(req.body);
    const template = await RoleTemplateService.createTemplate(payload);
    ApiResponse.created(res, "Role template created successfully.", template);
  }

  public static async deleteTemplate(req: Request, res: Response): Promise<void> {
    const { templateId } = templateIdParamSchema.parse(req.params);
    await RoleTemplateService.deleteTemplate(templateId);
    ApiResponse.ok(res, "Role template deleted successfully.", null);
  }

  public static async applyPreview(req: Request, res: Response): Promise<void> {
    const { templateId } = templateIdParamSchema.parse(req.params);
    const permissions = await RoleTemplateService.applyPreview(templateId);
    ApiResponse.ok(res, "Role template preview generated successfully.", permissions);
  }
}
