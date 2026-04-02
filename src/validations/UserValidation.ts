import { z } from "zod";

export const createUserSchema = z.object({
  username: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(6),
  first_name: z.string().min(1).optional(),
  last_name: z.string().min(1).optional()
});

export const listUsersQuerySchema = z.object({
  roleId: z.string().min(1).optional()
});

export const userIdParamSchema = z.object({
  userId: z.coerce.number().int().positive()
});

export const assignUserRoleSchema = z.object({
  roleId: z.string().min(1).nullable()
});

export type CreateUserPayload = z.infer<typeof createUserSchema>;
export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;
export type AssignUserRolePayload = z.infer<typeof assignUserRoleSchema>;
