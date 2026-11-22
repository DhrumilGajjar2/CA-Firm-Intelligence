import { Writable } from "node:stream";
import pino from "pino";
import { describe, expect, it } from "vitest";
import { REDACT_PATHS } from "../src/app.js";

describe("log redaction", () => {
  it("hides cookies, authorization and request bodies", () => {
    const lines: string[] = [];
    const stream = new Writable({
      write(chunk, _enc, cb) {
        lines.push(String(chunk));
        cb();
      },
    });
    const log = pino({ redact: [...REDACT_PATHS] }, stream);
    log.info({
      req: {
        headers: { cookie: "access_token=SECRETJWT", authorization: "Bearer SECRETJWT" },
        body: { password: "SECRETPASS" },
      },
      res: { headers: { "set-cookie": "access_token=SECRETJWT; HttpOnly" } },
    });
    const out = lines.join("");
    expect(out).not.toContain("SECRETJWT");
    expect(out).not.toContain("SECRETPASS");
    expect(out).toContain("[Redacted]");
  });
});
