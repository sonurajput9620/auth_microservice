import { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";

import { UserService } from "../services/UserService";
import { createUserSchema } from "../validations/UserValidation";

export class UserController {
  public static async createUser(req: Request, res: Response): Promise<void> {
    const payload = createUserSchema.parse(req.body);
    const user = await UserService.createUser(payload);

    res.status(StatusCodes.CREATED).json({
      success: true,
      message: "User created successfully.",
      data: user
    });
  }

  public static async getUsers(_req: Request, res: Response): Promise<void> {
    const users = await UserService.getAllUsers();
    res.status(StatusCodes.OK).json({
      success: true,
      message: "Users fetched successfully.",
      data: users
    });
  }
}
