import { Prisma, User } from "@prisma/client";
import { StatusCodes } from "http-status-codes";

import { UserRepository } from "../repositories/UserRepository";
import { AppError } from "../utils/AppError";

export class UserService {
  public static async createUser(input: Prisma.UserCreateInput): Promise<User> {
    try {
      const existingUser: User | null = await UserRepository.findByEmail(input.email);

      if (existingUser) {
        throw new AppError(
          StatusCodes.CONFLICT,
          "UserAlreadyExists",
          "User with this email already exists."
        );
      }

      return await UserRepository.create(input);
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw new AppError(
        StatusCodes.INTERNAL_SERVER_ERROR,
        "ServerError",
        "Failed to create user.",
        err
      );
    }
  }

  public static async getAllUsers(): Promise<User[]> {
    try {
      return await UserRepository.findAll();
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw new AppError(
        StatusCodes.INTERNAL_SERVER_ERROR,
        "ServerError",
        "Failed to fetch users.",
        err
      );
    }
  }
}
