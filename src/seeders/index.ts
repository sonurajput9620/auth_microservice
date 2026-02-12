import { prisma } from "../prismaClient";

const seed = async (): Promise<void> => {
  await prisma.user.upsert({
    where: { email: "admin@example.com" },
    update: {},
    create: {
      email: "admin@example.com",
      password: "change_me",
      role: "ADMIN"
    }
  });
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
