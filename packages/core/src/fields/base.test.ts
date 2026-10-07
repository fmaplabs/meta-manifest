import { describe, expect, it } from "vitest";
import { Field, type DecodeResult, type FieldValidation, type Issue } from "./base";

// Minimal concrete field for testing the base contract.
class UpperField extends Field<string> {
  readonly shopifyType = "single_line_text_field";
  validations(): FieldValidation[] {
    return [];
  }
  protected toJson(value: string): unknown {
    return value;
  }
  protected fromJson(json: unknown): DecodeResult<string> {
    if (typeof json !== "string") return { issues: [{ message: "not a string" }] };
    return { value: json };
  }
  protected override check(value: string): Issue[] {
    return value === value.toUpperCase() ? [] : [{ message: "must be uppercase" }];
  }
}

describe("Field base", () => {
  it("decodes valid wire to a typed value", () => {
    expect(new UpperField().decode("HELLO")).toEqual({ value: "HELLO" });
  });

  it("surfaces check() issues on decode", () => {
    expect(new UpperField().decode("hello")).toEqual({ issues: [{ message: "must be uppercase" }] });
  });

  it("encodes a scalar to a bare string", () => {
    expect(new UpperField().encode("HELLO")).toBe("HELLO");
  });

  it("exposes a Standard Schema interface", () => {
    const std = new UpperField()["~standard"];
    expect(std.version).toBe(1);
    expect(std.vendor).toBe("@fmaplabs/meta-manifest");
    expect(std.validate("HELLO")).toEqual({ value: "HELLO" });
    expect(std.validate("hello")).toEqual({ issues: [{ message: "must be uppercase" }] });
  });
});
