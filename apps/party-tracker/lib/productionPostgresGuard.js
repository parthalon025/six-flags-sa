/**
 * Production Postgres credential guard (#436).
 * Dev/test memory mode stays untouched; production must have DATABASE_URL.
 */
export {
  isProductionRuntime,
  checkProductionPostgresGuard,
  postgresCredentialsConfigured,
  PRODUCTION_POSTGRES_GUARD_MESSAGE,
} from '../../../scripts/lib/production-postgres-guard.mjs';
