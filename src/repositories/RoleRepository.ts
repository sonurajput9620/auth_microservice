import { prisma } from "../prismaClient";

export class RoleRepository {
  public static readonly prisma = prisma;
  public static readonly roles = prisma.roles;
  public static readonly rolePermissions = prisma.role_sub_feature_permissions;
}
