/**
 * Profile subscription entitlements — Clerk is identity only (ADR-0011a).
 * Store rails write rows; prelaunch mode mints a complimentary entitlement until StoreKit ships.
 */

import { randomUUID } from 'node:crypto';
import {
  PROFILE_PRODUCT_ID,
  ENTITLEMENT_SOURCES,
  billingModeFromEnv,
  profilePriceLabel,
} from '@party-tracker/shared/billing.js';
import { getPool, usingPostgres } from '@/lib/db/postgres';

/** @typedef {{ active: boolean, source: string|null, productId: string, expiresAt: string|null, billingMode: 'prelaunch'|'enforce' }} ClientEntitlement */

const memory = new Map();

/** Canonical Profile SKU + price copy for clients (must match fastlane/store-identifiers.json). */
export function profileBillingCatalog() {
  return {
    productId: PROFILE_PRODUCT_ID,
    displayName: 'Profile',
    priceUsd: 10,
    duration: '1 year',
    priceLabel: profilePriceLabel({ priceUsd: 10, duration: 'year' }),
    billingMode: billingModeFromEnv(),
    clerkBilling: false,
    paymentChannels: {
      web: ENTITLEMENT_SOURCES.stripe,
      ios: ENTITLEMENT_SOURCES.apple,
      android: ENTITLEMENT_SOURCES.google,
    },
  };
}

/**
 * @param {{ status?: string, source?: string, product_id?: string, productId?: string, expires_at?: string|null, expiresAt?: string|null } | null | undefined} row
 * @returns {ClientEntitlement}
 */
export function entitlementForClient(row) {
  const status = row?.status || null;
  const active = status === 'active' || status === 'grace';
  return {
    active,
    source: row?.source || null,
    productId: row?.product_id || row?.productId || PROFILE_PRODUCT_ID,
    expiresAt: row?.expires_at || row?.expiresAt || null,
    billingMode: billingModeFromEnv(),
  };
}

function mapRow(row) {
  return {
    id: row.id,
    userId: row.user_id,
    source: row.source,
    productId: row.product_id,
    status: row.status,
    originalTransactionId: row.original_transaction_id,
    expiresAt: row.expires_at,
    environment: row.environment,
  };
}

/**
 * @param {string} userId
 * @returns {Promise<ReturnType<typeof mapRow> | null>}
 */
export async function getActiveEntitlement(userId) {
  const uid = String(userId || '').slice(0, 64);
  if (!uid) return null;

  if (!usingPostgres()) {
    const row = memory.get(uid);
    if (!row) return null;
    if (row.status !== 'active' && row.status !== 'grace') return null;
    if (row.expiresAt && Date.parse(row.expiresAt) < Date.now()) return null;
    return row;
  }

  const pool = await getPool();
  const res = await pool.query(
    `SELECT id, user_id, source, product_id, status, original_transaction_id, expires_at, environment
     FROM profile_entitlements
     WHERE user_id = $1
       AND status IN ('active', 'grace')
       AND (expires_at IS NULL OR expires_at > now())
     ORDER BY updated_at DESC
     LIMIT 1`,
    [uid],
  );
  if (res.rowCount === 0) return null;
  return mapRow(res.rows[0]);
}

/**
 * Prelaunch: signed-in users get a complimentary entitlement until StoreKit ships.
 * Enforce: does not mint — paid features require a store/web entitlement row.
 *
 * @param {string} userId
 */
export async function ensureEntitlementForSignedInUser(userId) {
  const existing = await getActiveEntitlement(userId);
  if (existing) return existing;
  if (billingModeFromEnv() !== 'prelaunch') return null;

  const uid = String(userId || '').slice(0, 64);
  if (!uid) return null;

  const txnId = `prelaunch_${uid}`;
  const row = {
    id: `ent_${randomUUID().replace(/-/g, '').slice(0, 16)}`,
    userId: uid,
    source: ENTITLEMENT_SOURCES.prelaunch,
    productId: PROFILE_PRODUCT_ID,
    status: 'active',
    originalTransactionId: txnId,
    expiresAt: null,
    environment: process.env.NODE_ENV === 'production' ? 'production' : 'sandbox',
  };

  if (!usingPostgres()) {
    memory.set(uid, row);
    return row;
  }

  const pool = await getPool();
  await pool.query(
    `INSERT INTO profile_entitlements
       (id, user_id, source, product_id, status, original_transaction_id, environment)
     VALUES ($1, $2, $3, $4, 'active', $5, $6)
     ON CONFLICT (source, original_transaction_id) WHERE original_transaction_id IS NOT NULL
     DO UPDATE SET status = 'active', updated_at = now()`,
    [row.id, uid, row.source, row.productId, txnId, row.environment],
  );

  return getActiveEntitlement(uid);
}
