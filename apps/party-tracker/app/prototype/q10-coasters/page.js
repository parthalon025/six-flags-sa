'use client';

/* PROTOTYPE. Three game-map systems on the souvenir lands, via ?variant=.
 * A quest map · B fog atlas · C overworld hop
 * Systems, not palettes. */

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import PrototypeSwitcher from '@/components/prototype/PrototypeSwitcher.jsx';
import VariantQuest from './VariantQuest.jsx';
import VariantFog from './VariantFog.jsx';
import VariantOverworld from './VariantOverworld.jsx';
import {
  VARIANTS,
  VENUE,
  arrivalLandOf,
  landGraph,
  landNamesOf,
  neighborsOf,
  projector,
  readWorld,
  rideZone,
  ridesInZone,
} from './q10World.js';

const VIEWS = { A: VariantQuest, B: VariantFog, C: VariantOverworld };

function parseSeen(raw) {
  return new Set(String(raw || '').split(',').map((s) => s.trim()).filter(Boolean));
}

function Q10Coasters() {
  const params = useSearchParams();
  const router = useRouter();
  const variant = (params.get('variant') || 'A').toUpperCase();
  const key = VARIANTS.some((v) => v.key === variant) ? variant : 'A';
  const thesis = VARIANTS.find((v) => v.key === key);
  const View = VIEWS[key];

  const [pack, setPack] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (process.env.NODE_ENV === 'production') return undefined;
    let live = true;
    Promise.all([
      fetch(`/venues/${VENUE}.map.json`).then((r) => r.json()),
      fetch(`/venues/${VENUE}.pois.json`).then((r) => r.json()),
    ])
      .then(([map, pois]) => {
        if (live) setPack(readWorld(map, pois));
      })
      .catch((e) => {
        if (live) setErr(String(e.message || e));
      });
    return () => {
      live = false;
    };
  }, []);

  const names = pack ? landNamesOf(pack) : [];
  const primary = params.get('primary')
    || pack?.coasters?.find((p) => p.n === 'The Beast')?.n
    || pack?.coasters?.[0]?.n
    || 'The Beast';
  const fromRide = pack ? rideZone(pack.coasters.find((p) => p.n === primary), names) : null;
  const startLand = pack ? arrivalLandOf(pack) : null;
  const land = params.get('land') || fromRide || startLand || pack?.lands?.[0]?.name || '';
  const seen = useMemo(() => {
    const raw = params.get('seen');
    if (raw) return parseSeen(raw);
    return new Set([startLand, land].filter(Boolean));
  }, [params, startLand, land]);
  const project = useMemo(
    () => (pack ? projector(pack.bounds, 720, 920) : null),
    [pack],
  );

  const write = (patch) => {
    const next = new URLSearchParams(params.toString());
    next.set('variant', key);
    Object.entries(patch).forEach(([k, v]) => {
      if (v) next.set(k, v);
    });
    router.replace(`?${next.toString()}`, { scroll: false });
  };

  const remember = (name, extra = {}) => {
    const next = new Set(seen);
    if (name) next.add(name);
    write({ ...extra, seen: [...next].join(',') });
  };

  const pick = (name) => {
    const zone = pack ? rideZone(pack.coasters.find((p) => p.n === name), names) : null;
    remember(zone, { primary: name, land: zone || land });
  };

  const pickLand = (name) => {
    if (key === 'C' && pack) {
      const graph = landGraph(pack, 2);
      const open = new Set([land, ...neighborsOf(graph, land)]);
      if (!open.has(name)) return;
    }
    const here = pack ? ridesInZone(pack.coasters, name, names) : [];
    const keep = here.some((p) => p.n === primary);
    remember(name, { land: name, primary: keep ? primary : (here[0]?.n || primary) });
  };

  if (process.env.NODE_ENV === 'production') {
    return (
      <main style={{ padding: 24, font: '500 14px var(--display), sans-serif' }}>
        Local prototype. Not shipped.
      </main>
    );
  }

  if (err) return <main style={{ padding: 24 }}>Could not load {VENUE}: {err}</main>;
  if (!pack || !project) return <main style={{ padding: 24 }}>Loading {VENUE}…</main>;

  return (
    <main style={{ position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column', background: '#F6F0E2' }}>
      <header style={S.hud} data-prototype-state="">
        <strong>Q10 · game map</strong>
        <span>{thesis.name} — {thesis.thesis}</span>
        <span>
          {seen.size}/{pack.lands.length} charted · land {land} · quest {primary}
        </span>
      </header>
      <div style={{ flex: 1, minHeight: 0 }}>
        <View
          world={pack}
          project={project}
          primary={primary}
          land={land}
          seen={seen}
          onPick={pick}
          onLand={pickLand}
        />
      </div>
      <PrototypeSwitcher variants={VARIANTS} current={key} />
    </main>
  );
}

export default function Q10CoastersPage() {
  return (
    <Suspense fallback={<main style={{ padding: 24 }}>Loading…</main>}>
      <Q10Coasters />
    </Suspense>
  );
}

const S = {
  hud: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    padding: '10px 14px',
    background: '#F6F0E2',
    color: '#3d342c',
    font: '500 12px/1.35 var(--display), sans-serif',
    zIndex: 2,
    borderBottom: '1px solid #E0D6C2',
  },
};
