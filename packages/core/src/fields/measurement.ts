import { Field, type DecodeResult, type FieldValidation } from "./base";

export interface Measure {
  value: number;
  unit: string;
}
interface MeasureOptions<R extends boolean = false> {
  name?: string;
  description?: string;
  required?: R;
}

class MeasurementField<R extends boolean> extends Field<Measure, Measure, R> {
  protected override readonly wireIsJson = true;
  constructor(opts: MeasureOptions<R>, readonly shopifyType: "dimension" | "weight" | "volume") {
    super();
    this.required = opts.required ?? false;
    this.name = opts.name;
    this.description = opts.description;
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
