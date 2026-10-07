import { Field, type CommonFieldOptions, type DecodeResult, type FieldValidation } from "./base";

export interface Money {
  amount: string;
  currencyCode: string;
}
interface MoneyOptions<R extends boolean = false> extends CommonFieldOptions {
  required?: R;
}

class MoneyField<R extends boolean> extends Field<Money, Money, R> {
  readonly shopifyType = "money";
  protected override readonly wireIsJson = true;
  constructor(opts: MoneyOptions<R>) {
    super();
    this.applyCommon(opts);
  }
  validations(): FieldValidation[] {
    return [];
  }
  protected toJson(value: Money): unknown {
    return { amount: value.amount, currency_code: value.currencyCode };
  }
  protected fromJson(json: unknown): DecodeResult<Money> {
    if (typeof json !== "object" || json === null) return { issues: [{ message: "Expected a money object" }] };
    const o = json as Record<string, unknown>;
    if (typeof o.amount !== "string" || typeof o.currency_code !== "string") {
      return { issues: [{ message: "money requires string amount and currency_code" }] };
    }
    return { value: { amount: o.amount, currencyCode: o.currency_code } };
  }
  // Shopify canonicalizes stored amounts ("12.5" comes back "12.50") — compare numerically.
  override jsonEquals(a: unknown, b: unknown): boolean {
    const ra = this.fromJson(a);
    const rb = this.fromJson(b);
    if (ra.issues || rb.issues) return super.jsonEquals(a, b);
    return Number(ra.value.amount) === Number(rb.value.amount) && ra.value.currencyCode === rb.value.currencyCode;
  }
}

export function money<R extends boolean = false>(opts: MoneyOptions<R> = {}): MoneyField<R> {
  return new MoneyField<R>(opts);
}
