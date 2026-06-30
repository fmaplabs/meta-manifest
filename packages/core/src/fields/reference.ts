import { Field, type DecodeResult, type FieldValidation } from "./base";

interface RefOptions<R extends boolean = false> {
  name?: string;
  description?: string;
  required?: R;
}

abstract class GidField<R extends boolean> extends Field<string, string, R> {
  constructor(opts: RefOptions<R>) {
    super();
    this.required = opts.required ?? false;
    this.name = opts.name;
    this.description = opts.description;
  }
  protected toJson(value: string): unknown {
    return value;
  }
  protected fromJson(json: unknown): DecodeResult<string> {
    if (typeof json !== "string") return { issues: [{ message: `Expected a GID string, got ${typeof json}` }] };
    return { value: json };
  }
}

class SimpleRefField<R extends boolean> extends GidField<R> {
  constructor(opts: RefOptions<R>, readonly shopifyType: string) {
    super(opts);
  }
  validations(): FieldValidation[] {
    return [];
  }
}

export type FileType = "Image" | "Video";
interface FileOptions<R extends boolean = false> extends RefOptions<R> {
  accept?: readonly FileType[];
}
class FileField<R extends boolean> extends GidField<R> {
  readonly shopifyType = "file_reference";
  constructor(private readonly o: FileOptions<R>) {
    super(o);
  }
  validations(): FieldValidation[] {
    return this.o.accept != null ? [{ name: "file_type_options", value: JSON.stringify(this.o.accept) }] : [];
  }
}

export type TypeRef = { type: string } | (() => { type: string });
function resolveType(target: TypeRef): string {
  return typeof target === "function" ? target().type : target.type;
}
class MetaobjectRefField<R extends boolean> extends GidField<R> {
  readonly shopifyType = "metaobject_reference";
  constructor(private readonly target: TypeRef, opts: RefOptions<R>) {
    super(opts);
  }
  validations(): FieldValidation[] {
    return [{ name: "metaobject_definition_type", value: resolveType(this.target) }];
  }
}

export function product<R extends boolean = false>(opts: RefOptions<R> = {}) {
  return new SimpleRefField<R>(opts, "product_reference");
}
export function variant<R extends boolean = false>(opts: RefOptions<R> = {}) {
  return new SimpleRefField<R>(opts, "variant_reference");
}
export function collection<R extends boolean = false>(opts: RefOptions<R> = {}) {
  return new SimpleRefField<R>(opts, "collection_reference");
}
export function page<R extends boolean = false>(opts: RefOptions<R> = {}) {
  return new SimpleRefField<R>(opts, "page_reference");
}
export function file<R extends boolean = false>(opts: FileOptions<R> = {}) {
  return new FileField<R>(opts);
}
export function ref<R extends boolean = false>(target: TypeRef, opts: RefOptions<R> = {}) {
  return new MetaobjectRefField<R>(target, opts);
}
