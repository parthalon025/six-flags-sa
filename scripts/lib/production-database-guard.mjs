/** Re-export app guard for deploy-gate script tests (#436). */
export {
  isProductionRuntime,
  checkProductionDatabaseGuard,
  databaseUrlConfigured,
  PRODUCTION_DATABASE_GUARD_MESSAGE,
} from '../../apps/party-tracker/lib/db/productionDatabaseGuard.js';
