import { prisma } from "../prismaClient";

export class RoleTemplateRepository {
  public static readonly prisma = prisma;
  public static readonly templates = prisma.role_templates;
  public static readonly templatePermissions = prisma.role_template_sub_feature_permissions;
}
