import { z } from "zod";

const templatePermissionSubFeatureSchema = z.object({
  subFeatureId: z.string().min(1),
  enabled: z.boolean()
});

const templatePermissionFeatureSchema = z.object({
  featureId: z.string().min(1),
  subFeatures: z.array(templatePermissionSubFeatureSchema)
});

export const templateIdParamSchema = z.object({
  templateId: z.string().min(1)
});

export const createRoleTemplateSchema = z.object({
  templateName: z.string().min(1).max(120),
  permissions: z.array(templatePermissionFeatureSchema).default([])
});

export type CreateRoleTemplatePayload = z.infer<typeof createRoleTemplateSchema>;
