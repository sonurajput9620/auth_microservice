import { z } from "zod";

export const createUserSchema = z.object({
  username: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(6),
  first_name: z.string().min(1).optional(),
  last_name: z.string().min(1).optional()
});

export type CreateUserPayload = z.infer<typeof createUserSchema>;
