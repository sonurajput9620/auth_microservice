import { prisma } from "../prismaClient";

export class PermissionCatalogRepository {
  public static readonly prisma = prisma;
  public static readonly catalogVersions = prisma.permission_catalog_versions;
  public static readonly features = prisma.permission_features;
  public static readonly subFeatures = prisma.permission_sub_features;
}
