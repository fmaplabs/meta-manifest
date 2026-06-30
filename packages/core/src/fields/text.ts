import { Field, type DecodeResult, type FieldValidation, type Issue } from "./base";

export interface TextOptions<R extends boolean = false> {
  name?: string;
  description?: string;
  required?: R;
  min?: number;
  max?: number;
  regex?: string;
  choices?: readonly string[];
}
export type MultilineOptions<R extends boolean = false> = Omit<TextOptions<R>, "choices">;

class TextField<R extends boolean> extends Field<string, string, R> {
  readonly shopifyType: string;
  constructor(private readonly opts: TextOptions<R>, multiline: boolean) {
    super();
    this.shopifyType = multiline ? "multi_line_text_field" : "single_line_text_field";
    this.required = opts.required ?? false;
    this.name = opts.name;
    this.description = opts.description;
  }
  validations(): FieldValidation[] {
    const v: FieldValidation[] = [];
    if (this.opts.min != null) v.push({ name: "min", value: String(this.opts.min) });
    if (this.opts.max != null) v.push({ name: "max", value: String(this.opts.max) });
    if (this.opts.regex != null) v.push({ name: "regex", value: this.opts.regex });
    if (this.opts.choices != null) v.push({ name: "choices", value: JSON.stringify(this.opts.choices) });
    return v;
  }
  protected toJson(value: string): unknown {
    return value;
  }
  protected fromJson(json: unknown): DecodeResult<string> {
    if (typeof json !== "string") return { issues: [{ message: `Expected string, got ${typeof json}` }] };
    return { value: json };
  }
  protected override check(value: string): Issue[] {
    const i: Issue[] = [];
    const { min, max, regex, choices } = this.opts;
    if (min != null && value.length < min) i.push({ message: `Must be at least ${min} characters` });
    if (max != null && value.length > max) i.push({ message: `Must be at most ${max} characters` });
    if (regex != null && !new RegExp(regex).test(value)) i.push({ message: `Must match ${regex}` });
    if (choices != null && !choices.includes(value)) i.push({ message: `Must be one of: ${choices.join(", ")}` });
    return i;
  }
}

export function text<R extends boolean = false>(opts: TextOptions<R> = {}): TextField<R> {
  return new TextField<R>(opts, false);
}
export function multilineText<R extends boolean = false>(opts: MultilineOptions<R> = {}): TextField<R> {
  return new TextField<R>(opts, true);
}
