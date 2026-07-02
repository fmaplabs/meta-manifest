import { Field, type CommonFieldOptions, type DecodeResult, type FieldValidation, type Issue } from "./base";

interface BaseOptions<R extends boolean = false> extends CommonFieldOptions {
  required?: R;
}

abstract class StringScalarField<R extends boolean> extends Field<string, string, R> {
  constructor(opts: BaseOptions<R>) {
    super();
    this.applyCommon(opts);
  }
  protected toJson(value: string): unknown {
    return value;
  }
  protected fromJson(json: unknown): DecodeResult<string> {
    if (typeof json !== "string") return { issues: [{ message: `Expected string, got ${typeof json}` }] };
    return { value: json };
  }
}

interface DateOptions<R extends boolean = false> extends BaseOptions<R> {
  min?: string;
  max?: string;
}
class DateField<R extends boolean> extends StringScalarField<R> {
  constructor(private readonly o: DateOptions<R>, readonly shopifyType: "date" | "date_time") {
    super(o);
  }
  validations(): FieldValidation[] {
    const v: FieldValidation[] = [];
    if (this.o.min != null) v.push({ name: "min", value: this.o.min });
    if (this.o.max != null) v.push({ name: "max", value: this.o.max });
    return v;
  }
  // Shopify normalizes date_time to UTC — compare instants, not strings.
  override wireEquals(local: string, remote: string): boolean {
    if (this.shopifyType !== "date_time") return super.wireEquals(local, remote);
    const l = Date.parse(local);
    const r = Date.parse(remote);
    if (Number.isNaN(l) || Number.isNaN(r)) return super.wireEquals(local, remote);
    return l === r;
  }
}

interface UrlOptions<R extends boolean = false> extends BaseOptions<R> {
  allowedDomains?: readonly string[];
}
class UrlField<R extends boolean> extends StringScalarField<R> {
  readonly shopifyType = "url";
  constructor(private readonly o: UrlOptions<R>) {
    super(o);
  }
  validations(): FieldValidation[] {
    return this.o.allowedDomains != null
      ? [{ name: "allowed_domains", value: JSON.stringify(this.o.allowedDomains) }]
      : [];
  }
}

class ColorField<R extends boolean> extends StringScalarField<R> {
  readonly shopifyType = "color";
  validations(): FieldValidation[] {
    return [];
  }
  protected override check(value: string): Issue[] {
    return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value) ? [] : [{ message: "Must be a hex color like #ff0000" }];
  }
}

class JsonField<R extends boolean> extends Field<unknown, unknown, R> {
  readonly shopifyType = "json";
  protected override readonly wireIsJson = true;
  constructor(opts: BaseOptions<R>) {
    super();
    this.applyCommon(opts);
  }
  validations(): FieldValidation[] {
    return [];
  }
  protected toJson(value: unknown): unknown {
    return value;
  }
  protected fromJson(json: unknown): DecodeResult<unknown> {
    return { value: json };
  }
}

export function date<R extends boolean = false>(opts: DateOptions<R> = {}): DateField<R> {
  return new DateField<R>(opts, "date");
}
export function dateTime<R extends boolean = false>(opts: DateOptions<R> = {}): DateField<R> {
  return new DateField<R>(opts, "date_time");
}
export function url<R extends boolean = false>(opts: UrlOptions<R> = {}): UrlField<R> {
  return new UrlField<R>(opts);
}
export function color<R extends boolean = false>(opts: BaseOptions<R> = {}): ColorField<R> {
  return new ColorField<R>(opts);
}
export function json<R extends boolean = false>(opts: BaseOptions<R> = {}): JsonField<R> {
  return new JsonField<R>(opts);
}
