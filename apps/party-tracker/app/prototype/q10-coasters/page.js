'use client';

/* PROTOTYPE. Three readable-land plates, switchable via ?variant=.
 * A souvenir wash · B land poster · C quiet midways
 * Goal: beautiful land, easily readable for a guest. */

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import PrototypeSwitcher from '@/components/prototype/PrototypeSwitcher.jsx';
import VariantSouvenir from './VariantSouvenir.jsx';
import VariantPoster from './VariantPoster.jsx';
import VariantMidway from './VariantMidway.jsx';
import { VARIANTS, VENUE, projector, readWorld } from './q10World.js';

const VIEWS = { A: VariantSouvenir, B: VariantPoster, C: VariantMidway };

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

  const primary = params.get('primary')
    || pack?.coasters?.find((p) => p.n === 'The Beast')?.n
    || pack?.coasters?.[0]?.n
    || 'The Beast';
  const project = useMemo(
    () => (pack ? projector(pack.bounds, 720, 920) : null),
    [pack],
  );

  const pick = (name) => {
    const next = new URLSearchParams(params.toString());
    next.set('variant', key);
    next.set('primary', name);
    router.replace(`?${next.toString()}`, { scroll: false });
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
          {pack.lands.length} lands · {pack.coasters.length} rides · primary {primary}
        </span>
      </header>
      <div style={{ flex: 1, minHeight: 0 }}>
        <View world={pack} project={project} primary={primary} onPick={pick} />
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
