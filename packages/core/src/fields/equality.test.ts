import { describe, expect, it } from "vitest";
import { jsonDeepEqual } from "./base";
import { list } from "./list";
import { dimension } from "./measurement";
import { money } from "./money";
import { rating } from "./rating";
import { date, dateTime, json } from "./scalar";
import { text } from "./text";

describe("jsonDeepEqual", () => {
  it("compares objects key-order-insensitively and arrays positionally", () => {
    expect(jsonDeepEqual({ a: 1, b: [2, { c: 3 }] }, { b: [2, { c: 3 }], a: 1 })).toBe(true);
    expect(jsonDeepEqual([1, 2], [2, 1])).toBe(false);
    expect(jsonDeepEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(jsonDeepEqual(null, {})).toBe(false);
  });
});

describe("wireEquals default", () => {
  it("is strict string equality for plain string wires", () => {
    expect(text().wireEquals("a", "a")).toBe(true);
    expect(text().wireEquals("a", "A")).toBe(false);
  });
  it("parses JSON wires so formatting differences don't diff", () => {
    const f = json();
    expect(f.wireEquals('{"a":1,"b":2}', '{ "b": 2, "a": 1 }')).toBe(true);
    expect(f.wireEquals('{"a":1}', '{"a":2}')).toBe(false);
  });
  it("falls back to inequality on unparseable JSON wires", () => {
    expect(json().wireEquals("{", "[")).toBe(false);
  });
});

describe("money.wireEquals", () => {
  it("compares amounts numerically (Shopify pads decimals)", () => {
    const f = money();
    expect(f.wireEquals('{"amount":"12.5","currency_code":"USD"}', '{"amount":"12.50","currency_code":"USD"}')).toBe(true);
    expect(f.wireEquals('{"amount":"12.5","currency_code":"USD"}', '{"amount":"12.5","currency_code":"CAD"}')).toBe(false);
    expect(f.wireEquals('{"amount":"12.5","currency_code":"USD"}', '{"amount":"12.51","currency_code":"USD"}')).toBe(false);
  });
});

describe("rating.wireEquals", () => {
  it("compares string-encoded and numeric wire forms equal", () => {
    const f = rating({ min: 0, max: 5 });
    const local = f.encode({ value: 4 });
    expect(local).toBe('{"value":"4","scale_min":"0","scale_max":"5"}');
    expect(f.wireEquals(local, '{"value":4.0,"scale_min":0.0,"scale_max":5.0}')).toBe(true);
    expect(f.wireEquals(local, '{"value":3,"scale_min":0,"scale_max":5}')).toBe(false);
  });
});

describe("measurement.wireEquals", () => {
  it("compares numeric value + unit across string/number forms", () => {
    const f = dimension();
    expect(f.wireEquals('{"value":2.5,"unit":"CENTIMETERS"}', '{"value":"2.5","unit":"CENTIMETERS"}')).toBe(true);
    expect(f.wireEquals('{"value":2.5,"unit":"CENTIMETERS"}', '{"value":2.5,"unit":"METERS"}')).toBe(false);
  });
});

describe("date_time.wireEquals", () => {
  it("compares instants, not strings", () => {
    const f = dateTime();
    expect(f.wireEquals("2026-01-01T10:00:00-05:00", "2026-01-01T15:00:00Z")).toBe(true);
    expect(f.wireEquals("2026-01-01T10:00:00Z", "2026-01-01T11:00:00Z")).toBe(false);
  });
  it("plain date stays strict", () => {
    expect(date().wireEquals("2026-01-01", "2026-01-01")).toBe(true);
    expect(date().wireEquals("2026-01-01", "2026-01-02")).toBe(false);
  });
});

describe("list.wireEquals", () => {
  it("applies the inner field's canonicalization per element", () => {
    const f = list(money());
    const local = '[{"amount":"1.5","currency_code":"USD"},{"amount":"2","currency_code":"USD"}]';
    const remote = '[{"amount":"1.50","currency_code":"USD"},{"amount":"2.00","currency_code":"USD"}]';
    expect(f.wireEquals(local, remote)).toBe(true);
    expect(f.wireEquals(local, '[{"amount":"1.50","currency_code":"USD"}]')).toBe(false);
  });
});
