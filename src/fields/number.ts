import { Field, type DecodeResult, type FieldValidation, type Issue } from "./base";

export interface NumberOptions<R extends boolean = false> {
  name?: string;
  description?: string;
  required?: R;
  min?: number;
  max?: number;
}
export interface DecimalOptions<R extends boolean = false> extends NumberOptions<R> {
  maxPrecision?: number;
}

abstract class NumericField<R extends boolean> extends Field<number, number, R> {
  constructor(protected readonly opts: NumberOptions<R>) {
    super();
    this.required = opts.required ?? false;
    this.name = opts.name;
    this.description = opts.description;
  }
  protected toJson(value: number): unknown {
    return value;
  }
  protected fromJson(json: unknown): DecodeResult<number> {
    const n = typeof json === "string" ? Number(json) : json;
    if (typeof n !== "number" || Number.isNaN(n)) return { issues: [{ message: `Expected a number, got ${json}` }] };
    return { value: n };
  }
  protected rangeIssues(value: number): Issue[] {
    const i: Issue[] = [];
    if (this.opts.min != null && value < this.opts.min) i.push({ message: `Must be at least ${this.opts.min}` });
    if (this.opts.max != null && value > this.opts.max) i.push({ message: `Must be at most ${this.opts.max}` });
    return i;
  }
  protected baseValidations(): FieldValidation[] {
    const v: FieldValidation[] = [];
    if (this.opts.min != null) v.push({ name: "min", value: String(this.opts.min) });
    if (this.opts.max != null) v.push({ name: "max", value: String(this.opts.max) });
    return v;
  }
}

class IntegerField<R extends boolean> extends NumericField<R> {
  readonly shopifyType = "number_integer";
  validations(): FieldValidation[] {
    return this.baseValidations();
  }
  protected override check(value: number): Issue[] {
    const i = this.rangeIssues(value);
    if (!Number.isInteger(value)) i.unshift({ message: "Must be an integer" });
    return i;
  }
}

class DecimalField<R extends boolean> extends NumericField<R> {
  readonly shopifyType = "number_decimal";
  constructor(private readonly decimalOpts: DecimalOptions<R>) {
    super(decimalOpts);
  }
  validations(): FieldValidation[] {
    const v = this.baseValidations();
    if (this.decimalOpts.maxPrecision != null) {
      v.push({ name: "max_precision", value: String(this.decimalOpts.maxPrecision) });
    }
    return v;
  }
  protected override check(value: number): Issue[] {
    return this.rangeIssues(value);
  }
}

export function integer<R extends boolean = false>(opts: NumberOptions<R> = {}): IntegerField<R> {
  return new IntegerField<R>(opts);
}
export function decimal<R extends boolean = false>(opts: DecimalOptions<R> = {}): DecimalField<R> {
  return new DecimalField<R>(opts);
}
