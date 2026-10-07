import { boolean } from "./boolean";
import { link } from "./link";
import { list } from "./list";
import { dimension, volume, weight } from "./measurement";
import { money } from "./money";
import { decimal, integer } from "./number";
import { rating } from "./rating";
import { collection, company, companyLocation, customer, file, mixedRef, order, page, product, ref, variant } from "./reference";
import { richText } from "./rich-text";
import { color, date, dateTime, json, url } from "./scalar";
import { multilineText, text } from "./text";

export const m = {
  text,
  multilineText,
  richText,
  integer,
  decimal,
  boolean,
  date,
  dateTime,
  url,
  color,
  json,
  link,
  money,
  dimension,
  weight,
  volume,
  rating,
  product,
  variant,
  collection,
  page,
  file,
  customer,
  order,
  company,
  companyLocation,
  ref,
  mixedRef,
  list,
} as const;

export { Field } from "./base";
export type { DecodeResult, FieldValidation, Issue } from "./base";
export type { Money } from "./money";
export type { LinkValue } from "./link";
export type { Measure } from "./measurement";
export type { Rating, RatingInput } from "./rating";
export type { FileType, TypeRef } from "./reference";
