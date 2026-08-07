'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ParkMap from '@/components/ParkMap';
import GpsGate from '@/components/GpsGate';
import CompassTape from '@/components/CompassTape';
import PartyPanel from '@/components/PartyPanel';
import GlanceRail from '@/components/GlanceRail';
import InstallCard from '@/components/InstallCard';
import RidesPanel from '@/components/RidesPanel';
import Diagnostics from '@/components/Diagnostics';
import useGeolocation from '@/components/useGeolocation';
import { POIS, CATEGORIES, eligibility } from '@/lib/park';
import { createPartyRuntime, takePendingInvite } from '@/lib/partyRuntime';
import {
  bearing,
  cardinal,
  distance,
  formatDistance,
  formatWalk,
  inPark,
} from '@/lib/geo';

const PALETTE = ['#4FD1A5', '#5AA9E6', '#B487E8', '#F09AC0', '#7FD4E8', '#C9A87C', '#8ED96B', '#FF9E6B'];
const colourFor = (id) => {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
};
const initialsFor = (n) => (n || '?').trim().slice(0, 2).toUpperCase();

const DEFAULT_CATEGORIES = new Set(['coaster', 'ride', 'gate', 'landmark', 'service', 'food', 'restroom']);

/** How often the broadcast gate is asked whether the current fix is worth sending. */
const GATE_TICK_MS = 4000;

