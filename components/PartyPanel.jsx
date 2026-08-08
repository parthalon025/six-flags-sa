'use client';

import { useEffect, useState } from 'react';
import QrScanner from '@/components/QrScanner';
import { bearing, cardinal, distance, formatAge, formatDistance, formatWalk } from '@/lib/geo';
import { usePois } from '@/lib/venue/useVenue';

const STATUSES = [
  'On the move',
  'In line',
  'Eating',
  'Restroom',
  'Heading to meet-up',
  'Waiting here',
  'NEED HELP',
];

function nearestPlace(pois, lat, lng) {
  let best = null;
  pois.forEach((p) => {
    if (p.c === 'parking') return;
    const d = distance(lat, lng, p.lat, p.lng);
    if (!best || d < best.d) best = { p, d };
  });
  return best;
}

/**
 * The invite QR.
 *
 * `qrcode` is imported dynamically for one reason: it is a CommonJS package
 * whose browser build is selected by the bundler's browser field, and pulling
 * it in statically drags it into the server bundle of a page that is
 * prerendered. Rendering is a no-op until there is an invite to encode, so the
 * module is never fetched by a phone that has not started a party.
 */
function InviteQr({ invite }) {
  const [src, setSrc] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!invite) return undefined;
    let cancelled = false;
    setFailed(false);
    import('qrcode')
      .then((mod) => (mod.default || mod).toDataURL(invite, {
        margin: 1,
        width: 232,
        errorCorrectionLevel: 'M',
        // Fixed black-on-white whatever the app theme is: a themed QR in
        // daylight mode is a QR that phones refuse to read.
        color: { dark: '#000000', light: '#ffffff' },
      }))
      .then((url) => {
        if (!cancelled) setSrc(url);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [invite]);

  if (failed) return <p className="fine">Could not draw the QR. Read out the code instead.</p>;
  if (!src) return <div className="qrBox" aria-hidden="true" />;
  return (
    <div className="qrBox">
      {/* eslint-disable-next-line @next/next/no-img-element -- a data: URL has nothing for next/image to optimise */}
      <img className="qrImg" src={src} alt="Scan to join this party" width={232} height={232} />
    </div>
  );
}

