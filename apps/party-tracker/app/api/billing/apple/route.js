import { json } from '@/app/api/_lib/http';

export const dynamic = 'force-dynamic';

/**
 * App Store Server Notifications v2 → profile_entitlements writer (ADR-0011a).
 * Stub until StoreKit purchase UI ships; verifies and upserts on original_transaction_id.
 */
export async function POST() {
  return json(
    {
      ok: false,
      status: 'not_implemented',
      message:
        'Apple billing webhook is reserved for StoreKit launch. Entitlements mint via profile/sync in prelaunch mode.',
    },
    501,
  );
}
