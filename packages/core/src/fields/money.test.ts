import { describe, expect, it } from "vitest";
import { dimension, weight } from "./measurement";
import { money } from "./money";

describe("money", () => {
  it("decodes the wire object and encodes back to a JSON string", () => {
    const f = money();
    expect(f.shopifyType).toBe("money");
    expect(f.decode({ amount: "10.00", currency_code: "USD" })).toEqual({
      value: { amount: "10.00", currencyCode: "USD" },
    });
    expect(f.encode({ amount: "10.00", currencyCode: "USD" })).toBe('{"amount":"10.00","currency_code":"USD"}');
  });
  it("decodes a JSON-string wire value", () => {
    expect(money().decode('{"amount":"5","currency_code":"CAD"}')).toEqual({
      value: { amount: "5", currencyCode: "CAD" },
    });
  });
});

describe("measurement", () => {
  it("dimension round-trips value+unit", () => {
    expect(dimension().decode({ value: 3, unit: "CENTIMETERS" })).toEqual({
      value: { value: 3, unit: "CENTIMETERS" },
    });
    expect(weight().shopifyType).toBe("weight");
  });
});

describe("malformed input", () => {
  it("money rejects a missing currency_code", () => {
    expect(money().decode({ amount: "5" }).issues).toBeDefined();
  });
  it("money rejects a wrong-typed amount", () => {
    expect(money().decode({ amount: 5, currency_code: "USD" }).issues).toBeDefined();
  });
  it("money rejects an invalid JSON string", () => {
    expect(money().decode("not json").issues).toBeDefined();
  });
  it("money rejects null", () => {
    expect(money().decode(null).issues).toBeDefined();
  });
  it("measurement rejects a missing value", () => {
    expect(dimension().decode({ unit: "CENTIMETERS" }).issues).toBeDefined();
  });
  it("measurement rejects a non-numeric value", () => {
    expect(dimension().decode({ value: "abc", unit: "CENTIMETERS" }).issues).toBeDefined();
  });
  it("measurement rejects null", () => {
    expect(dimension().decode(null).issues).toBeDefined();
  });
});
