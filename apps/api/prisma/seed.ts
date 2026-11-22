import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type UserRole } from "../src/generated/prisma/client.js";
import { hashPassword } from "../src/modules/auth/password.js";

/**
 * Development seed: SAMPLE DATA ONLY (PRD section 19: never use real client information).
 * Idempotent, so it is safe to run repeatedly. Refuses to run in production.
 *
 * Demo logins (all FAKE, development only), every account uses the same password:
 *   owner@example.com / manager@example.com / employee@example.com / viewer@example.com
 *   password: Demo-pass-123
 */
const DEMO_PASSWORD = "Demo-pass-123";

const DEFAULT_SERVICES = [
  "GST Compliance",
  "Income Tax Return",
  "Tax Audit",
  "Accounting",
  "TDS Compliance",
  "Company Compliance",
  "Other Professional Services",
];

const DEMO_USERS: { email: string; name: string; role: UserRole }[] = [
  { email: "owner@example.com", name: "Asha Rao (demo owner)", role: "owner" },
  { email: "manager@example.com", name: "Manish Shah (demo manager)", role: "manager" },
  { email: "employee@example.com", name: "Esha Patel (demo employee)", role: "employee" },
  { email: "viewer@example.com", name: "Vikram Nair (demo viewer)", role: "viewer" },
];

async function main() {
  if (process.env["NODE_ENV"] === "production") {
    throw new Error("Refusing to run the development seed when NODE_ENV=production.");
  }
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

    // Demo firm is fully onboarded; keep any other settings that already exist.
    const existing =
      typeof firm.settings === "object" &&
      firm.settings !== null &&
      !Array.isArray(firm.settings)
        ? firm.settings
        : {};
    await prisma.firm.update({
      where: { id: firm.id },
      data: {
        settings: {
          financial_year_start_month: 4,
          ...existing,
          onboarding_completed: true,
        },
      },
    });

    for (const name of DEFAULT_SERVICES) {
      await prisma.service.upsert({
        where: { firm_id_name: { firm_id: firm.id, name } },
        update: {},
        create: { firm_id: firm.id, name },
      });
    }

    const password_hash = await hashPassword(DEMO_PASSWORD);
    for (const demo of DEMO_USERS) {
      // Existing users keep their current password; only missing ones are created.
      const user = await prisma.user.upsert({
        where: { email: demo.email },
        update: {},
        create: { email: demo.email, name: demo.name, password_hash },
      });
      await prisma.firmMember.upsert({
        where: { firm_id_user_id: { firm_id: firm.id, user_id: user.id } },
        update: { role: demo.role, is_active: true },
        create: { firm_id: firm.id, user_id: user.id, role: demo.role },
      });
    }

    console.log(
      `Seeded firm "${firm.name}" with ${DEFAULT_SERVICES.length} services and ${DEMO_USERS.length} demo users.`,
    );
    console.log(
      `Demo password for owner/manager/employee/viewer@example.com: ${DEMO_PASSWORD}`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
