import { z } from "zod";

export const exportCatalogQuerySchema = z.object({
  format: z.enum(["json", "csv"])
});

export const importValidateSchema = z.object({
  format: z.enum(["csv", "json"]),
  rawData: z.string().min(1)
});

export const importIdParamSchema = z.object({
  importId: z.string().min(1)
});

export type ExportCatalogQuery = z.infer<typeof exportCatalogQuerySchema>;
export type ImportValidatePayload = z.infer<typeof importValidateSchema>;