export default function Page() {
  const geo = useGeolocation();
  const { position, heading, shouldBroadcast } = geo;
  const [mapData, setMapData] = useState(null);
  const [gateOpen, setGateOpen] = useState(true);

  const [identity, setIdentity] = useState(null); // {id, name}
  const [party, setParty] = useState(null); // the runtime's snapshot
  const [localMeet, setLocalMeet] = useState(null); // a meet-up marked before joining anything
  const [status, setStatus] = useState('On the move');
  const [busy, setBusy] = useState(false);

  const [selected, setSelected] = useState(null);
  const [tab, setTab] = useState('party');
  const [sheet, setSheet] = useState('peek');
  const [follow, setFollow] = useState(true);
  const [armMeet, setArmMeet] = useState(false);
  const [tapeOn, setTapeOn] = useState(false);
  const [toast, setToast] = useState(null);
  const [height, setHeight] = useState(null);
  const [withAdult, setWithAdult] = useState(true);
  const [categories, setCategories] = useState(DEFAULT_CATEGORIES);
  const [focusPoint, setFocusPoint] = useState(null);
  const [theme, setTheme] = useState('night');

  const runtime = useRef(null);
  // Also in state, because the diagnostics panel is a render-time consumer and
  // a ref assigned inside an effect never triggers the render that reads it.
  const [runtimeApi, setRuntimeApi] = useState(null);
  const identityRef = useRef(null);
  const positionRef = useRef(null);
  const helpSeen = useRef(new Set());

  /* ---------- boot ---------- */
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }
  }, []);

  useEffect(() => {
    fetch('/parkmap.json')
      .then((r) => r.json())
      .then(setMapData)
      .catch(() => setToast('Could not load the park map file.'));
  }, []);

  useEffect(() => {
    let saved = null;
    try {
      saved = JSON.parse(localStorage.getItem('ki-identity') || 'null');
    } catch {
      saved = null;
    }
    const next = saved?.id
      ? saved
      : { id: Math.random().toString(36).slice(2, 10), name: 'Guest' };
    identityRef.current = next;
    setIdentity(next);
    if (saved?.height != null) setHeight(saved.height);
    // Follow the phone's own appearance setting until the visitor overrides it.
    if (saved?.theme) setTheme(saved.theme);
    else if (window.matchMedia?.('(prefers-color-scheme: light)').matches) setTheme('day');
  }, []);

  useEffect(() => {
    if (!identity) return;
    identityRef.current = identity;
    localStorage.setItem('ki-identity', JSON.stringify({ ...identity, height, theme }));
  }, [identity, height, theme]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  // Close the gate when the fix actually lands. Checking this inside the
  // "Allow location" handler cannot work: the permission prompt and the first
  // fix are both async, so status is still 'asking' when the click returns and
  // nothing looks again. The gate then sits over the whole UI intercepting
  // taps, and the only way out reads "Just show me the park map" — which is the
  // opposite of what someone who just granted location wants.
  useEffect(() => {
    if (geo.status === 'live') setGateOpen(false);
  }, [geo.status]);

  useEffect(() => {
    positionRef.current = position;
  }, [position]);

  const showToast = useCallback((msg) => {
    setToast(msg);
    setTimeout(() => setToast((t) => (t === msg ? null : t)), 3200);
  }, []);

  /* ---------- the party runtime ---------- */

  // One runtime for the life of the page. It owns the session, the transports
  // and whichever half of the protocol this device is running; everything below
  // reads its snapshot and calls its verbs.
  useEffect(() => {
    const rt = createPartyRuntime({ onState: setParty, onToast: showToast });
    runtime.current = rt;
    setRuntimeApi(rt);
    const memberName = identityRef.current?.name || 'Guest';
    // A link opened at /join parks its invite here rather than connecting on a
    // route it is about to navigate away from.
    const invite = takePendingInvite();
    Promise.resolve(invite ? rt.joinParty(invite, { memberName }) : rt.resume({ memberName })).catch(
      (err) => showToast(err?.message || 'Could not open that invite.'),
    );
    return () => {
      runtime.current = null;
      setRuntimeApi(null);
      rt.destroy();
    };
  }, [showToast]);

  const active = Boolean(party?.active);
  const code = party?.code ?? null;

  /**
   * The roster, flattened for the map, the rail and the tape — all of which
   * predate the party layer and read a member as a point with a name on it.
   */
  const roster = useMemo(
    () =>
      (party?.members || []).map((m) => ({
        ...m,
        lat: m.location?.lat,
        lng: m.location?.lng,
        acc: m.location?.acc ?? null,
        ts: m.location?.ts ?? m.lastSeen,
        colour: colourFor(m.id),
        initials: initialsFor(m.name),
      })),
    [party],
  );

  const others = useMemo(
    () => roster.filter((m) => m.id !== party?.selfId && Number.isFinite(m.lat)),
    [roster, party?.selfId],
  );

  const meet = party?.meet ?? localMeet;

  /**
   * The battery lever. Every fix goes through the adaptive gate before it goes
   * anywhere near a radio, and the gate — not this component — decides whether
   * it moved far enough, turned far enough, or has simply been quiet too long.
   */
  useEffect(() => {
    if (!active || !position) return undefined;
    const tick = () => {
      const fix = positionRef.current;
      if (!fix) return;
      // `now` is passed explicitly because the gate falls back to the fix's own
      // timestamp as its clock, and a phone that is standing still keeps being
      // handed the same cached fix — so that clock stops, every later tick is
      // rate-limited against it, and the heartbeat that exists to re-offer a
      // position which never landed can never come round.
      const decision = shouldBroadcast({ heading, now: Date.now() });
      if (!decision.send) return;
      runtime.current?.pushLocation({
        lat: fix.lat,
        lng: fix.lng,
        acc: fix.acc ?? null,
        heading: Number.isFinite(fix.heading) ? fix.heading : heading ?? null,
        speed: Number.isFinite(fix.speed) ? fix.speed : null,
        ts: fix.ts,
      });
    };
    tick();
    const id = setInterval(tick, GATE_TICK_MS);
    return () => clearInterval(id);
  }, [active, position, heading, shouldBroadcast]);

  // NEED HELP has to interrupt, once per person per episode.
  useEffect(() => {
    roster.forEach((m) => {
      if (m.id === party?.selfId) return;
      if (m.status === 'NEED HELP' && !helpSeen.current.has(m.id)) {
        helpSeen.current.add(m.id);
        const me = positionRef.current;
        const d = me && Number.isFinite(m.lat) ? distance(me.lat, me.lng, m.lat, m.lng) : null;
        showToast(`${m.name} needs help - ${formatDistance(d)}`);
        navigator.vibrate?.([120, 70, 120]);
      }
      if (m.status !== 'NEED HELP') helpSeen.current.delete(m.id);
    });
  }, [roster, party?.selfId, showToast]);

  /* ---------- party actions ---------- */
  const createParty = async () => {
    setBusy(true);
    try {
      const snap = await runtime.current.createParty({
        memberName: identity?.name || 'Guest',
        name: 'Party',
      });
      showToast(`Party ${snap.code} started`);
    } catch (err) {
      showToast(err?.message || 'Could not start a party.');
    }
    setBusy(false);
  };

  const joinParty = async (raw) => {
    setBusy(true);
    try {
      const snap = await runtime.current.joinParty(raw, { memberName: identity?.name || 'Guest' });
      showToast(`Joined ${snap.code}`);
    } catch (err) {
      showToast(err?.message || 'Could not join that party.');
    }
    setBusy(false);
  };

  const leaveParty = async () => {
    helpSeen.current.clear();
    await runtime.current?.leave();
  };

  const setMeetPoint = (lat, lng, label) => {
    setArmMeet(false);
    const record = { lat, lng, label: label || 'Meet-up' };
    if (active) {
      runtime.current?.setMeet(record);
      showToast('Meet-up shared with your party');
    } else {
      setLocalMeet({ ...record, by: identity?.name || 'Someone', ts: Date.now() });
      showToast('Meet-up marked (join a party to share it)');
    }
  };

  const clearMeet = () => {
    setLocalMeet(null);
    if (active) runtime.current?.setMeet(null);
  };

  /* ---------- derived ---------- */
  const dimmedNames = useMemo(() => {
    if (height == null) return null;
    const out = new Set();
    POIS.forEach((p) => {
      if (p.c !== 'coaster' && p.c !== 'ride') return;
      const v = eligibility(p, height, withAdult);
      if (v === 'no' || v === 'toobig') out.add(p.n);
    });
    return out;
  }, [height, withAdult]);

  const totalRides = useMemo(
    () => POIS.filter((p) => p.c === 'coaster' || p.c === 'ride').length,
    [],
  );

  const rideableCount = useMemo(() => {
    if (height == null) return null;
    return POIS.filter((p) => {
      if (p.c !== 'coaster' && p.c !== 'ride') return false;
      const v = eligibility(p, height, withAdult);
      return v === 'yes' || v === 'companion';
    }).length;
  }, [height, withAdult]);

  const nearest = useMemo(() => {
    if (!position) return null;
    let best = null;
    POIS.forEach((p) => {
      const d = distance(position.lat, position.lng, p.lat, p.lng);
      if (!best || d < best.d) best = { p, d };
    });
    return best;
  }, [position]);

  const focusOn = (target) => {
    setFollow(false);
    setFocusPoint({ lat: target.lat, lng: target.lng });
    setSheet('peek');
  };

  const handleMapTap = (lat, lng) => {
    if (armMeet) {
      setMeetPoint(lat, lng);
      return;
    }
    if (geo.status === 'manual' || geo.status === 'idle') geo.setManual(lat, lng);
  };

  const handleSelect = (poi) => {
    setSelected(poi);
    setFollow(false);
    setFocusPoint({ lat: poi.lat, lng: poi.lng });
    if (position) {
      const d = distance(position.lat, position.lng, poi.lat, poi.lng);
      const b = bearing(position.lat, position.lng, poi.lat, poi.lng);
      showToast(`${poi.n} · ${formatDistance(d)} ${cardinal(b)} · ${formatWalk(d)} walk`);
    }
  };

  const headerLine = () => {
    if (!position) return 'Mason, Ohio · no fix yet';
    const where = inPark(position.lat, position.lng) ? nearest?.p.a || 'in park' : 'off property';
    const acc = position.manual
      ? 'placed by hand'
      : `±${Math.round((position.acc || 0) * 3.28084)} ft`;
    return `${where.toUpperCase()} · ${nearest ? `near ${nearest.p.n}` : ''} · ${acc}`;
  };

  const sheetClass = `sheet ${sheet}`;

  return (
    <main className="app">
      <ParkMap
        data={mapData}
        pois={POIS}
        me={position}
        members={others}
        meet={meet}
        selected={selected}
        onSelectPoi={handleSelect}
        onMapTap={handleMapTap}
        armMeet={armMeet}
        follow={follow}
        onUserPan={() => setFollow(false)}
        heading={heading}
        dimmedNames={dimmedNames}
        visibleCategories={categories}
        focusPoint={focusPoint}
        theme={theme}
      />

      <header className="topbar">
        <div className="brand">
          <b>Kings Island</b>
          <span>{headerLine()}</span>
        </div>
        <button
          type="button"
          className="iconBtn"
          onClick={() => setTheme((t) => (t === 'day' ? 'night' : 'day'))}
          aria-label={theme === 'day' ? 'Switch to night map' : 'Switch to daylight map'}
        >
          {theme === 'day' ? '◑' : '◐'}
        </button>
        <button
          type="button"
          className={`iconBtn ${tapeOn ? 'on' : ''}`}
          onClick={() => {
            setTapeOn((v) => !v);
            geo.enableCompass();
          }}
          aria-label="Bearing tape"
        >
          ◈
        </button>
      </header>

      {height != null && (
        <button
          type="button"
          className="filterBadge"
          onClick={() => {
            setTab('rides');
            setSheet('half');
          }}
        >
          <b>{height}&quot;</b>
          {rideableCount != null ? `${rideableCount} of ${totalRides} rides` : 'filter on'}
        </button>
      )}

      {tapeOn && (
        <CompassTape
          me={position}
          members={others}
          meet={meet}
          selected={selected}
          heading={heading}
        />
      )}

      <div className={`fabs ${sheet}`}>
        <button
          type="button"
          className={`fab ${armMeet ? 'armed' : ''}`}
          onClick={() => {
            setArmMeet((v) => !v);
            if (!armMeet) {
              setSheet('peek');
              showToast('Tap the map to drop the meet-up point');
            }
          }}
          aria-label="Set meet-up"
        >
          ⚑
        </button>
        <button
          type="button"
          className={`fab ${follow ? 'active' : ''}`}
          onClick={() => {
            if (position) {
              setFollow(true);
              setFocusPoint({ lat: position.lat, lng: position.lng });
            } else {
              setGateOpen(true);
            }
          }}
          aria-label="Centre on me"
        >
          ◎
        </button>
      </div>

      <section className={sheetClass}>
        <button
          type="button"
          className="grab"
          onClick={() => setSheet(sheet === 'full' ? 'peek' : sheet === 'half' ? 'full' : 'half')}
          aria-label="Resize panel"
        >
          <i />
        </button>
        <GlanceRail
          me={position}
          members={others}
          meet={meet}
          selected={selected}
          heading={heading}
          theme={theme}
          onFocus={focusOn}
          onOpenParty={() => {
            setTab('party');
            setSheet('half');
          }}
        />
        <nav className="tabs" role="tablist">
          {[
            ['party', `Party${others.length ? ` · ${roster.length}` : ''}`],
            ['rides', 'Rides & heights'],
            ['me', 'Me'],
          ].map(([key, labelText]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              className={`tab ${tab === key ? 'on' : ''}`}
              onClick={() => {
                setTab(key);
                if (sheet === 'peek') setSheet('half');
              }}
            >
              {labelText}
            </button>
          ))}
        </nav>
        <div className="sheetBody">
          {tab === 'party' && (
            <PartyPanel
              code={code}
              invite={party?.invite ?? null}
              members={roster}
              meet={meet}
              me={position}
              myId={party?.selfId ?? null}
              hostId={party?.hostId ?? null}
              hosting={Boolean(party?.hosting)}
              status={status}
              onStatus={(s) => {
                setStatus(s);
                runtime.current?.setStatus(s);
                showToast(`Status: ${s}`);
              }}
              onCreate={createParty}
              onJoin={joinParty}
              onLeave={leaveParty}
              onClearMeet={clearMeet}
              onFocus={(m) => {
                setFollow(false);
                setFocusPoint({ lat: m.lat, lng: m.lng });
                setSheet('peek');
              }}
              busy={busy || party?.phase === 'connecting'}
              transport={party?.transport ?? null}
              version={party?.version ?? 0}
              queued={party?.queued ?? 0}
            />
          )}
          {tab === 'rides' && (
            <RidesPanel
              me={position}
              height={height}
              withAdult={withAdult}
              onHeight={setHeight}
              onWithAdult={setWithAdult}
              selected={selected}
              onSelect={handleSelect}
              onSetMeet={(p) => setMeetPoint(p.lat, p.lng, p.n)}
              theme={theme}
            />
          )}
          {tab === 'me' && (
            <div>
              <div className="label">Your name in the roster</div>
              <input
                className="field"
                maxLength={14}
                value={identity?.name === 'Guest' ? '' : identity?.name || ''}
                placeholder="NAME"
                onChange={(e) =>
                  setIdentity((i) => ({ ...i, name: e.target.value.trim() || 'Guest' }))
                }
                onBlur={(e) => runtime.current?.setMemberName(e.target.value.trim() || 'Guest')}
              />
              <div className="label">Location</div>
              <p className="fine">
                {position
                  ? `${position.manual ? 'Placed by hand' : 'Phone GPS'} · ${position.lat.toFixed(5)}, ${position.lng.toFixed(5)}`
                  : 'No fix yet.'}
              </p>
              <button type="button" className="btn" onClick={() => setGateOpen(true)}>
                Location settings
              </button>
              <div className="label">Install on this phone</div>
              <InstallCard />

              <div className="label">Map appearance</div>
              <div className="chips">
                {[
                  ['day', 'Daylight'],
                  ['night', 'Night'],
                ].map(([key, labelText]) => (
                  <button
                    key={key}
                    type="button"
                    className={`chip ${theme === key ? 'on' : ''}`}
                    onClick={() => setTheme(key)}
                  >
                    {labelText}
                  </button>
                ))}
              </div>
              <p className="fine">
                Daylight is the one to use outdoors — white midways on paper, dark type,
                and darker marker colours that survive direct sun. Night is easier on the
                eyes after the park lights come on.
              </p>

              <div className="label">Show on the map</div>
              <div className="chips wrap">
                {Object.entries(CATEGORIES).map(([key, cat]) => (
                  <button
                    key={key}
                    type="button"
                    className={`chip ${categories.has(key) ? 'on' : ''}`}
                    onClick={() =>
                      setCategories((prev) => {
                        const next = new Set(prev);
                        if (next.has(key)) next.delete(key);
                        else next.add(key);
                        return next;
                      })
                    }
                  >
                    {cat.label}
                  </button>
                ))}
              </div>

              <div className="label">Advanced diagnostics</div>
              <Diagnostics runtime={runtimeApi} geo={geo} />

              <div className="label">Where the data comes from</div>
              <p className="fine">
                The map itself is drawn from OpenStreetMap geometry for Kings Island —
                real paths, buildings, water and coaster track, painted as vectors rather
                than copied from the park&apos;s own printed map. Height requirements were
                compiled from Kings Island Central and Theme Park Insider in 2026; confirm
                at the ride entrance.
              </p>
            </div>
          )}
        </div>
      </section>

      {toast && (
        <div className="toast" role="status" aria-live="polite">
          {toast}
        </div>
      )}

      {gateOpen && (
        <GpsGate
          status={geo.status}
          error={geo.error}
          onRequest={() => {
            geo.request();
            geo.enableCompass();
          }}
          onManual={() => {
            setGateOpen(false);
            showToast('Tap the map to place yourself');
          }}
          onDismiss={() => setGateOpen(false)}
        />
      )}
    </main>
  );
}
