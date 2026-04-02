import { Request, Response } from "express";

import { UserService } from "../services/UserService";
import { ApiResponse } from "../utils/ApiResponse";
import {
  assignUserRoleSchema,
  createUserSchema,
  listUsersQuerySchema,
  userIdParamSchema
} from "../validations/UserValidation";

export class UserController {
  public static async createUser(req: Request, res: Response): Promise<void> {
    const payload = createUserSchema.parse(req.body);
    const user = await UserService.createUser(payload);

    ApiResponse.created(res, "User created successfully.", user);
  }

  public static async getUsers(req: Request, res: Response): Promise<void> {
    const query = listUsersQuerySchema.parse(req.query);
    const users = await UserService.getAllUsers(query);
    ApiResponse.ok(res, "Users fetched successfully.", users);
  }

  public static async assignRole(req: Request, res: Response): Promise<void> {
    const { userId } = userIdParamSchema.parse(req.params);
    const payload = assignUserRoleSchema.parse(req.body);
    const user = await UserService.assignRole(userId, payload);
    ApiResponse.ok(res, "User role updated successfully.", user);
  }
}