export default function PartyPanel({
  code,
  invite,
  members,
  meet,
  me,
  myId,
  hostId,
  hosting,
  status,
  onStatus,
  onCreate,
  onJoin,
  onLeave,
  onClearMeet,
  onNavigateMeet,
  onFocus,
  busy,
  transport,
  version,
  queued,
}) {
  const [entry, setEntry] = useState('');
  const [scanning, setScanning] = useState(false);
  const [showQr, setShowQr] = useState(true);
  const pois = usePois();

  if (!code) {
    return (
      <div>
        <div className="label">Group tracking</div>
        <p className="fine" style={{ marginTop: 0 }}>
          One phone starts the party and hosts it. Everyone else joins by scanning the QR,
          opening the link, or typing the six-character code. Positions are sealed with a key
          that never reaches a server, and if the host walks off another phone takes over on
          its own.
        </p>
        <button type="button" className="btn primary" onClick={onCreate} disabled={busy}>
          {busy ? 'Starting…' : 'Start a party'}
        </button>
        <div className="label">Join an existing one</div>
        <div className="joinRow">
          <input
            className="field code"
            maxLength={6}
            placeholder="ABC234"
            aria-label="Party code"
            value={entry}
            onChange={(e) => setEntry(e.target.value.toUpperCase().replace(/[^A-HJ-NP-Z2-9]/g, ''))}
          />
          <button
            type="button"
            className="btn"
            onClick={() => onJoin(entry)}
            disabled={entry.length < 6 || busy}
          >
            Join
          </button>
        </div>
        <button type="button" className="btn" onClick={() => setScanning((v) => !v)}>
          {scanning ? 'Stop the camera' : 'Scan a party QR'}
        </button>
        {scanning && (
          <QrScanner
            onResult={(text) => {
              setScanning(false);
              onJoin(text);
            }}
            onCancel={() => setScanning(false)}
          />
        )}
      </div>
    );
  }

  const sorted = [...members].sort((a, b) => {
    if (a.id === myId) return -1;
    if (b.id === myId) return 1;
    if (!me) return 0;
    return distance(me.lat, me.lng, a.lat, a.lng) - distance(me.lat, me.lng, b.lat, b.lng);
  });

  const hostName = members.find((m) => m.id === hostId)?.name;

  return (
    <div>
      <div className="label">
        Party code
        <span className="labelRight">
          {transport || 'connecting'} · v{version}
          {queued ? ` · ${queued} queued` : ''}
        </span>
      </div>
      <div className="codeBox">
        <span className="codeText">{code}</span>
        <button
          type="button"
          onClick={() => navigator.clipboard?.writeText(invite || code).catch(() => {})}
        >
          Copy link
        </button>
        <button type="button" onClick={onLeave}>
          Leave
        </button>
      </div>

      <div className="label">
        Invite
        <button type="button" className="labelAction" onClick={() => setShowQr((v) => !v)}>
          {showQr ? 'Hide' : 'Show'}
        </button>
      </div>
      {showQr ? (
        <>
          <InviteQr invite={invite} />
          <p className="fine">
            The other phone points its camera at this. The key that decrypts the party rides in
            the link&apos;s fragment, which browsers never send to a server.
          </p>
        </>
      ) : null}

      <div className="label">
        Hosting
        <span className="labelRight">{hosting ? 'this phone' : hostName || 'another phone'}</span>
      </div>
      <p className="fine" style={{ marginTop: 0 }}>
        {hosting
          ? 'This phone holds the roster and answers everyone else. If it drops off, the best-placed phone takes over by itself.'
          : `${hostName || 'Another phone'} holds the roster. If it drops off, this one may take over automatically.`}
      </p>

      <div className="label">Roster</div>
      {sorted.length === 0 ? (
        <p className="fine">Waiting for the first position to land.</p>
      ) : (
        <div className="roster">
          {sorted.map((m) => {
            const isMe = m.id === myId;
            const located = Number.isFinite(m.lat) && Number.isFinite(m.lng);
            const d = me && located && !isMe ? distance(me.lat, me.lng, m.lat, m.lng) : null;
            const b = d != null ? bearing(me.lat, me.lng, m.lat, m.lng) : null;
            const near = located ? nearestPlace(pois, m.lat, m.lng) : null;
            const stale = Date.now() - m.ts > 300000;
            return (
              <button
                type="button"
                key={m.id}
                className={`memberRow ${stale ? 'stale' : ''}`}
                onClick={() => !isMe && located && onFocus(m)}
              >
                <span className="pip" style={{ background: isMe ? 'var(--tint)' : m.colour }}>
                  {m.initials}
                </span>
                <span className="memberText">
                  <b>
                    {m.name}
                    {isMe && <em className="chipTag">you</em>}
                    {m.id === hostId && <em className="chipTag">host</em>}
                    {m.status === 'NEED HELP' && <em className="chipTag hot">help</em>}
                  </b>
                  <span>
                    {near ? near.p.n.toUpperCase() : 'NO FIX YET'} · {m.status} ·{' '}
                    {formatAge(Date.now() - m.ts)}
                  </span>
                </span>
                <span className="memberRange">
                  {isMe ? (
                    <>
                      <b style={{ color: 'var(--tint)' }}>•</b>
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
              {nearestPlace(pois, meet.lat, meet.lng)?.p.n.toUpperCase()} · set by {meet.by}
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
            <button type="button" className="btn small primary" onClick={onNavigateMeet}>
              Walk me there
            </button>
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
          None set. Tap the pin button on the map then tap a spot, or open a place in Rides and
          make it the meet-up.
        </p>
      )}
    </div>
  );
}
