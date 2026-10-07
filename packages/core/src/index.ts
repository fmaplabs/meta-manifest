export { defineConfig, validateConfig, DEFAULT_API_VERSION } from "./config";
export type { Config, TokenConfig, CliConfig, ClientCredentialsConfig, AuthMode } from "./config";

export { m, Field } from "./fields/index";
export type { DecodeResult, FieldValidation, Issue, Money, Measure, Rating, RatingInput, FileType, TypeRef, LinkValue } from "./fields/index";

export { defineMetaobject, isMetaobjectSchema } from "./define";
export {
  defineMetafields,
  isMetafieldSet,
  isAppReservedNamespace,
  metafieldOwnerKey,
  APP_NAMESPACE,
  METAFIELD_OWNER_TYPES,
} from "./metafields";
export type {
  MetafieldOwner,
  MetafieldOwnerType,
  MetafieldOptions,
  MetafieldEntry,
  MetafieldSetConfig,
  MetafieldSet,
  MetafieldSetInput,
  AnyMetafieldSet,
} from "./metafields";
export { defineEntries, entryRef, parseEntryRef, ENTRY_REF_PREFIX } from "./entries";
export type { EntriesDef, EntriesOptions, EntryRef, AnyEntries } from "./entries";
export type {
  Infer,
  InferInput,
  MetaobjectSchema,
  MetaobjectConfig,
  AccessConfig,
  CapabilitiesConfig,
  ParseInput,
} from "./define";
import type { MetaobjectSchema } from "./define";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnySchema = MetaobjectSchema<any>;
export { generateSchemaSource, generateMetafieldsSource } from "./codegen";

export { toDefinitionInput } from "./definition-input";
export type { MetaobjectDefinitionInput, FieldDefinitionInput } from "./definition-input";

export { diff } from "./sync/diff";
export type { DiffOp, DefinitionChange } from "./sync/diff";
export { normalizeLocal, normalizeDefinition, normalizeRemote } from "./sync/normalize";
export type {
  RemoteDefinition,
  RemoteField,
  RemoteAccess,
  RemoteCapabilities,
  PulledDefinition,
} from "./sync/normalize";
export {
  resolveDefinitions,
  resolveMetafieldSets,
  metafieldPairs,
  effectiveNamespace,
  effectiveScope,
} from "./sync/resolve";
export type {
  ScopeConfig,
  Scope,
  LocalMetafieldDefinition,
  MetafieldAccess,
  MetafieldCapabilities,
} from "./sync/resolve";
export { refValidationsToIds, refValidationsToTypes } from "./sync/ref-validations";

export { pull, pullAll } from "./sync/pull";
export type { PulledRemote, PullScope } from "./sync/pull";
export { push } from "./sync/push";
export type { PushOptions, PushResult, PushOpResult } from "./sync/push";

export { resolveEntries, placeholderRefs, substituteFieldValue } from "./sync/entry-resolve";
export type { ResolvedEntry, EntryRefEdge } from "./sync/entry-resolve";
export { pullEntries } from "./sync/entry-pull";
export type { PulledEntry, PulledEntryField } from "./sync/entry-pull";
export { diffEntries } from "./sync/entry-diff";
export type { EntryOp } from "./sync/entry-diff";
export { pushEntries } from "./sync/entry-push";
export type { EntryPushResult, EntryPushOpResult } from "./sync/entry-push";
export { discoverMerchantMetafields, pullMetafields, toCanonicalNamespace } from "./sync/metafield-pull";
export type { MetafieldPair, PulledMetafieldDefinition } from "./sync/metafield-pull";
export { diffMetafields } from "./sync/metafield-diff";
export type { MetafieldOp, MetafieldChange } from "./sync/metafield-diff";
export { pushMetafields } from "./sync/metafield-push";
export type { MetafieldPushOptions, MetafieldPushResult, MetafieldPushOpResult } from "./sync/metafield-push";
export { SyncTransportError } from "./sync/client";
export type { AdminGraphQLClient } from "./sync/client";
// The raw GraphQL documents the sync engine sends. Exported so consumers (and
// the CLI package's tests) can build exact-match fake stores for AdminGraphQLClient.
export {
  PULL_DEFINITION_QUERY,
  LIST_DEFINITIONS_QUERY,
  CREATE_DEFINITION_MUTATION,
  UPDATE_DEFINITION_MUTATION,
  PULL_ENTRY_QUERY,
  UPSERT_ENTRY_MUTATION,
  CURRENT_APP_QUERY,
  ACCESS_SCOPES_QUERY,
  PULL_METAFIELD_DEFINITIONS_QUERY,
  CREATE_METAFIELD_DEFINITION_MUTATION,
  UPDATE_METAFIELD_DEFINITION_MUTATION,
  DELETE_METAFIELD_DEFINITION_MUTATION,
} from "./sync/client";

export type { StandardSchemaV1 } from "./standard-schema";
