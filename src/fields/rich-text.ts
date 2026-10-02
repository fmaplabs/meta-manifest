import { Field, type CommonFieldOptions, type DecodeResult, type FieldValidation } from "./base";

interface RichTextOptions<R extends boolean = false> extends CommonFieldOptions {
  required?: R;
}

/**
 * Shopify's rich-text AST (`{ type: 'root', children: [...] }`), stored as a
 * JSON wire string. Kept as `unknown` — consumers (e.g. hydrogen-react's
 * `RichText`) take the raw document.
 */
class RichTextField<R extends boolean> extends Field<unknown, unknown, R> {
  readonly shopifyType = "rich_text_field";
  protected override readonly wireIsJson = true;
  constructor(opts: RichTextOptions<R>) {
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

export function richText<R extends boolean = false>(opts: RichTextOptions<R> = {}) {
  return new RichTextField<R>(opts);
}
