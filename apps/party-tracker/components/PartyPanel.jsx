'use client';

import { useEffect, useState } from 'react';
import QrScanner from '@/components/QrScanner';
import Icon from '@/components/Icon';
import { GLYPHS, WORDS } from '@/lib/brand';
import { shareInvite } from '@/lib/native';
import { bearing, cardinal, distance, formatAge, formatDistance, formatWalk } from '@/lib/geo';
import { PRECISE_MAX_MS, effectiveShareMode, placeAt } from '@/lib/location';
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

/**
 * Where a Member is, in one phrase, coloured by how much to trust it.
 *
 * Every live state the roster can be in needs a slot here, because the phrase
 * is the only place the difference shows: a Member with no fix yet, one who has
 * left the venue, one whose last position has gone stale, and one who is simply
 * standing somewhere the venue has no name for are four different answers and
 * used to collapse into a blank line.
 */
function standing({ m, isMe, located, stale, placeName }) {
  if (m.status === HELP) return { text: 'Needs help', tone: 'help' };
  if (m.deviceLess) return { text: 'No phone', tone: 'quiet' };
  if (!located) return { text: isMe ? 'No fix yet' : 'Off site', tone: 'warn' };
  if (stale) {
    return {
      text: placeName ? `Last seen at ${placeName}` : 'Last known position',
      tone: 'warn',
    };
  }
  return { text: placeName || 'On the map', tone: 'ok' };
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
  car = null,
  onCar = null,
  onHeights = null,
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
        <div className="label eyebrow">Your Party</div>
        <p className="fine">
          Explore toilets, food and rides on your own first — a party is optional when the
          family wants to stick together. One phone starts it; everyone else joins by
          scanning the QR, opening the link, or typing the six-character code.
        </p>
        <div className="label eyebrow">Your Name</div>
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
          className="btn primary rect"
          onClick={() => {
            onName?.(name);
            onCreate();
          }}
          disabled={busy}
        >
          {busy ? 'Starting…' : 'Start a party'}
        </button>
        <div className="label eyebrow">Join an Existing One</div>
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
            className="btn rect"
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
        <button type="button" className="btn rect" onClick={() => setScanning((v) => !v)}>
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
      {/* The Party's own name for itself, and the code that lets someone in.
          The code is the real one off the wire — six characters from
          CODE_ALPHABET, which never carries a prefix and does not exist at all
          until a Party has been started. It is read out loud at 26px under
          Invite; up here it is identity, not an instruction. */}
      <div className="label eyebrow">
        Your Party · {sorted.length}
        <span className="codeChip">{code}</span>
      </div>

      {sorted.length === 0 ? (
        <p className="fine">Waiting for the first position to land.</p>
      ) : (
        <div className="roster">
          {sorted.map((m) => {
            const isMe = m.id === myId;
            const located = m.visible;
            const live = located && m.live !== false;
            const d = me && located && !isMe ? distance(me.lat, me.lng, m.lat, m.lng) : null;
            const b = d != null ? bearing(me.lat, me.lng, m.lat, m.lng) : null;
            const stale = located && !live;
            const placeName =
              (located
                ? m.place?.name || m.location?.place?.name || placeAt(pois, m.lat, m.lng)?.name
                : null) || null;
            const where = standing({ m, isMe, located, stale, placeName });
            const batt = Number.isFinite(m.battery?.level) ? Math.round(m.battery.level * 100) : null;
            /* Height is editable from here only for the seats this phone is
               allowed to write — itself, and the Members with no phone.
               lib/core/state.js `patch-member` drops anything else in silence,
               so offering the tap would be offering nothing. */
            const canSetHeight = Boolean(onHeights) && (isMe || m.deviceLess);
            /* The compass point belongs beside the place, not in the rail: a
               bearing is how you actually set off towards somebody, and nobody
               navigates a park by 328°. The rail carries the walk time, which
               is the same measurement said in the units a parent acts on, so
               the range in feet does not need saying twice. */
            const tail = [
              m.status && m.status !== HELP ? m.status : null,
              b != null ? cardinal(b) : null,
            ]
              .filter(Boolean)
              .join(' · ');
            /* Only somebody else's card, with a position to jump to, is worth
               tapping — and only a card that is not itself a button may hold
               the "Set a height" link, so the two rules are one rule. */
            const tappable = !m.deviceLess && !isMe && located;
            const Row = tappable ? 'button' : 'div';
            return (
              <Row
                {...(tappable ? { type: 'button', onClick: () => onFocus(m) } : {})}
                key={m.id}
                className={`memberRow ${stale ? 'stale' : ''} ${m.status === HELP ? 'help' : ''}`}
              >
                <span className="pip" style={{ background: isMe ? 'var(--adventure)' : m.colour }}>
                  {m.initials}
                  <span
                    className={`partyDot ${
                      m.status === HELP
                        ? 'separated'
                        : stale
                          ? 'onTheWay'
                          : meet && located
                            ? 'meetHere'
                            : 'together'
                    }`}
                    title={
                      m.status === HELP
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
                    {Number.isFinite(m.height) ? ` · ${m.height}"` : ''}
                    {isMe && <em className="chipTag">you</em>}
                    {m.groupId && <em className="chipTag">party {m.groupId}</em>}
                    {m.deviceLess && <em className="chipTag">no phone</em>}
                    {batt != null && (
                      <em className="chipTag">
                        {batt}%{m.battery?.charging ? '⚡' : ''}
                      </em>
                    )}
                    {/* Kept beside the card's red frame, not replaced by it: the
                        tag pulses, and it is what the roster is scanned for when
                        the screen is glanced at from arm's length. */}
                    {m.status === HELP && <em className="chipTag hot">help</em>}
                  </b>
                  <span>
                    <i className={`memberTone ${where.tone}`}>{where.text}</i>
                    {tail ? ` · ${tail}` : ''}
                  </span>
                  {canSetHeight ? (
                    <button
                      type="button"
                      className="memberHeightCta"
                      onClick={() => onHeights(m.id)}
                    >
                      {Number.isFinite(m.height) ? `${m.height}" · tap to change` : 'Set a height'}
                    </button>
                  ) : null}
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
                {/* The walk leads, because "six minutes away" is the number a
                    parent acts on; the age underneath says how much to trust
                    it. A seat with no phone has no position and no fix age, so
                    the rail says nothing rather than inventing "Off site" for
                    somebody who is standing right beside you. */}
                {m.deviceLess ? null : (
                  <span className="memberRange">
                    <b>
                      {isMe
                        ? located
                          ? 'Here'
                          : 'Off site'
                        : d != null
                          ? formatWalk(d)
                          : located
                            ? '—'
                            : 'Off site'}
                    </b>
                    <span>{Number.isFinite(m.ts) ? formatAge(Date.now() - m.ts) : ''}</span>
                  </span>
                )}
                {tappable && (
                  <span className="memberGo" aria-hidden="true">
                    <svg viewBox="0 0 24 24">
                      <path
                        d="M9 4.5 16.5 12 9 19.5"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.4"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </span>
                )}
              </Row>
            );
          })}
        </div>
      )}

      {/* The two things a party does to itself. Rally is the same fair-midpoint
          search the small button under Rally Point used to run — promoted, not
          duplicated — and it keeps that button's rule about needing two people
          and its busy label. The map's own Rally pin still arms a spot by hand. */}
      <div className="joinRow partyActions">
        <button
          type="button"
          className="btn primary rect"
          disabled={!onSuggestReunification || reunifyBusy || sorted.length < 2}
          onClick={() => onSuggestReunification?.()}
        >
          {reunifyBusy ? 'Finding a fair Rally Point…' : 'Rally the Party'}
        </button>
        {onCar ? (
          <button type="button" className="btn rect" onClick={onCar}>
            {car ? 'Where I parked' : 'Save where I parked'}
          </button>
        ) : null}
      </div>
      <p className="fine">
        Location stays inside your Party.
        {car ? '' : ' Where you parked stays on this phone — nobody in the party is told.'}
      </p>

      {/* Asked here rather than on the way in: a permission prompt at cold open
          is a question about nothing, and this is the first moment where the
          answer obviously matters. */}
      {onEnablePush && pushState !== 'granted' && pushState !== 'unsupported' ? (
        <>
          <div className="label eyebrow">In Your Pocket</div>
          <button type="button" className="btn rect" onClick={onEnablePush} disabled={pushNeedsInstall}>
            Tell me on this phone
          </button>
          <p className="fine">
            {pushNeedsInstall
              ? 'On an iPhone this needs the app on your Home Screen first — Me → Install on this phone.'
              : 'Right now a locked phone in a bag shows nothing at all when somebody needs you.'}
          </p>
        </>
      ) : null}

      <div className="label eyebrow">Rally Point</div>
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
          No Rally Point yet. Rally the Party finds a fair midpoint, or tap the pin button on the
          map and choose a Place in Explore to set one by hand.
        </p>
      )}

      <div className="label eyebrow">Broadcast Status</div>
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
        <button type="button" className="btn primary rect" onClick={() => onStatus(CALM)}>
          I&apos;m OK now
        </button>
      ) : (
        <button
          type="button"
          className="btn danger rect"
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

      <div className="label eyebrow">
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
          {`Precise · ${Math.round(PRECISE_MAX_MS / 60000)} min`}
        </button>
      </div>
      <p className="fine" style={{ marginTop: 0 }}>
        {shareMode === 'precise'
          ? 'Sharing your exact spot with the party — it reverts to Approximate on its own.'
          : 'Approximate rounds your dot for the family map. Precise shares your exact spot for 30 minutes.'}
      </p>

      {onAddDeviceLess && (
        <>
          <div className="label eyebrow">Add someone without a phone</div>
          <p className="fine" style={{ marginTop: 0 }}>
            A device-less Member still counts for Eligibility. Height stays on the roster, and
            this phone can set it for them.
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

      <div className="label eyebrow">
        Invite
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
      {/* The code at reading-out-loud size, beside the two things you do with
          it. This is the one place it is a thing to say rather than a thing to
          recognise, so it keeps its 26px monospace. */}
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

      <div className="label eyebrow">
        QR
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
    </div>
  );
}
