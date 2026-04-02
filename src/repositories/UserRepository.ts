import { prisma } from "../prismaClient";

export class UserRepository {
  public static readonly appUser = prisma.app_user;
}
