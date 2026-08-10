'use client';

import { useEffect, useState } from 'react';
import QrScanner from '@/components/QrScanner';
import { bearing, cardinal, distance, formatAge, formatDistance, formatWalk } from '@/lib/geo';
import { usePois } from '@/lib/venue/useVenue';

/* What you are doing. NEED HELP is deliberately not in this list: it was the
   same size and shape as "Eating", one row below it, and it buzzes every other
   phone in the party. It gets its own button, its own confirmation and its own
   way back. */
const STATUSES = [
  'On the move',
  'In line',
  'Eating',
  'Restroom',
  'Heading to meet-up',
  'Waiting here',
];
const HELP = 'NEED HELP';
const CALM = 'On the move';

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
  myName = '',
  onName = null,
  onCopied = null,
  pushState = 'idle',
  onEnablePush = null,
  pushNeedsInstall = false,
  joinsOpenUntil = 0,
  onAllowJoins = null,
  onSuggestReunification = null,
  reunifyBusy = false,
}) {
  const [entry, setEntry] = useState('');
  const [name, setName] = useState(myName === 'Guest' ? '' : myName || '');
  /* Which destructive button is one tap in. Only ever one at a time, and it
     clears itself, so a thumb resting on the screen cannot leave the party. */
  const [arming, setArming] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [showQr, setShowQr] = useState(true);
  const pois = usePois();
  /* The join window counts down while the screen is being looked at, so the
     number has to move on its own rather than only when a position lands. */
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);
  // An armed button forgets after a few seconds rather than waiting to be
  // pressed by accident later.
  useEffect(() => {
    if (!arming) return undefined;
    const t = setTimeout(() => setArming(null), 5000);
    return () => clearTimeout(t);
  }, [arming]);

  if (!code) {
    return (
      <div>
        <div className="label">Group Tracking</div>
        <p className="fine">
          One phone starts the party and hosts it. Everyone else joins by scanning the QR,
          opening the link, or typing the six-character code. Positions are sealed with a key
          that never reaches a server, and if the host walks off another phone takes over on
          its own. Your dot is only shared while you are on the map — off site, your phone
          stops sending your position.
        </p>
        <button
          type="button"
          className="btn primary"
          onClick={() => {
            onName?.(name);
            onCreate();
          }}
          disabled={busy}
        >
          {busy ? 'Starting…' : 'Start a party'}
        </button>
        <div className="label">Your Name</div>
        <input
          className="field"
          maxLength={14}
          placeholder="Name"
          aria-label="Your name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => onName?.(name)}
        />
        <p className="fine" style={{ marginTop: 0 }}>
          What the others see beside your dot. Without one everybody joins as “Guest”, and a
          roster of Guests is no roster at all.
        </p>
        <div className="label">Join an Existing One</div>
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
            onClick={() => {
              onName?.(name);
              onJoin(entry, name);
            }}
            disabled={entry.length < 6 || busy}
          >
            {busy ? 'Joining…' : 'Join'}
          </button>
        </div>
        {/* The field silently drops I, O, 0 and 1 as they are typed, which
            looks like a broken keyboard unless somebody says why. */}
        <p className="fine" style={{ marginTop: 0 }}>
          {entry.length > 0 && entry.length < 6
            ? `Six characters — ${6 - entry.length} to go.`
            : 'Codes never use I, O, 0 or 1, so they can be read out loud without confusion.'}
        </p>
        <button type="button" className="btn" onClick={() => setScanning((v) => !v)}>
          {scanning ? 'Stop the camera' : 'Scan a party QR'}
        </button>
        {scanning && (
          <QrScanner
            onResult={(text) => {
              setScanning(false);
              onName?.(name);
              onJoin(text, name);
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
  /* Rounded up, so the last fifty seconds read "1 min left" rather than "0". */
  const joinsLeft = joinsOpenUntil > now ? Math.ceil((joinsOpenUntil - now) / 60000) : 0;

  /* This is a phone, so the sheet every other app uses to send a link is the
     right thing to open. Clipboard is the fallback, and either way it says so —
     a copy that reports nothing is indistinguishable from one that failed, and
     the failure used to be swallowed entirely. */
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
  const share = async () => {
    const text = invite || code;
    if (canShare) {
      try {
        await navigator.share({ title: 'Join my party', text: `Party code ${code}`, url: invite || undefined });
        return;
      } catch {
        /* dismissed, or refused — fall through to the clipboard */
      }
    }
    try {
      await navigator.clipboard.writeText(text);
      onCopied?.('Invite link copied');
    } catch {
      onCopied?.('Could not copy — read the code out instead');
    }
  };

  return (
    <div>
      <div className="label">
        Party Code
        {hosting && onAllowJoins ? (
          joinsLeft > 0 ? (
            <span className="labelRight">Open to joining · {joinsLeft} min left</span>
          ) : (
            <button type="button" className="labelAction" onClick={onAllowJoins}>
              Let someone join
            </button>
          )
        ) : null}
      </div>
      <div className="codeBox">
        <span className="codeText">{code}</span>
        <button type="button" onClick={share}>
          {canShare ? 'Send invite' : 'Copy link'}
        </button>
        <button
          type="button"
          className="danger"
          onClick={() => (arming === 'leave' ? onLeave() : setArming('leave'))}
        >
          {arming === 'leave' ? 'Tap to confirm' : 'Leave'}
        </button>
      </div>
      {arming === 'leave' ? (
        <p className="fine warnText">
          {hosting
            ? 'This phone is holding the roster. Leaving hands it to another phone in the party.'
            : 'You will drop off everyone else’s map. Re-joining needs the code or the link again.'}
        </p>
      ) : null}
      {hosting && onAllowJoins && joinsLeft === 0 ? (
        <p className="fine">
          Typing this code in only works while this phone is expecting someone. The invite link
          and the QR keep working either way.
        </p>
      ) : null}

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

      {/* Asked here rather than on the way in: a permission prompt at cold open
          is a question about nothing, and this is the first moment where the
          answer obviously matters. */}
      {onEnablePush && pushState !== 'granted' && pushState !== 'unsupported' ? (
        <>
          <div className="label">In Your Pocket</div>
          <button type="button" className="btn" onClick={onEnablePush} disabled={pushNeedsInstall}>
            Tell me on this phone
          </button>
          <p className="fine">
            {pushNeedsInstall
              ? 'On an iPhone this needs the app on your Home Screen first — Me → Install on this phone.'
              : 'Right now a locked phone in a bag shows nothing at all when somebody needs you.'}
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
            const located = m.visible;
            const offSite = Number.isFinite(m.lat) && m.visible === false;
            const d = me && located && !isMe ? distance(me.lat, me.lng, m.lat, m.lng) : null;
            const b = d != null ? bearing(me.lat, me.lng, m.lat, m.lng) : null;
            const near = located ? nearestPlace(pois, m.lat, m.lng) : null;
            const stale = Date.now() - m.ts > 300000;
            const paused = m.sharingPaused;
            return (
              <button
                type="button"
                key={m.id}
                className={`memberRow ${stale && !paused ? 'stale' : ''} ${paused ? 'paused' : ''}`}
                onClick={() => !isMe && located && onFocus(m)}
              >
                <span className="pip" style={{ background: isMe ? 'var(--blue)' : m.colour }}>
                  {m.initials}
                </span>
                <span className="memberText">
                  <b>
                    {m.name}
                    {isMe && <em className="chipTag">you</em>}
                    {m.id === hostId && <em className="chipTag">host</em>}
                    {m.groupId && <em className="chipTag">grp {m.groupId}</em>}
                    {paused && <em className="chipTag">paused</em>}
                    {m.status === 'NEED HELP' && <em className="chipTag hot">help</em>}
                  </b>
                  <span>
                    {offSite
                      ? 'Off site · not on the map'
                      : near
                        ? near.p.n
                        : 'No fix yet'}{' '}
                    · {m.status} · {formatAge(Date.now() - m.ts)}
                  </span>
                </span>
                <span className="memberRange">
                  {isMe ? (
                    <>
                      <b style={{ color: 'var(--blue)' }}>•</b>
                      <span>{located ? 'Here' : 'Off site'}</span>
                    </>
                  ) : (
                    <>
                      <b>{formatDistance(d)}</b>
                      <span>{/* The compass point, not the degrees. Nobody navigates a park by 328°. */}
                    {b != null ? cardinal(b) : offSite ? 'Off site' : ''}</span>
                    </>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      )}

      <div className="label">Broadcast Status</div>
      <div className="chips wrap">
        {STATUSES.map((s) => (
          <button
            key={s}
            type="button"
            className={`chip ${status === s ? 'on' : ''}`}
            onClick={() => onStatus(s)}
          >
            {s}
          </button>
        ))}
      </div>

      {status === HELP ? (
        <button type="button" className="btn primary" onClick={() => onStatus(CALM)}>
          I&apos;m OK now
        </button>
      ) : (
        <button
          type="button"
          className="btn danger"
          onClick={() => (arming === 'help' ? onStatus(HELP) : setArming('help'))}
        >
          {arming === 'help' ? 'Tap again to alert everyone' : 'I need help'}
        </button>
      )}
      <p className="fine" style={{ marginTop: 0 }}>
        {status === HELP
          ? 'Everyone in the party has been told, and can see how far away you are.'
          : 'Buzzes every phone in the party and puts your name at the top of their screen.'}
      </p>

      <div className="label">Meet-Up Point</div>
      {onSuggestReunification ? (
        <button
          type="button"
          className="btn small"
          style={{ marginBottom: 8 }}
          disabled={reunifyBusy || sorted.length < 2}
          onClick={onSuggestReunification}
        >
          {reunifyBusy ? 'Finding fair point…' : 'Suggest reunification point'}
        </button>
      ) : null}
      {meet ? (
        <div className="codeBox column">
          <div>
            <b>{meet.label}</b>
            <span className="fine block">
              {nearestPlace(pois, meet.lat, meet.lng)?.p.n} · set by {meet.by}
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
            <button
              type="button"
              className="btn small"
              onClick={() => (arming === 'meet' ? onClearMeet() : setArming('meet'))}
            >
              {arming === 'meet' ? 'Clear for everyone?' : 'Clear'}
            </button>
          </div>
        </div>
      ) : (
        <p className="fine">
          None set. Tap the pin button on the map then tap a spot, or open a place in Explore and
          make it the meet-up.
        </p>
      )}
    </div>
  );
}
