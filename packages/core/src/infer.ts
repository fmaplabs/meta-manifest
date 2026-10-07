import type { Field } from "./fields/base";

export type FieldMap = Record<string, Field<any, any, any>>;

type FieldOut<T> = T extends Field<infer O, any, any> ? O : never;
type FieldIn<T> = T extends Field<any, infer I, any> ? I : never;
type IsRequired<T> = T extends Field<any, any, true> ? true : false;

type RequiredKeys<F extends FieldMap> = {
  [K in keyof F]: IsRequired<F[K]> extends true ? K : never;
}[keyof F];
type OptionalKeys<F extends FieldMap> = Exclude<keyof F, RequiredKeys<F>>;

type Simplify<T> = { [K in keyof T]: T[K] } & {};

export type Infer<F extends FieldMap> = Simplify<
  { [K in RequiredKeys<F>]: FieldOut<F[K]> } & { [K in OptionalKeys<F>]?: FieldOut<F[K]> }
>;
export type InferInput<F extends FieldMap> = Simplify<
  { [K in RequiredKeys<F>]: FieldIn<F[K]> } & { [K in OptionalKeys<F>]?: FieldIn<F[K]> }
>;
