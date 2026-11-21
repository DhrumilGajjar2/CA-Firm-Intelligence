import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.js";

/**
 * Development seed: SAMPLE DATA ONLY (PRD section 19: never use real client information).
 * Idempotent, so it is safe to run repeatedly. Users are added in P1 once password hashing exists.
 */
const DEFAULT_SERVICES = [
  "GST Compliance",
  "Income Tax Return",
  "Tax Audit",
  "Accounting",
  "TDS Compliance",
  "Company Compliance",
  "Other Professional Services",
];

async function main() {
  const url = process.env["DATABASE_URL"];
  if (!url) throw new Error("DATABASE_URL is required to seed");
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

  try {
    let firm = await prisma.firm.findFirst({ where: { name: "Demo CA Associates" } });
    firm ??= await prisma.firm.create({
      data: {
        name: "Demo CA Associates",
        email: "demo@example.com",
        timezone: "Asia/Kolkata",
      },
    });

    for (const name of DEFAULT_SERVICES) {
      await prisma.service.upsert({
        where: { firm_id_name: { firm_id: firm.id, name } },
        update: {},
        create: { firm_id: firm.id, name },
      });
    }
    console.log(`Seeded firm "${firm.name}" with ${DEFAULT_SERVICES.length} services.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
