'use client';

/* PROTOTYPE. Throwaway. Not the guest map.
 *
 * Four variants of park-wide coaster ink, switchable via ?variant=, on
 * /prototype/q10-coasters. Real kings-island map.json + pois.
 *
 * Q10: at first paint, what coaster ink is on?
 *   A names only · B one owner rail · C named rails + loud owner · D every line
 */

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import PrototypeSwitcher from '@/components/prototype/PrototypeSwitcher.jsx';
import VariantA from './VariantA.jsx';
import VariantB from './VariantB.jsx';
import VariantC from './VariantC.jsx';
import VariantD from './VariantD.jsx';
import { VARIANTS, VENUE, inkStats, projector, readWorld } from './q10World.js';

function Q10Coasters() {
  const params = useSearchParams();
  const router = useRouter();
  const variant = (params.get('variant') || 'C').toUpperCase();
  const key = VARIANTS.some((v) => v.key === variant) ? variant : 'C';
  const thesis = VARIANTS.find((v) => v.key === key);

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

  const stats = inkStats(pack, key, primary);
  const props = { world: pack, project, primary, onPick: pick };
  const View = { A: VariantA, B: VariantB, C: VariantC, D: VariantD }[key];

  return (
    <main style={{ position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column', background: '#111' }}>
      <header style={S.hud} data-prototype-state="">
        <strong>Q10 · park-wide coaster ink</strong>
        <span>{thesis.name} — {thesis.thesis}</span>
        <span>
          primary {stats.primary} · join “{stats.join}” · {stats.ownerFragments} owner fragments · named rails {stats.namedOn} · unnamed {stats.unnamedOn} · service {stats.serviceOn}
        </span>
      </header>
      <div style={{ flex: 1, minHeight: 0 }}>
        <View {...props} />
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
    background: '#111',
    color: '#f4f1ea',
    font: '500 12px/1.35 var(--display), sans-serif',
    zIndex: 2,
  },
};
