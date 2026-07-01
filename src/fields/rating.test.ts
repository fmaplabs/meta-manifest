import { describe, expect, it } from "vitest";
import { rating } from "./rating";

describe("rating", () => {
  it("requires min/max and emits them as validations", () => {
    expect(rating({ min: 1, max: 5 }).validations()).toEqual([
      { name: "min", value: "1" },
      { name: "max", value: "5" },
    ]);
  });
  it("decodes the wire object (string fields) into numbers", () => {
    expect(rating({ min: 1, max: 5 }).decode({ value: "4.5", scale_min: "1", scale_max: "5" })).toEqual({
      value: { value: 4.5, scaleMin: 1, scaleMax: 5 },
    });
  });
  it("encodes from a value using the definition scale", () => {
    expect(rating({ min: 1, max: 5 }).encode({ value: 4 })).toBe(
      '{"value":"4","scale_min":"1","scale_max":"5"}',
    );
  });
  it("rejects values outside the scale", () => {
    expect(rating({ min: 1, max: 5 }).decode({ value: "9", scale_min: "1", scale_max: "5" }).issues?.[0]?.message).toMatch(
      /between 1 and 5/,
    );
  });
  it("rejects a missing value field", () => {
    expect(rating({ min: 1, max: 5 }).decode({ scale_min: "1", scale_max: "5" }).issues).toBeDefined();
  });
  it("rejects a non-numeric value", () => {
    expect(rating({ min: 1, max: 5 }).decode({ value: "abc", scale_min: "1", scale_max: "5" }).issues).toBeDefined();
  });
  it("rejects null", () => {
    expect(rating({ min: 1, max: 5 }).decode(null).issues).toBeDefined();
  });
  it("rejects an invalid JSON string", () => {
    expect(rating({ min: 1, max: 5 }).decode("not json").issues).toBeDefined();
  });
  it("validates an in-range value through the Standard Schema interface", async () => {
    const result = await rating({ min: 1, max: 5 })["~standard"].validate({ value: 4 });
    expect(result).toEqual({ value: { value: 4, scaleMin: 1, scaleMax: 5 } });
  });
  it("rejects an out-of-range value through the Standard Schema interface", async () => {
    const result = await rating({ min: 1, max: 5 })["~standard"].validate({ value: 9 });
    expect((result as any).issues).toBeDefined();
  });
});
