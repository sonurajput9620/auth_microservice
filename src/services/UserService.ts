import { role_status_enum } from "@prisma/client";
import { StatusCodes } from "http-status-codes";

import { RoleRepository } from "../repositories/RoleRepository";
import { UserRepository } from "../repositories/UserRepository";
import { AppError } from "../utils/AppError";
import { AssignUserRolePayload, CreateUserPayload, ListUsersQuery } from "../validations/UserValidation";

export interface UserDto {
  userId: number;
  userName: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  assignedRoleId: string | null;
  status: boolean;
}

const toUserDto = (user: {
  id: number;
  username: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  status: boolean;
  roles: { role_uid: string } | null;
}): UserDto => ({
  userId: user.id,
  userName: user.username,
  email: user.email,
  firstName: user.first_name,
  lastName: user.last_name,
  assignedRoleId: user.roles?.role_uid ?? null,
  status: user.status
});

export class UserService {
  public static async createUser(_payload: CreateUserPayload): Promise<never> {
    throw new AppError(
      StatusCodes.NOT_IMPLEMENTED,
      "NotImplemented",
      "User creation is not implemented in this module."
    );
  }

  public static async getAllUsers(query: ListUsersQuery): Promise<UserDto[]> {
    let filterRoleId: number | undefined;

    if (query.roleId) {
      const role = await RoleRepository.roles.findFirst({
        where: {
          role_uid: query.roleId,
          is_deleted: false
        },
        select: {
          id: true
        }
      });

      if (!role) {
        return [];
      }

      filterRoleId = role.id;
    }

    const users = await UserRepository.appUser.findMany({
      where: {
        ...(filterRoleId ? { role_id: filterRoleId } : {})
      },
      orderBy: [{ username: "asc" }],
      select: {
        id: true,
        username: true,
        email: true,
        first_name: true,
        last_name: true,
        status: true,
        roles: {
          select: {
            role_uid: true
          }
        }
      }
    });

    return users.map((user) => toUserDto(user));
  }

  public static async assignRole(
    userId: number,
    payload: AssignUserRolePayload
  ): Promise<UserDto> {
    const user = await UserRepository.appUser.findUnique({
      where: {
        id: userId
      },
      select: {
        id: true
      }
    });

    if (!user) {
      throw new AppError(StatusCodes.NOT_FOUND, "USER_NOT_FOUND", "User not found.");
    }

    let roleId: number | null = null;
    if (payload.roleId) {
      const role = await RoleRepository.roles.findFirst({
        where: {
          role_uid: payload.roleId,
          is_deleted: false
        },
        select: {
          id: true,
          status: true
        }
      });

      if (!role) {
        throw new AppError(StatusCodes.NOT_FOUND, "ROLE_NOT_FOUND", "Role not found.");
      }

      if (role.status !== role_status_enum.ACTIVE) {
        throw new AppError(
          StatusCodes.BAD_REQUEST,
          "ROLE_INACTIVE",
          "Role is inactive and cannot be assigned."
        );
      }

      roleId = role.id;
    }

    const updated = await UserRepository.appUser.update({
      where: {
        id: userId
      },
      data: {
        role_id: roleId
      },
      select: {
        id: true,
        username: true,
        email: true,
        first_name: true,
        last_name: true,
        status: true,
        roles: {
          select: {
            role_uid: true
          }
        }
      }
    });

    return toUserDto(updated);
  }
}
