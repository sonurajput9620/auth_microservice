import { Request, Response } from "express";

import { RoleManagementService } from "../services/RoleManagementService";
import { ApiResponse } from "../utils/ApiResponse";

export class RoleManagementController {
  public static async getBootstrap(_req: Request, res: Response): Promise<void> {
    const data = await RoleManagementService.getBootstrap();
    ApiResponse.ok(res, "Role management bootstrap fetched successfully.", data);
  }
}
