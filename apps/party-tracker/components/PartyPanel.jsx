'use client';

import { useEffect, useState } from 'react';
import QrScanner from '@/components/QrScanner';
import Icon from '@/components/Icon';
import { GLYPHS, WORDS } from '@/lib/brand';
import { shareInvite } from '@/lib/native';
import { bearing, cardinal, distance, formatAge, formatDistance, formatWalk } from '@/lib/geo';
import { effectiveShareMode, locationCopy, placeAt } from '@/lib/location';
import { usePois } from '@/lib/venue/useVenue';
import { heightIsStale } from '@party-tracker/shared/schemas.js';

/* What you are doing. NEED HELP is deliberately not in this list: it was the
   same size and shape as "Eating", one row below it, and it buzzes every other
   phone in the party. It gets its own button, its own confirmation and its own
   way back. */
const STATUSES = [
  'On the move',
  'In line',
  'Eating',
  'Restroom',
  'Rallying',
  'Waiting here',
];
const HELP = 'NEED HELP';
const CALM = 'On the move';

function meetPlaceName(pois, lat, lng) {
  return placeAt(pois, lat, lng)?.name || null;
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
  hosting,
  status,
  onStatus,
  onShareMode = null,
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
  session = null,
  onSession = null,
  onAddDeviceLess = null,
  onTagDeviceLess = null,
  onRemoveDeviceLess = null,
  myGroupId = null,
  guests = [],
  onSeedGuest = null,
  onSaveGuest = null,
}) {
  const [entry, setEntry] = useState('');
  const [name, setName] = useState(myName === 'Guest' ? '' : myName || '');
  /* Which destructive button is one tap in. Only ever one at a time, and it
     clears itself, so a thumb resting on the screen cannot leave the party. */
  const [arming, setArming] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [showQr, setShowQr] = useState(true);
  const [guestName, setGuestName] = useState('');
  const [guestHeight, setGuestHeight] = useState('');
  const [staleGuest, setStaleGuest] = useState(null);
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
    const named = Boolean(name.trim());
    return (
      <div>
        <div className="label">Your Party</div>
        <p className="fine">
          Explore toilets, food and rides on your own first — a party is optional when the
          family wants to stick together. One phone starts it; everyone else joins by
          scanning the QR, opening the link, or typing the six-character code.
        </p>
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
          {named
            ? 'What the others see beside your dot.'
            : 'Add a name first — a roster of Guests is hard to read. You can still continue as Guest.'}
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
            : 'Codes never use I, O, 0 or 1, so they can be read out loud without confusion. Typing the code works for about 10 minutes while Party is open; the invite link and QR always work.'}
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

  /* Rounded up, so the last fifty seconds read "1 min left" rather than "0". */
  const joinsLeft = joinsOpenUntil > now ? Math.ceil((joinsOpenUntil - now) / 60000) : 0;

  /* E4.1: precise sharing is time-boxed and reverts to Approximate on its own
     once shareUntil passes — effectiveShareMode is the same call the runtime
     makes, so the chip never disagrees with what is actually on the wire. */
  const self = members.find((m) => m.id === myId) || null;
  const shareMode = effectiveShareMode(self, now);
  const shareLeft =
    shareMode === 'precise' && self?.shareUntil > now
      ? Math.ceil((self.shareUntil - now) / 60000)
      : 0;

  /* This is a phone, so the sheet every other app uses to send a link is the
     right thing to open. Clipboard is the fallback, and either way it says so —
     a copy that reports nothing is indistinguishable from one that failed, and
     the failure used to be swallowed entirely. */
  const share = async () => {
    const result = await shareInvite({ code, url: invite || undefined });
    if (result === 'copied') onCopied?.('Invite link copied');
    else if (result === 'failed') onCopied?.('Could not copy — read the code out instead');
  };

  return (
    <div data-hosting={hosting ? 'self' : 'peer'}>
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
          Send invite
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
            ? 'Leaving hands the live roster to another phone in the party.'
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
            The other phone points its camera at this. Typing the six-character code works for
            about 10 minutes while Party is open on this phone; the invite link and QR
            always carry the key and keep working.
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

      <div className="label">Roster</div>
      {sorted.length === 0 ? (
        <p className="fine">Waiting for the first position to land.</p>
      ) : (
        <div className="roster">
          {sorted.map((m) => {
            const isMe = m.id === myId;
            const located = m.visible;
            const live = located && m.live !== false;
            const offSite = !located;
            const d = me && located && !isMe ? distance(me.lat, me.lng, m.lat, m.lng) : null;
            const b = d != null ? bearing(me.lat, me.lng, m.lat, m.lng) : null;
            const stale = located && !live;
            const where = located
              ? locationCopy({
                  name: m.name,
                  place: m.place || m.location?.place || placeAt(pois, m.lat, m.lng),
                  live,
                })
              : null;
            const batt = Number.isFinite(m.battery?.level) ? Math.round(m.battery.level * 100) : null;
            const Row = m.deviceLess ? 'div' : 'button';
            return (
              <Row
                {...(m.deviceLess
                  ? {}
                  : { type: 'button', onClick: () => !isMe && located && onFocus(m) })}
                key={m.id}
                className={`memberRow ${stale ? 'stale' : ''}`}
              >
                <span className="pip" style={{ background: isMe ? 'var(--adventure)' : m.colour }}>
                  {m.initials}
                  <span
                    className={`partyDot ${
                      m.status === 'NEED HELP'
                        ? 'separated'
                        : stale
                          ? 'onTheWay'
                          : meet && located
                            ? 'meetHere'
                            : 'together'
                    }`}
                    title={
                      m.status === 'NEED HELP'
                        ? 'Separated'
                        : stale
                          ? 'On the way'
                          : meet && located
                            ? 'Rally here'
                            : 'Together'
                    }
                    aria-hidden="true"
                  />
                </span>
                <span className="memberText">
                  <b>
                    {m.name}
                    {isMe && <em className="chipTag">you</em>}
                    {m.groupId && <em className="chipTag">party {m.groupId}</em>}
                    {m.deviceLess && <em className="chipTag">no phone</em>}
                    {Number.isFinite(m.height) && <em className="chipTag">{m.height}&quot;</em>}
                    {batt != null && (
                      <em className="chipTag">
                        {batt}%{m.battery?.charging ? '⚡' : ''}
                      </em>
                    )}
                    {m.status === 'NEED HELP' && <em className="chipTag hot">help</em>}
                  </b>
                  <span>
                    {m.deviceLess
                      ? 'No phone'
                      : [where || (located ? null : 'No fix yet'), m.status, formatAge(Date.now() - m.ts)]
                          .filter(Boolean)
                          .join(' · ')}
                  </span>
                  {m.deviceLess && (onTagDeviceLess || onRemoveDeviceLess) ? (
                    <span className="joinRow" style={{ marginTop: 6 }}>
                      {onTagDeviceLess && !(myGroupId && m.groupId === myGroupId) ? (
                        <button
                          type="button"
                          className="btn small"
                          onClick={() => onTagDeviceLess(m.id)}
                        >
                          With me
                        </button>
                      ) : null}
                      {onRemoveDeviceLess ? (
                        <button
                          type="button"
                          className="btn small"
                          onClick={() => onRemoveDeviceLess(m.id)}
                        >
                          Remove
                        </button>
                      ) : null}
                    </span>
                  ) : null}
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
              </Row>
            );
          })}
        </div>
      )}

      {onAddDeviceLess && (
        <>
          <div className="label">Add someone without a phone</div>
          <p className="fine" style={{ marginTop: 0 }}>
            A device-less Member still counts for Eligibility. Height stays on the roster.
          </p>
          {session?.userId && guests.length > 0 ? (
            <div className="chips wrap" style={{ marginBottom: 8 }}>
              {guests.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  className="chip"
                  onClick={() => {
                    if (heightIsStale(g) && !staleGuest) {
                      setStaleGuest(g);
                      return;
                    }
                    onSeedGuest?.(g);
                    setStaleGuest(null);
                  }}
                >
                  {g.displayName}
                  {Number.isFinite(g.heightIn) ? ` · ${g.heightIn}"` : ''}
                </button>
              ))}
            </div>
          ) : null}
          {staleGuest ? (
            <p className="fine warnText">
              {staleGuest.displayName} may have grown — last height {staleGuest.heightIn}&quot;.
              <button
                type="button"
                className="labelAction"
                onClick={() => {
                  onSeedGuest?.(staleGuest);
                  setStaleGuest(null);
                }}
              >
                Keep it
              </button>
              <button
                type="button"
                className="labelAction"
                onClick={() => {
                  setGuestName(staleGuest.displayName);
                  setGuestHeight(String(staleGuest.heightIn || ''));
                  setStaleGuest(null);
                }}
              >
                I&apos;ll update
              </button>
            </p>
          ) : null}
          <div className="joinRow">
            <input
              className="field"
              maxLength={14}
              placeholder="Name"
              aria-label="Device-less member name"
              value={guestName}
              onChange={(e) => setGuestName(e.target.value)}
            />
            <input
              className="field"
              inputMode="numeric"
              placeholder='Height "'
              aria-label="Height in inches"
              value={guestHeight}
              onChange={(e) => setGuestHeight(e.target.value)}
              style={{ maxWidth: 88 }}
            />
            <button
              type="button"
              className="btn small primary"
              disabled={!guestName.trim()}
              onClick={() => {
                const inches = Number(guestHeight);
                const height = Number.isFinite(inches) && inches > 0 ? inches : null;
                onAddDeviceLess({
                  name: guestName.trim(),
                  height,
                });
                if (session?.userId && onSaveGuest) {
                  onSaveGuest({
                    displayName: guestName.trim(),
                    heightIn: height,
                    heightConfirmedAt: new Date().toISOString(),
                  });
                }
                setGuestName('');
                setGuestHeight('');
              }}
            >
              Add
            </button>
          </div>
        </>
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

      <div className="label">
        Your Location
        {shareMode === 'precise' && shareLeft > 0 ? (
          <span className="labelRight">{shareLeft} min left</span>
        ) : null}
      </div>
      <div className="chips wrap">
        <button
          type="button"
          className={`chip ${shareMode === 'approx' ? 'on' : ''}`}
          onClick={() => onShareMode?.('approx')}
        >
          Approximate
        </button>
        <button
          type="button"
          className={`chip ${shareMode === 'precise' ? 'on' : ''}`}
          onClick={() => onShareMode?.('precise')}
        >
          Precise · 30 min
        </button>
      </div>
      <p className="fine" style={{ marginTop: 0 }}>
        {shareMode === 'precise'
          ? 'Sharing your exact spot with the party — it reverts to Approximate on its own.'
          : 'Approximate rounds your dot for the family map. Precise shares your exact spot for 30 minutes.'}
      </p>

      <div className="label">Rally Point</div>
      {onSuggestReunification ? (
        <button
          type="button"
          className="btn small"
          style={{ marginBottom: 8 }}
          disabled={reunifyBusy || sorted.length < 2}
          onClick={onSuggestReunification}
        >
          {reunifyBusy ? 'Finding a fair Rally Point…' : 'Suggest a Rally Point'}
        </button>
      ) : null}
      {meet ? (
        <div className="codeBox column">
          <div>
            <b>{meet.label}</b>
            <span className="fine block">
              {meetPlaceName(pois, meet.lat, meet.lng) ||
                `${meet.lat.toFixed(4)}, ${meet.lng.toFixed(4)}`}{' '}
              · set by {meet.by}
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
            <button
              type="button"
              className="btn small primary iconOnly"
              onClick={onNavigateMeet}
              aria-label={WORDS.navigation}
            >
              <Icon name={GLYPHS.walk} size={18} />
            </button>
            <button type="button" className="btn small" onClick={() => onFocus(meet)}>
              On the map
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
          No Rally Point yet. Tap the pin button on the map, then choose a Place in Explore to Rally the Party.
        </p>
      )}
    </div>
  );
}
