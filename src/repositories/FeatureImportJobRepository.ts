import { prisma } from "../prismaClient";

export class FeatureImportJobRepository {
  public static readonly prisma = prisma;
  public static readonly importJobs = prisma.feature_import_jobs;
}
