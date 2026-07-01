import { Field, type DecodeResult, type FieldValidation } from "./base";

export interface BooleanOptions<R extends boolean = false> {
  name?: string;
  description?: string;
  required?: R;
}

class BooleanField<R extends boolean> extends Field<boolean, boolean, R> {
  readonly shopifyType = "boolean";
  constructor(opts: BooleanOptions<R>) {
    super();
    this.required = opts.required ?? false;
    this.name = opts.name;
    this.description = opts.description;
  }
  validations(): FieldValidation[] {
    return [];
  }
  protected toJson(value: boolean): unknown {
    return value;
  }
  protected fromJson(json: unknown): DecodeResult<boolean> {
    if (typeof json === "boolean") return { value: json };
    if (json === "true") return { value: true };
    if (json === "false") return { value: false };
    return { issues: [{ message: `Expected a boolean, got ${json}` }] };
  }
}

export function boolean<R extends boolean = false>(opts: BooleanOptions<R> = {}): BooleanField<R> {
  return new BooleanField<R>(opts);
}
