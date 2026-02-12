import { z } from "zod";

export const createUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  role: z.enum(["ADMIN", "USER"]).optional()
});

export type CreateUserPayload = z.infer<typeof createUserSchema>;
