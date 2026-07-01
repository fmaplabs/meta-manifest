import type { StandardSchemaV1 } from "../standard-schema";

export type FieldValidation = { name: string; value: string };
export type Issue = { message: string; path?: PropertyKey[] };
export type DecodeResult<T> =
  | { value: T; issues?: undefined }
  | { value?: undefined; issues: Issue[] };

export abstract class Field<TOut, TIn = TOut, Req extends boolean = false> {
  abstract readonly shopifyType: string;
  /** True when Shopify stores this type as a JSON string (objects, lists). */
  protected readonly wireIsJson: boolean = false;
  required = false;
  name?: string;
  description?: string;

  // Phantom type carriers (no runtime value).
  declare readonly _out: TOut;
  declare readonly _in: TIn;
  declare readonly _req: Req;

  /** Shopify definition validations, e.g. [{ name: "max", value: "120" }]. */
  abstract validations(): FieldValidation[];

  /** Typed value -> JSON representation (number/string/object). */
  protected abstract toJson(value: TIn): unknown;

  /** JSON representation -> typed value (no constraint checking). */
  protected abstract fromJson(json: unknown): DecodeResult<TOut>;

  /** Constraint validation on an already-typed value. */
  protected check(_value: TOut): Issue[] {
    return [];
  }

  /** Shopify wire (string or jsonValue) -> typed value (no constraint checking). */
  coerce(wire: unknown): DecodeResult<TOut> {
    let json = wire;
    if (this.wireIsJson && typeof wire === "string") {
      try {
        json = JSON.parse(wire);
      } catch {
        return { issues: [{ message: "Invalid JSON in field value" }] };
      }
    }
    return this.fromJson(json);
  }

  /** Shopify wire -> typed value, validated. */
  decode(wire: unknown): DecodeResult<TOut> {
    const coerced = this.coerce(wire);
    if (coerced.issues) return coerced;
    const issues = this.check(coerced.value);
    return issues.length ? { issues } : { value: coerced.value };
  }

  /** Typed value -> Shopify wire string. */
  encode(value: TIn): string {
    const json = this.toJson(value);
    return this.wireIsJson ? JSON.stringify(json) : String(json);
  }

  /** Element-level JSON form (for embedding inside list values). */
  elementToJson(value: TIn): unknown {
    return this.toJson(value);
  }
  /** Element-level decode from a JSON form (coerce + check), for list elements. */
  elementFromJson(json: unknown): DecodeResult<TOut> {
    const coerced = this.fromJson(json);
    if (coerced.issues) return coerced;
    const issues = this.check(coerced.value);
    return issues.length ? { issues } : { value: coerced.value };
  }

  get ["~standard"](): StandardSchemaV1.Props<TIn, TOut> {
    return {
      version: 1,
      vendor: "meta-manifest",
      validate: (value: unknown) => {
        const issues = this.check(value as TOut);
        return issues.length ? { issues } : { value: value as TOut };
      },
    };
  }
}
