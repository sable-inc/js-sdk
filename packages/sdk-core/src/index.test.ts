import { test, expect } from "bun:test";
import { VERSION } from "./index";

test("VERSION is exported as 0.1.1", () => {
  expect(VERSION).toBe("0.1.1");
});
