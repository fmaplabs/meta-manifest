import { Field, type CommonFieldOptions, type DecodeResult, type FieldValidation } from "./base";

export interface LinkValue {
  text?: string;
  url: string;
}

interface LinkOptions<R extends boolean = false> extends CommonFieldOptions {
  required?: R;
}

/** Shopify `link` field — `{ text?, url }` stored as a JSON wire string. */
class LinkField<R extends boolean> extends Field<LinkValue, LinkValue, R> {
  readonly shopifyType = "link";
  protected override readonly wireIsJson = true;
  constructor(opts: LinkOptions<R>) {
    super();
    this.applyCommon(opts);
  }
  validations(): FieldValidation[] {
    return [];
  }
  protected toJson(value: LinkValue): unknown {
    return value;
  }
  protected fromJson(json: unknown): DecodeResult<LinkValue> {
    if (typeof json !== "object" || json === null || typeof (json as { url?: unknown }).url !== "string") {
      return { issues: [{ message: "link value must be an object with a string `url`" }] };
    }
    return { value: json as LinkValue };
  }
}

export function link<R extends boolean = false>(opts: LinkOptions<R> = {}) {
  return new LinkField<R>(opts);
}
