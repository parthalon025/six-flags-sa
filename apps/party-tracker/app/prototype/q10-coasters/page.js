'use client';

/* PROTOTYPE. Throwaway. Not the guest map.
 *
 * Q10 ink locked as D (all rails). Switcher is now Google-style path LOD:
 *   O overview · S streets · F foot
 * on /prototype/q10-coasters?variant=O
 */

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import PrototypeSwitcher from '@/components/prototype/PrototypeSwitcher.jsx';
import VariantD from './VariantD.jsx';
import { VARIANTS, VENUE, bandBounds, bandOf, lodStats, projector, readWorld } from './q10World.js';

function Q10Coasters() {
  const params = useSearchParams();
  const router = useRouter();
  const variant = (params.get('variant') || 'O').toUpperCase();
  const key = VARIANTS.some((v) => v.key === variant) ? variant : 'O';
  const thesis = VARIANTS.find((v) => v.key === key);
  const band = bandOf(key);

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
  const focus = pack?.coasters?.find((p) => p.n === primary);
  const project = useMemo(() => {
    if (!pack) return null;
    return projector(bandBounds(pack.bounds, focus, band), 720, 920);
  }, [pack, focus, band]);

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

  const stats = lodStats(pack, band);

  return (
    <main style={{ position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column', background: '#111' }}>
      <header style={S.hud} data-prototype-state="">
        <strong>Q10 · D ink + Google path LOD</strong>
        <span>{thesis.name} — {thesis.thesis} Google plate: poured pavement, thin rails.</span>
        <span>
          {band} · rails {stats.railsOn} · midways on {stats.pathsOn}/{pack.paths.length}
          {' '}(arterial {stats.arterial} · street {stats.street} · foot {stats.foot})
          {' '}· service {stats.serviceOn}/{stats.serviceAll} · focus {primary}
        </span>
      </header>
      <div style={{ flex: 1, minHeight: 0 }}>
        <VariantD world={pack} project={project} primary={primary} onPick={pick} band={band} />
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
