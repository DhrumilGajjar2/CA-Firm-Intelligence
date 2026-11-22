import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";
import { resetNavigation } from "./navigation-mock";

vi.mock("next/navigation", async () => await import("./navigation-mock"));

beforeEach(() => {
  resetNavigation();
});

afterEach(() => {
  cleanup();
});
