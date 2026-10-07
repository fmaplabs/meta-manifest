import { Field, type CommonFieldOptions, type DecodeResult, type FieldValidation, type Issue } from "./base";

type InnerOut<E> = E extends Field<infer O, any, any> ? O : never;
type InnerIn<E> = E extends Field<any, infer I, any> ? I : never;

export interface ListOptions<R extends boolean = false> extends CommonFieldOptions {
  required?: R;
  min?: number;
  max?: number;
}

class ListField<E extends Field<any, any, any>, R extends boolean> extends Field<InnerOut<E>[], InnerIn<E>[], R> {
  readonly shopifyType: string;
  protected override readonly wireIsJson = true;
  constructor(private readonly inner: E, private readonly o: ListOptions<R>) {
    super();
    this.shopifyType = `list.${inner.shopifyType}`;
    this.applyCommon(o);
  }
  validations(): FieldValidation[] {
    const v = [...this.inner.validations()];
    if (this.o.min != null) v.push({ name: "list.min", value: String(this.o.min) });
    if (this.o.max != null) v.push({ name: "list.max", value: String(this.o.max) });
    return v;
  }
  protected toJson(value: InnerIn<E>[]): unknown {
    return value.map((el) => this.inner.elementToJson(el));
  }
  protected fromJson(json: unknown): DecodeResult<InnerOut<E>[]> {
    if (!Array.isArray(json)) return { issues: [{ message: "Expected an array" }] };
    const out: InnerOut<E>[] = [];
    const issues: Issue[] = [];
    json.forEach((el, index) => {
      const r = this.inner.elementFromJson(el);
      if (r.issues) issues.push(...r.issues.map((i) => ({ ...i, path: [index, ...(i.path ?? [])] })));
      else out.push(r.value);
    });
    return issues.length ? { issues } : { value: out };
  }
  // Element-wise, so inner canonicalization overrides (money, rating, …) apply per element.
  override jsonEquals(a: unknown, b: unknown): boolean {
    if (!Array.isArray(a) || !Array.isArray(b)) return super.jsonEquals(a, b);
    if (a.length !== b.length) return false;
    return a.every((el, i) => this.inner.jsonEquals(el, b[i]));
  }
}

export function list<E extends Field<any, any, any>, R extends boolean = false>(
  inner: E,
  opts: ListOptions<R> = {},
): ListField<E, R> {
  return new ListField<E, R>(inner, opts);
}
