import { describe, expect, it } from "vitest";
import { boolean } from "./boolean";
import { decimal, integer } from "./number";

describe("integer", () => {
  it("coerces a numeric string or number and encodes to a bare string", () => {
    expect(integer().decode("42")).toEqual({ value: 42 });
    expect(integer().decode(42)).toEqual({ value: 42 });
    expect(integer().encode(42)).toBe("42");
  });
  it("rejects non-integers and out-of-range values", () => {
    expect(integer().decode(1.5).issues?.[0]?.message).toMatch(/integer/);
    expect(integer({ max: 10 }).decode(11).issues?.[0]?.message).toMatch(/at most 10/);
  });
  it("emits min/max validations", () => {
    expect(integer({ min: 0, max: 5 }).validations()).toEqual([
      { name: "min", value: "0" },
      { name: "max", value: "5" },
    ]);
  });
});

describe("decimal", () => {
  it("round-trips and emits max_precision", () => {
    expect(decimal().decode("1.5")).toEqual({ value: 1.5 });
    expect(decimal({ maxPrecision: 2 }).validations()).toContainEqual({ name: "max_precision", value: "2" });
  });
});

describe("boolean", () => {
  it("coerces booleans and 'true'/'false' strings", () => {
    expect(boolean().decode(true)).toEqual({ value: true });
    expect(boolean().decode("false")).toEqual({ value: false });
    expect(boolean().encode(true)).toBe("true");
  });
});
