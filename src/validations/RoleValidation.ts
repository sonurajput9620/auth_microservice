import { z } from "zod";

const rolePermissionSubFeatureSchema = z.object({
  subFeatureId: z.string().min(1),
  enabled: z.boolean()
});

const rolePermissionFeatureSchema = z.object({
  featureId: z.string().min(1),
  subFeatures: z.array(rolePermissionSubFeatureSchema)
});

export const listRolesQuerySchema = z.object({
  includePermissions: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => value !== "false")
});

export const roleIdParamSchema = z.object({
  roleId: z.string().min(1)
});

export const createRoleSchema = z.object({
  roleName: z.string().min(1).max(120),
  roleDescription: z.string().min(1),
  roleCategory: z.string().max(80).optional().nullable(),
  status: z.enum(["Active", "Inactive"]).default("Active"),
  permissions: z.array(rolePermissionFeatureSchema).default([])
});

export const updateRoleSchema = createRoleSchema;

export const duplicateRoleSchema = z.object({
  nameSuffix: z.string().min(1).max(40).optional().default(" (Copy)")
});

export const compareRolesSchema = z.object({
  roleAId: z.string().min(1),
  roleBId: z.string().min(1)
});

export type ListRolesQuery = z.infer<typeof listRolesQuerySchema>;
export type CreateRolePayload = z.infer<typeof createRoleSchema>;
export type UpdateRolePayload = z.infer<typeof updateRoleSchema>;
export type DuplicateRolePayload = z.infer<typeof duplicateRoleSchema>;
export type CompareRolesPayload = z.infer<typeof compareRolesSchema>;
