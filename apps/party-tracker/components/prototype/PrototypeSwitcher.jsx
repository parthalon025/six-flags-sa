'use client';

/* PROTOTYPE switcher — not product chrome. Hidden in production builds. */

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

export default function PrototypeSwitcher({ variants, current }) {
  const router = useRouter();
  const params = useSearchParams();
  const keys = variants.map((v) => v.key);
  const idx = Math.max(0, keys.indexOf(current));
  const meta = variants[idx] || variants[0];

  const go = (key) => {
    const next = new URLSearchParams(params.toString());
    next.set('variant', key);
    router.replace(`?${next.toString()}`, { scroll: false });
  };

  const step = (dir) => go(keys[(idx + dir + keys.length) % keys.length]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      const tag = e.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target?.isContentEditable) return;
      e.preventDefault();
      step(e.key === 'ArrowRight' ? 1 : -1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (process.env.NODE_ENV === 'production') return null;

  return (
    <div
      role="navigation"
      aria-label="Prototype variants"
      style={{
        position: 'fixed',
        left: '50%',
        bottom: 18,
        transform: 'translateX(-50%)',
        zIndex: 80,
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '8px 10px 8px 8px',
        borderRadius: 999,
        background: '#111',
        color: '#f4f1ea',
        boxShadow: '0 8px 28px rgba(0,0,0,.45)',
        font: '700 13px/1.2 var(--display), system-ui, sans-serif',
        letterSpacing: '-0.01em',
      }}
    >
      <button type="button" aria-label="Previous variant" onClick={() => step(-1)} style={btn}>
        ←
      </button>
        <span style={{ minWidth: 188, textAlign: 'center' }}>
        {meta.key} · {meta.name}
      </span>
      <button type="button" aria-label="Next variant" onClick={() => step(1)} style={btn}>
        →
      </button>
    </div>
  );
}

const btn = {
  width: 36,
  height: 36,
  border: 0,
  borderRadius: 999,
  background: '#f4f1ea',
  color: '#111',
  font: 'inherit',
  cursor: 'pointer',
};
