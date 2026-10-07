import { Field, type CommonFieldOptions, type DecodeResult, type FieldValidation } from "./base";

export interface Measure {
  value: number;
  unit: string;
}
interface MeasureOptions<R extends boolean = false> extends CommonFieldOptions {
  required?: R;
}

class MeasurementField<R extends boolean> extends Field<Measure, Measure, R> {
  protected override readonly wireIsJson = true;
  constructor(opts: MeasureOptions<R>, readonly shopifyType: "dimension" | "weight" | "volume") {
    super();
    this.applyCommon(opts);
  }
  validations(): FieldValidation[] {
    return [];
  }
  protected toJson(value: Measure): unknown {
    return { value: value.value, unit: value.unit };
  }
  protected fromJson(json: unknown): DecodeResult<Measure> {
    if (typeof json !== "object" || json === null) return { issues: [{ message: "Expected a measurement object" }] };
    const o = json as Record<string, unknown>;
    const value = typeof o.value === "string" ? Number(o.value) : o.value;
    if (typeof value !== "number" || Number.isNaN(value) || typeof o.unit !== "string") {
      return { issues: [{ message: "measurement requires numeric value and string unit" }] };
    }
    return { value: { value, unit: o.unit } };
  }
  // Shopify may return the value as a string ("2.5") — compare the coerced number + unit.
  override jsonEquals(a: unknown, b: unknown): boolean {
    const ra = this.fromJson(a);
    const rb = this.fromJson(b);
    if (ra.issues || rb.issues) return super.jsonEquals(a, b);
    return ra.value.value === rb.value.value && ra.value.unit === rb.value.unit;
  }
}

export function dimension<R extends boolean = false>(opts: MeasureOptions<R> = {}): MeasurementField<R> {
  return new MeasurementField<R>(opts, "dimension");
}
export function weight<R extends boolean = false>(opts: MeasureOptions<R> = {}): MeasurementField<R> {
  return new MeasurementField<R>(opts, "weight");
}
export function volume<R extends boolean = false>(opts: MeasureOptions<R> = {}): MeasurementField<R> {
  return new MeasurementField<R>(opts, "volume");
}
