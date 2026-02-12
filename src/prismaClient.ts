import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient();

export const connectDB = async (): Promise<void> => {
  await prisma.$connect();
};

export const disconnectDB = async (): Promise<void> => {
  await prisma.$disconnect();
};
