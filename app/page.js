'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ParkMap from '@/components/ParkMap';
import GpsGate from '@/components/GpsGate';
import CompassTape from '@/components/CompassTape';
import PartyPanel from '@/components/PartyPanel';
import GlanceRail from '@/components/GlanceRail';
import InstallCard from '@/components/InstallCard';
import RidesPanel from '@/components/RidesPanel';
import useGeolocation from '@/components/useGeolocation';
import { POIS, CATEGORIES, eligibility } from '@/lib/park';
import { paletteFor } from '@/lib/theme';
import * as sync from '@/lib/sync';
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

export default function Page() {
  const geo = useGeolocation();
  const [mapData, setMapData] = useState(null);
  const [gateOpen, setGateOpen] = useState(true);

  const [identity, setIdentity] = useState(null); // {id, name}
  const [code, setCode] = useState(null);
  const [durable, setDurable] = useState(false);
  const [members, setMembers] = useState([]);
  const [meet, setMeet] = useState(null);
  const [status, setStatus] = useState('On the move');
  const [lastSync, setLastSync] = useState(null);
  const [busy, setBusy] = useState(false);
  const [transport, setTransport] = useState('polling');

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

  const lastPush = useRef(0);
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
    setIdentity(next);
    if (saved?.height != null) setHeight(saved.height);
    // Follow the phone's own appearance setting until the visitor overrides it.
    if (saved?.theme) setTheme(saved.theme);
    else if (window.matchMedia?.('(prefers-color-scheme: light)').matches) setTheme('day');
    if (saved?.code) setCode(saved.code);
  }, []);

  useEffect(() => {
    if (!identity) return;
    localStorage.setItem(
      'ki-identity',
      JSON.stringify({ ...identity, height, code, theme }),
    );
  }, [identity, height, code, theme]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const showToast = useCallback((msg) => {
    setToast(msg);
    setTimeout(() => setToast((t) => (t === msg ? null : t)), 3200);
  }, []);

  /* ---------- party sync ---------- */
  const decorate = useCallback(
    (list) =>
      list.map((m) => ({
        ...m,
        colour: colourFor(m.id),
        initials: initialsFor(m.name),
      })),
    [],
  );

  const pushPosition = useCallback(
    async (force = false, override = {}) => {
      if (!code || !identity || !geo.position) return;
      if (!force && Date.now() - lastPush.current < 12000) return;
      lastPush.current = Date.now();
      try {
        // `override` exists because a click that changes status and then pushes
        // in the same tick would otherwise send the previous render's value.
        const data = await sync.putMember(code, {
          id: identity.id,
          name: override.name ?? identity.name,
          lat: geo.position.lat,
          lng: geo.position.lng,
          acc: geo.position.acc,
          status: override.status ?? status,
          height: override.height ?? height,
        });
        if (data && !data.notFound) {
          setMembers(decorate(data.members));
          setMeet(data.meet);
          setLastSync(Date.now());
        }
      } catch {
        /* offline - the next tick retries */
      }
    },
    [code, identity, geo.position, status, height, decorate],
  );

  const applySnapshot = useCallback(
    (data) => {
      if (data?.gone) {
        setCode(null);
        showToast('That party has expired.');
        return;
      }
      const next = decorate(data.members || []);
      next.forEach((m) => {
        if (m.id === identity?.id) return;
        if (m.status === 'NEED HELP' && !helpSeen.current.has(m.id)) {
          helpSeen.current.add(m.id);
          const d = geo.position
            ? distance(geo.position.lat, geo.position.lng, m.lat, m.lng)
            : null;
          showToast(`${m.name} needs help - ${formatDistance(d)}`);
          navigator.vibrate?.([120, 70, 120]);
        }
        if (m.status !== 'NEED HELP') helpSeen.current.delete(m.id);
      });
      setMembers(next);
      setMeet(data.meet ?? null);
      setLastSync(Date.now());
    },
    [decorate, identity, geo.position, showToast],
  );

  const snapshotRef = useRef(applySnapshot);
  useEffect(() => {
    snapshotRef.current = applySnapshot;
  }, [applySnapshot]);

  useEffect(() => {
    if (!code) return undefined;
    const unsubscribe = sync.subscribe(
      code,
      (data) => snapshotRef.current(data),
      (mode) => setTransport(mode),
    );
    const push = setInterval(() => pushPosition(), 15000);
    return () => {
      unsubscribe();
      clearInterval(push);
    };
  }, [code, pushPosition]);

  useEffect(() => {
    if (geo.position) pushPosition();
  }, [geo.position, pushPosition]);

  /* ---------- party actions ---------- */
  const createParty = async () => {
    setBusy(true);
    try {
      const data = await sync.createParty();
      if (data.code) {
        setCode(data.code);
        setDurable(Boolean(data.durable));
        showToast(`Party ${data.code} started`);
        setTimeout(() => pushPosition(true), 50);
      } else showToast('Could not start a party.');
    } catch {
      showToast('Could not reach the server.');
    }
    setBusy(false);
  };

  const joinParty = async (raw) => {
    const clean = raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
    setBusy(true);
    try {
      const data = await sync.fetchParty(clean);
      if (!data || data.notFound) showToast(`No party with code ${clean}`);
      else {
        setCode(clean);
        setMembers(decorate(data.members));
        setMeet(data.meet);
        showToast(`Joined ${clean}`);
        setTimeout(() => pushPosition(true), 50);
      }
    } catch {
      showToast('Could not reach the server.');
    }
    setBusy(false);
  };

  const leaveParty = async () => {
    if (!code || !identity) return;
    const gone = code;
    setCode(null);
    setMembers([]);
    setMeet(null);
    await sync.removeMember(gone, identity.id).catch(() => {});
    showToast(`Left party ${gone}`);
  };

  const setMeetPoint = async (lat, lng, label) => {
    const record = { lat, lng, label: label || 'Meet-up', by: identity?.name || 'Someone', ts: Date.now() };
    setMeet(record);
    setArmMeet(false);
    if (code) {
      await sync.putMeet(code, record).catch(() => {});
      showToast('Meet-up shared with your party');
    } else showToast('Meet-up marked (join a party to share it)');
  };

  const clearMeet = async () => {
    setMeet(null);
    if (code) await sync.clearMeet(code).catch(() => {});
  };

  /* ---------- derived ---------- */
  const others = useMemo(
    () => members.filter((m) => m.id !== identity?.id),
    [members, identity],
  );

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
    if (!geo.position) return null;
    let best = null;
    POIS.forEach((p) => {
      const d = distance(geo.position.lat, geo.position.lng, p.lat, p.lng);
      if (!best || d < best.d) best = { p, d };
    });
    return best;
  }, [geo.position]);

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
    if (geo.position) {
      const d = distance(geo.position.lat, geo.position.lng, poi.lat, poi.lng);
      const b = bearing(geo.position.lat, geo.position.lng, poi.lat, poi.lng);
      showToast(`${poi.n} · ${formatDistance(d)} ${cardinal(b)} · ${formatWalk(d)} walk`);
    }
  };

  const headerLine = () => {
    if (!geo.position) return 'Mason, Ohio · no fix yet';
    const where = inPark(geo.position.lat, geo.position.lng)
      ? nearest?.p.a || 'in park'
      : 'off property';
    const acc = geo.position.manual
      ? 'placed by hand'
      : `±${Math.round((geo.position.acc || 0) * 3.28084)} ft`;
    return `${where.toUpperCase()} · ${nearest ? `near ${nearest.p.n}` : ''} · ${acc}`;
  };

  const sheetClass = `sheet ${sheet}`;

  return (
    <main className="app">
      <ParkMap
        data={mapData}
        pois={POIS}
        me={geo.position}
        members={others}
        meet={meet}
        selected={selected}
        onSelectPoi={handleSelect}
        onMapTap={handleMapTap}
        armMeet={armMeet}
        follow={follow}
        onUserPan={() => setFollow(false)}
        heading={geo.heading}
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
          {theme === 'day' ? '\u25D1' : '\u25D0'}
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
          me={geo.position}
          members={others}
          meet={meet}
          selected={selected}
          heading={geo.heading}
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
            if (geo.position) {
              setFollow(true);
              setFocusPoint({ lat: geo.position.lat, lng: geo.position.lng });
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
          me={geo.position}
          members={others}
          meet={meet}
          selected={selected}
          heading={geo.heading}
          theme={theme}
          onFocus={focusOn}
          onOpenParty={() => {
            setTab('party');
            setSheet('half');
          }}
        />
        <nav className="tabs" role="tablist">
          {[
            ['party', `Party${others.length ? ` · ${members.length}` : ''}`],
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
              members={members}
              meet={meet}
              me={geo.position}
              myId={identity?.id}
              status={status}
              onStatus={(s) => {
                setStatus(s);
                pushPosition(true, { status: s });
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
              busy={busy}
              durable={durable}
              transport={transport}
              lastSync={lastSync}
            />
          )}
          {tab === 'rides' && (
            <RidesPanel
              me={geo.position}
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
                onBlur={(e) =>
                  pushPosition(true, { name: e.target.value.trim() || 'Guest' })
                }
              />
              <div className="label">Location</div>
              <p className="fine">
                {geo.position
                  ? `${geo.position.manual ? 'Placed by hand' : 'Phone GPS'} · ${geo.position.lat.toFixed(5)}, ${geo.position.lng.toFixed(5)}`
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
            if (geo.status === 'live') setGateOpen(false);
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
