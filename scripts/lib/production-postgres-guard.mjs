/** Re-export app guard for deploy-gate script tests (#436). */
export {
  isProductionRuntime,
  checkProductionPostgresGuard,
  postgresCredentialsConfigured,
  PRODUCTION_POSTGRES_GUARD_MESSAGE,
} from '../../apps/party-tracker/lib/productionPostgresGuard.js';
