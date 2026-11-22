import { describe, expect, it } from "vitest";
import {
  diffFirmProfile,
  diffSettings,
  firmFormResolver,
  hasFieldErrorFor,
  isForbiddenError,
  timezoneOptionsFor,
  toFormValues,
  type FirmFormValues,
} from "@/features/firm/firm-form";
import { apiError } from "./utils";
import { makeProfile, makeSettings } from "./firm-fixtures";

const base = (over: Partial<FirmFormValues> = {}): FirmFormValues => ({
  name: "Demo CA Associates",
  address: "",
  email: "",
  phone: "",
  timezone: "Asia/Kolkata",
  financial_year_start_month: "4",
  ...over,
});

const resolve = (values: FirmFormValues) =>
  firmFormResolver(values, undefined, {
    fields: {},
    shouldUseNativeValidation: false,
  }) as unknown as { values: object; errors: Record<string, { message?: string }> };

describe("toFormValues", () => {
  it("turns nulls into empty strings and keeps the saved values", () => {
    expect(toFormValues(makeProfile(), makeSettings())).toEqual(base());
    expect(
      toFormValues(
        makeProfile({ address: "A", email: "a@b.co", phone: "9876543210" }),
        makeSettings({ financial_year_start_month: 1 }),
      ),
    ).toMatchObject({ address: "A", email: "a@b.co", phone: "9876543210", financial_year_start_month: "1" });
  });

  it("falls back to April and Asia/Kolkata for a missing month or timezone", () => {
    const v = toFormValues(makeProfile({ timezone: "" }), makeSettings({ financial_year_start_month: 0 }));
    expect(v.timezone).toBe("Asia/Kolkata");
    expect(v.financial_year_start_month).toBe("4");
  });
});

describe("diffFirmProfile", () => {
  const saved = makeProfile({ address: "12 MG Road", email: "office@demo-ca.example", phone: "+91 98765 43210" });
  const same = toFormValues(saved, makeSettings());

  it("is empty when nothing changed", () => {
    expect(diffFirmProfile(saved, same)).toEqual({});
  });

  it("ignores changes that are only whitespace or e-mail case", () => {
    expect(
      diffFirmProfile(saved, {
        ...same,
        name: "  Demo CA Associates  ",
        address: " 12 MG Road\n",
        email: "  OFFICE@Demo-CA.example ",
        phone: " +91 98765 43210 ",
      }),
    ).toEqual({});
  });

  it("sends only what changed, trimmed and with the e-mail lower-cased", () => {
    expect(diffFirmProfile(saved, { ...same, name: " New Name ", email: "New@Demo-CA.Example" })).toEqual({
      name: "New Name",
      email: "new@demo-ca.example",
    });
  });

  it("sends an empty string to clear an optional field, and nothing when it was already empty", () => {
    expect(diffFirmProfile(saved, { ...same, address: "", email: "", phone: "   " })).toEqual({
      address: "",
      email: "",
      phone: "",
    });
    const empty = makeProfile();
    expect(diffFirmProfile(empty, { ...base(), address: "   ", email: "  ", phone: " " })).toEqual({});
  });

  it("detects a timezone change", () => {
    expect(diffFirmProfile(saved, { ...same, timezone: "UTC" })).toEqual({ timezone: "UTC" });
  });

  it("never includes keys the user cannot edit", () => {
    const patch = diffFirmProfile(saved, { ...same, name: "X", address: "Y", email: "z@z.co", phone: "9999999999", timezone: "UTC" });
    expect(Object.keys(patch).sort()).toEqual(["address", "email", "name", "phone", "timezone"]);
  });
});

describe("diffSettings", () => {
  it("returns the month only when it changed, as a number", () => {
    expect(diffSettings(makeSettings(), base())).toEqual({});
    expect(diffSettings(makeSettings(), base({ financial_year_start_month: "1" }))).toEqual({
      financial_year_start_month: 1,
    });
  });

  it("never sends onboarding_completed from the settings screen", () => {
    expect(diffSettings(makeSettings({ onboarding_completed: true }), base({ financial_year_start_month: "7" }))).toEqual({
      financial_year_start_month: 7,
    });
  });
});

