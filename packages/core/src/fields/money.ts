import { Field, type DecodeResult, type FieldValidation } from "./base";

export interface Money {
  amount: string;
  currencyCode: string;
}
interface MoneyOptions<R extends boolean = false> {
  name?: string;
  description?: string;
  required?: R;
}

class MoneyField<R extends boolean> extends Field<Money, Money, R> {
  readonly shopifyType = "money";
  protected override readonly wireIsJson = true;
  constructor(opts: MoneyOptions<R>) {
    super();
    this.required = opts.required ?? false;
    this.name = opts.name;
    this.description = opts.description;
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
}

export function money<R extends boolean = false>(opts: MoneyOptions<R> = {}): MoneyField<R> {
  return new MoneyField<R>(opts);
}
