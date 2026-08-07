'use client';

import { useState } from 'react';
import { bearing, cardinal, distance, formatAge, formatDistance, formatWalk } from '@/lib/geo';
import { POIS } from '@/lib/park';

const STATUSES = [
  'On the move',
  'In line',
  'Eating',
  'Restroom',
  'Heading to meet-up',
  'Waiting here',
  'NEED HELP',
];

function nearestPlace(lat, lng) {
  let best = null;
  POIS.forEach((p) => {
    if (p.c === 'parking') return;
    const d = distance(lat, lng, p.lat, p.lng);
    if (!best || d < best.d) best = { p, d };
  });
  return best;
}

export default function PartyPanel({
  code,
  members,
  meet,
  me,
  myId,
  status,
  onStatus,
  onCreate,
  onJoin,
  onLeave,
  onClearMeet,
  onFocus,
  busy,
  durable,
  transport,
  lastSync,
}) {
  const [entry, setEntry] = useState('');

  if (!code) {
    return (
      <div>
        <div className="label">Group tracking</div>
        <p className="fine" style={{ marginTop: 0 }}>
          One person starts a party and reads out the code. Everyone else types it in.
          After that you see each other live — range, bearing, nearest ride and status.
        </p>
        <button type="button" className="btn primary" onClick={onCreate} disabled={busy}>
          {busy ? 'Starting…' : 'Start a party'}
        </button>
        <div className="label">Join an existing one</div>
        <div className="joinRow">
          <input
            className="field code"
            maxLength={5}
            placeholder="ABC12"
            value={entry}
            onChange={(e) => setEntry(e.target.value.toUpperCase())}
          />
          <button
            type="button"
            className="btn"
            onClick={() => onJoin(entry)}
            disabled={entry.length < 4 || busy}
          >
            Join
          </button>
        </div>
      </div>
    );
  }

  const sorted = [...members].sort((a, b) => {
    if (a.id === myId) return -1;
    if (b.id === myId) return 1;
    if (!me) return 0;
    return (
      distance(me.lat, me.lng, a.lat, a.lng) - distance(me.lat, me.lng, b.lat, b.lng)
    );
  });

  return (
    <div>
      <div className="label">
        Party code
        {lastSync ? (
          <span className="labelRight">
            {transport === 'stream' ? 'live' : 'polling'} · synced {formatAge(Date.now() - lastSync)}
          </span>
        ) : null}
      </div>
      <div className="codeBox">
        <span className="codeText">{code}</span>
        <button
          type="button"
          onClick={() => navigator.clipboard?.writeText(code).catch(() => {})}
        >
          Copy
        </button>
        <button type="button" onClick={onLeave}>
          Leave
        </button>
      </div>
      {transport !== 'stream' && (
        <p className="fine warnText">
          Polling every 8s. Point NEXT_PUBLIC_SYNC_URL at the standalone sync server for
          push updates instead.
        </p>
      )}

      <div className="label">Roster</div>
      {sorted.length === 0 ? (
        <p className="fine">Waiting for the first position to land.</p>
      ) : (
        <div className="roster">
          {sorted.map((m) => {
            const isMe = m.id === myId;
            const d = me && !isMe ? distance(me.lat, me.lng, m.lat, m.lng) : null;
            const b = d != null ? bearing(me.lat, me.lng, m.lat, m.lng) : null;
            const near = nearestPlace(m.lat, m.lng);
            const stale = Date.now() - m.ts > 300000;
            return (
              <button
                type="button"
                key={m.id}
                className={`memberRow ${stale ? 'stale' : ''}`}
                onClick={() => !isMe && onFocus(m)}
              >
                <span className="pip" style={{ background: isMe ? '#FFC24A' : m.colour }}>
                  {m.initials}
                </span>
                <span className="memberText">
                  <b>
                    {m.name}
                    {isMe && <em className="chipTag">you</em>}
                    {m.status === 'NEED HELP' && <em className="chipTag hot">help</em>}
                  </b>
                  <span>
                    {near ? near.p.n.toUpperCase() : '—'} · {m.status} · {formatAge(Date.now() - m.ts)}
                  </span>
                </span>
                <span className="memberRange">
                  {isMe ? (
                    <>
                      <b style={{ color: '#FFC24A' }}>•</b>
                      <span>HERE</span>
                    </>
                  ) : (
                    <>
                      <b>{formatDistance(d)}</b>
                      <span>{b != null ? `${cardinal(b)} ${Math.round(b)}°` : ''}</span>
                    </>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      )}

      <div className="label">Broadcast status</div>
      <div className="chips wrap">
        {STATUSES.map((s) => (
          <button
            key={s}
            type="button"
            className={`chip ${status === s ? 'on' : ''} ${s === 'NEED HELP' ? 'danger' : ''}`}
            onClick={() => onStatus(s)}
          >
            {s}
          </button>
        ))}
      </div>

      <div className="label">Meet-up point</div>
      {meet ? (
        <div className="codeBox column">
          <div>
            <b>{meet.label}</b>
            <span className="fine block">
              {nearestPlace(meet.lat, meet.lng)?.p.n.toUpperCase()} · set by {meet.by}
            </span>
            {me && (
              <span className="meetRange">
                {formatDistance(distance(me.lat, me.lng, meet.lat, meet.lng))}{' '}
                {cardinal(bearing(me.lat, me.lng, meet.lat, meet.lng))} ·{' '}
                {formatWalk(distance(me.lat, me.lng, meet.lat, meet.lng))} walk
              </span>
            )}
          </div>
          <div className="joinRow">
            <button type="button" className="btn small" onClick={() => onFocus(meet)}>
              Show on map
            </button>
            <button type="button" className="btn small" onClick={onClearMeet}>
              Clear
            </button>
          </div>
        </div>
      ) : (
        <p className="fine">
          None set. Tap the pin button on the map then tap a spot, or open a place in
          Rides and make it the meet-up.
        </p>
      )}
    </div>
  );
}
