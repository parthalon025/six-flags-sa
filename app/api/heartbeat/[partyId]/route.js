import { commandRoute } from '@/app/api/_lib/party';
import { badRequest, isId, readJson, serverError } from '@/app/api/_lib/http';

export const dynamic = 'force-dynamic';

/**
 * Liveness, plus whatever changed cheaply. A heartbeat carrying neither battery
 * nor status still refreshes lastSeen but leaves `version` alone — that is the
 * reducer keeping idle parties quiet, not a failed write.
 */
export async function POST(request, { params }) {
  try {
    const { partyId } = await params;
    if (!isId(partyId)) return badRequest('Bad partyId');

    const body = await readJson(request);
    if (!body) return badRequest('Malformed body');

    const command = {};
    if (body.battery !== undefined) {
      const b = body.battery;
      if (b === null) command.battery = null;
      else if (b && typeof b === 'object' && Number.isFinite(Number(b.level))) {
        command.battery = { level: Number(b.level), charging: Boolean(b.charging) };
      } else return badRequest('Bad battery');
    }
    if (body.status !== undefined) {
      if (typeof body.status !== 'string') return badRequest('Bad status');
      command.status = body.status.slice(0, 40);
    }

    return commandRoute({ partyId, memberId: body.memberId, kind: 'heartbeat', body: command });
  } catch {
    return serverError('Store unavailable');
  }
}
