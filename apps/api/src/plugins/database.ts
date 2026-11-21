import fp from "fastify-plugin";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.js";

declare module "fastify" {
  interface FastifyInstance {
    prisma: PrismaClient;
  }
}

interface DatabaseOptions {
  databaseUrl: string;
  /** Inject a client (tests). When provided, the plugin does not own its lifecycle. */
  prisma?: PrismaClient;
}

export const databasePlugin = fp<DatabaseOptions>(
  async (app, opts) => {
    const owned = !opts.prisma;
    const prisma =
      opts.prisma ??
      new PrismaClient({ adapter: new PrismaPg({ connectionString: opts.databaseUrl }) });

    app.decorate("prisma", prisma);

    if (owned) {
      app.addHook("onClose", async () => {
        await prisma.$disconnect();
      });
    }
  },
  { name: "database" },
);
