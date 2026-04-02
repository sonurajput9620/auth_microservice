import { Request, Response } from "express";

import { RoleService } from "../services/RoleService";
import { ApiResponse } from "../utils/ApiResponse";
import {
  compareRolesSchema,
  createRoleSchema,
  duplicateRoleSchema,
  listRolesQuerySchema,
  roleIdParamSchema,
  updateRoleSchema
} from "../validations/RoleValidation";

export class RoleController {
  public static async getRoles(req: Request, res: Response): Promise<void> {
    const query = listRolesQuerySchema.parse(req.query);
    const roles = await RoleService.getRoles(query.includePermissions);
    ApiResponse.ok(res, "Roles fetched successfully.", roles);
  }

  public static async getRoleById(req: Request, res: Response): Promise<void> {
    const { roleId } = roleIdParamSchema.parse(req.params);
    const role = await RoleService.getRoleById(roleId);
    ApiResponse.ok(res, "Role fetched successfully.", role);
  }

  public static async createRole(req: Request, res: Response): Promise<void> {
    const payload = createRoleSchema.parse(req.body);
    const role = await RoleService.createRole(payload);
    ApiResponse.created(res, "Role created successfully.", role);
  }

  public static async updateRole(req: Request, res: Response): Promise<void> {
    const { roleId } = roleIdParamSchema.parse(req.params);
    const payload = updateRoleSchema.parse(req.body);
    const role = await RoleService.updateRole(roleId, payload);
    ApiResponse.ok(res, "Role updated successfully.", role);
  }

  public static async deleteRole(req: Request, res: Response): Promise<void> {
    const { roleId } = roleIdParamSchema.parse(req.params);
    await RoleService.deleteRole(roleId);
    ApiResponse.ok(res, "Role deleted successfully.", null);
  }

  public static async duplicateRole(req: Request, res: Response): Promise<void> {
    const { roleId } = roleIdParamSchema.parse(req.params);
    const payload = duplicateRoleSchema.parse(req.body ?? {});
    const role = await RoleService.duplicateRole(roleId, payload);
    ApiResponse.created(res, "Role duplicated successfully.", role);
  }

  public static async compareRoles(req: Request, res: Response): Promise<void> {
    const payload = compareRolesSchema.parse(req.body);
    const result = await RoleService.compareRoles(payload.roleAId, payload.roleBId);
    ApiResponse.ok(res, "Roles compared successfully.", result);
  }
}
