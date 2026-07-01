import { Field, type DecodeResult, type FieldValidation, type Issue } from "./base";
import type { StandardSchemaV1 } from "../standard-schema";

export interface Rating {
  value: number;
  scaleMin: number;
  scaleMax: number;
}
export interface RatingInput {
  value: number;
}
export interface RatingOptions<R extends boolean = false> {
  name?: string;
  description?: string;
  required?: R;
  min: number;
  max: number;
}

class RatingField<R extends boolean> extends Field<Rating, RatingInput, R> {
  readonly shopifyType = "rating";
  protected override readonly wireIsJson = true;
  constructor(private readonly o: RatingOptions<R>) {
    super();
    this.required = o.required ?? false;
    this.name = o.name;
    this.description = o.description;
  }
  validations(): FieldValidation[] {
    return [
      { name: "min", value: String(this.o.min) },
      { name: "max", value: String(this.o.max) },
    ];
  }
  protected toJson(value: RatingInput): unknown {
    return { value: String(value.value), scale_min: String(this.o.min), scale_max: String(this.o.max) };
  }
  protected fromJson(json: unknown): DecodeResult<Rating> {
    if (typeof json !== "object" || json === null) return { issues: [{ message: "Expected a rating object" }] };
    const o = json as Record<string, unknown>;
    const value = Number(o.value);
    const scaleMin = Number(o.scale_min);
    const scaleMax = Number(o.scale_max);
    if ([value, scaleMin, scaleMax].some(Number.isNaN)) {
      return { issues: [{ message: "rating requires numeric value, scale_min, scale_max" }] };
    }
    return { value: { value, scaleMin, scaleMax } };
  }
  protected override check(value: Rating): Issue[] {
    return value.value < value.scaleMin || value.value > value.scaleMax
      ? [{ message: `Rating must be between ${value.scaleMin} and ${value.scaleMax}` }]
      : [];
  }
  override get ["~standard"](): StandardSchemaV1.Props<RatingInput, Rating> {
    return {
      version: 1,
      vendor: "meta-manifest",
      validate: (input: unknown) => {
        if (
          typeof input !== "object" ||
          input === null ||
          typeof (input as { value?: unknown }).value !== "number"
        ) {
          return { issues: [{ message: "Expected a rating input { value: number }" }] };
        }
        const candidate: Rating = {
          value: (input as RatingInput).value,
          scaleMin: this.o.min,
          scaleMax: this.o.max,
        };
        const issues = this.check(candidate);
        return issues.length ? { issues } : { value: candidate };
      },
    };
  }
}

export function rating<R extends boolean = false>(opts: RatingOptions<R>): RatingField<R> {
  return new RatingField<R>(opts);
}
