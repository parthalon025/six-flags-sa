import { verifyWebhook } from '@clerk/nextjs/webhooks';
import { json, serverError } from '@/app/api/_lib/http';

export const dynamic = 'force-dynamic';

/** Clerk user lifecycle backup sync (ADR-0010). Primary mint is POST /api/profile/sync. */
export async function POST(request) {
  try {
    const evt = await verifyWebhook(request);
    switch (evt.type) {
      case 'user.created':
      case 'user.updated':
      case 'user.deleted':
        break;
      default:
        break;
    }
    return json({ ok: true, type: evt.type });
  } catch (err) {
    return serverError(String(err?.message || 'Webhook verification failed'));
  }
}
