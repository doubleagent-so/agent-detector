export * from './types.ts';
export {
  resolveRoles,
  type ClientRole, type Evidence, type ProvenEvidence, type RoleCatalog, type RoleClaim, type RoleDeclaration, type RoleEntry,
  type RoleInput, type Roles, type SpoofedClaim,
} from './attribution.ts';
export { DEFAULT_SIGNATURES } from './signatures.ts';
export { createEngine, type Engine, type EngineOptions, type BeaconPayload } from './engine.ts';
export { fuse, recommend, type FuseInput } from './fusion.ts';
export { extractBehavior, type BehaviorFeatures, type BehaviorStats } from './behavior/features.ts';
export type { TraceEvent, TraceKind } from './behavior/trace.ts';
export { detectPage, validAction, type PageContext } from './profile.ts';
export { timeline } from './timeline.ts';
export { scanMarkers } from './env/markers.ts';
export * from './catalog/index.ts';

export * from './conduct.ts';

export { SOFT_SIGNAL_REVISIONS } from './evidence.ts';
