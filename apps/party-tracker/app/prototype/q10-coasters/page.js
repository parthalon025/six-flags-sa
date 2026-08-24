'use client';

/* PROTOTYPE. Three jobs on one souvenir plate, switchable via ?variant=.
 * A enter a land · B pick a ride · C walk from the gate
 * Same paint. Not palettes, themes, or new visuals. */

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import PrototypeSwitcher from '@/components/prototype/PrototypeSwitcher.jsx';
import VariantRooms from './VariantRooms.jsx';
import VariantPostcards from './VariantPostcards.jsx';
import VariantCourse from './VariantCourse.jsx';
import {
  VARIANTS,
  VENUE,
  landNamesOf,
  projector,
  readWorld,
  rideZone,
  ridesInZone,
} from './q10World.js';

const VIEWS = { A: VariantRooms, B: VariantPostcards, C: VariantCourse };

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
  const land = params.get('land') || fromRide || pack?.lands?.[0]?.name || '';
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

  const pick = (name) => {
    const zone = pack ? rideZone(pack.coasters.find((p) => p.n === name), names) : null;
    write({ primary: name, land: zone || land });
  };

  const pickLand = (name) => {
    const here = pack ? ridesInZone(pack.coasters, name, names) : [];
    const keep = here.some((p) => p.n === primary);
    write({ land: name, primary: keep ? primary : (here[0]?.n || primary) });
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
        <strong>Q10 · readable land</strong>
        <span>{thesis.name} — {thesis.thesis}</span>
        <span>
          {pack.lands.length} lands · {pack.coasters.length} rides · land {land} · primary {primary}
        </span>
      </header>
      <div style={{ flex: 1, minHeight: 0 }}>
        <View
          world={pack}
          project={project}
          primary={primary}
          land={land}
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
