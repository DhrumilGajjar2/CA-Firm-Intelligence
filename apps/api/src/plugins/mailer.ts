import fp from "fastify-plugin";
import type { FastifyBaseLogger } from "fastify";

/**
 * Outbound email boundary. Real delivery is P5 (notifications); until then the default implementation
 * only logs the link in non-production. Tests inject a capturing mailer through `buildApp({ mailer })`.
 */
export interface Mailer {
  sendPasswordReset(message: { to: string; reset_url: string }): Promise<void>;
  sendInvitation(message: {
    to: string;
    invite_url: string;
    firm_name: string;
    role: string;
  }): Promise<void>;
}

declare module "fastify" {
  interface FastifyInstance {
    mailer: Mailer;
  }
}

/** Logs links for local development. In production it logs nothing at all (links are secrets). */
export function createLogMailer(log: FastifyBaseLogger, isProduction: boolean): Mailer {
  return {
    async sendPasswordReset({ to, reset_url }) {
      if (isProduction) return;
      log.info({ to, reset_url }, "DEV MAILER: password reset link (not sent by email)");
    },
    async sendInvitation({ to, invite_url, role }) {
      if (isProduction) return;
      log.info({ to, role, invite_url }, "DEV MAILER: invitation link (not sent by email)");
    },
  };
}

interface MailerOptions {
  /** A (partial) mailer: methods it provides replace the default log mailer's. */
  mailer?: Partial<Mailer>;
  isProduction: boolean;
}

export const mailerPlugin = fp<MailerOptions>(
  async (app, opts) => {
    // Delegate per method (an injected mailer may be a class instance, whose methods are not own properties).
    const fallback = createLogMailer(app.log, opts.isProduction);
    const injected = opts.mailer;
    app.decorate("mailer", {
      sendPasswordReset: (m) =>
        injected?.sendPasswordReset
          ? injected.sendPasswordReset(m)
          : fallback.sendPasswordReset(m),
      sendInvitation: (m) =>
        injected?.sendInvitation ? injected.sendInvitation(m) : fallback.sendInvitation(m),
    } satisfies Mailer);
  },
  { name: "mailer" },
);