describe("firmFormResolver (shared schemas, so UI and API agree)", () => {
  it("accepts the defaults", () => {
    expect(resolve(base()).errors).toEqual({});
  });

  it.each([
    ["name empty", { name: "" }, "name"],
    ["name spaces", { name: "    " }, "name"],
    ["name 201 chars", { name: "a".repeat(201) }, "name"],
    ["name with a control character", { name: "bad\u0007name" }, "name"],
    ["address 501 chars", { address: "a".repeat(501) }, "address"],
    ["address with NUL", { address: "a\u0000b" }, "address"],
    ["email without domain", { email: "a@b" }, "email"],
    ["email with spaces", { email: "a b@example.com" }, "email"],
    ["phone 9 chars", { phone: "987654321" }, "phone"],
    ["phone 16 chars", { phone: "1234567890123456" }, "phone"],
    ["phone with letters", { phone: "98765abcde" }, "phone"],
    ["timezone empty", { timezone: "" }, "timezone"],
    ["timezone unknown", { timezone: "Mars/Olympus" }, "timezone"],
    ["month empty", { financial_year_start_month: "" }, "financial_year_start_month"],
    ["month 0", { financial_year_start_month: "0" }, "financial_year_start_month"],
    ["month 13", { financial_year_start_month: "13" }, "financial_year_start_month"],
    ["month 4.5", { financial_year_start_month: "4.5" }, "financial_year_start_month"],
    ["month text", { financial_year_start_month: "April" }, "financial_year_start_month"],
  ])("rejects %s", (_label, over, field) => {
    const { errors } = resolve(base(over));
    expect(errors[field]?.message, field).toBeTruthy();
  });

  it.each([
    ["name 200 chars", { name: "a".repeat(200) }],
    ["address 500 chars", { address: "a".repeat(500) }],
    ["address with line breaks", { address: "Line 1\r\nLine 2" }],
    ["phone 10 chars", { phone: "9876543210" }],
    ["phone 15 chars", { phone: "123456789012345" }],
    ["phone with plus and spaces", { phone: "+91 98765 43210" }],
    ["email in capitals", { email: "OFFICE@EXAMPLE.COM" }],
    ["month 1", { financial_year_start_month: "1" }],
    ["month 12", { financial_year_start_month: "12" }],
    ["UTC", { timezone: "UTC" }],
  ])("accepts %s", (_label, over) => {
    expect(resolve(base(over)).errors).toEqual({});
  });

  it("reports every invalid field at once", () => {
    const { errors } = resolve(base({ name: "", email: "x", phone: "1", timezone: "nope", financial_year_start_month: "0" }));
    expect(Object.keys(errors).sort()).toEqual(["email", "financial_year_start_month", "name", "phone", "timezone"]);
  });
});

describe("timezoneOptionsFor", () => {
  it("lists Asia/Kolkata and keeps an unusual current zone selectable and first", () => {
    const options = timezoneOptionsFor("Africa/Nairobi");
    expect(options[0]).toEqual({ value: "Africa/Nairobi", label: "Africa/Nairobi" });
    expect(options.some((o) => o.value === "Asia/Kolkata")).toBe(true);
    expect(timezoneOptionsFor("Asia/Kolkata").filter((o) => o.value === "Asia/Kolkata")).toHaveLength(1);
  });

  it("does not add an empty option", () => {
    expect(timezoneOptionsFor("").some((o) => o.value === "")).toBe(false);
  });
});

describe("error helpers", () => {
  it("isForbiddenError is true only for an API 403", () => {
    expect(isForbiddenError(apiError(403, "no"))).toBe(true);
    for (const e of [apiError(401, "x"), apiError(500, "x"), apiError(null, "x"), new Error("x"), null, "403"]) {
      expect(isForbiddenError(e)).toBe(false);
    }
  });

  it("hasFieldErrorFor looks at error.field only", () => {
    const e = apiError(400, "Validation failed", { errors: [{ field: "phone", message: "bad" }, { message: "general" }] });
    expect(hasFieldErrorFor(e, ["name", "phone"])).toBe(true);
    expect(hasFieldErrorFor(e, ["name", "email"])).toBe(false);
    expect(hasFieldErrorFor(new Error("x"), ["name"])).toBe(false);
  });
});
