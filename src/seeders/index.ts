import { prisma } from "../prismaClient";

const seed = async (): Promise<void> => {
  
};

seed()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (err: unknown) => {
    // eslint-disable-next-line no-console
    console.error("Seeding failed:", err);
    await prisma.$disconnect();
    process.exit(1);
  });
