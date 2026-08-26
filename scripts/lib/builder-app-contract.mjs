/**
 * Builder ↔ app contract gate — re-export from venue-builder delivery module.
 *
 * Canonical implementation: packages/venue-builder/lib/delivery/builder-app-contract.mjs
 * Relative import here so gate-tests runs before `npm ci` can link workspaces.
 */
export {
  collectGeneratedFileHashes,
  buildGeneratedBinding,
  bindingDecision,
  aggregateBindingSha256,
  checkBuilderAppContract,
} from '../../packages/venue-builder/lib/delivery/builder-app-contract.mjs';
