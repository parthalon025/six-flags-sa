'use client';

/* Train H thin vertical (#563), dev-only. Flag-gated the same way as the
   display spike: off unless NEXT_PUBLIC_BANDED_WORLD_PREVIEW=1, so the shipped
   experience is untouched. Not linked from anywhere — reached by URL. */

import { useState } from 'react';
import BandedWorldMap from '@/components/BandedWorldMap';
import {
  PREVIEW_SKINS,
  PREVIEW_VENUE,
  bandedWorldPreviewEnabled,
} from '@/lib/bandedWorldPreview';

/* Inline rather than globals.css — see the note in BandedWorldMap.jsx. */
const S = {
  page: { position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column', background: '#0d1b22' },
  bar: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.75rem',
    padding: '0.5rem 0.75rem',
    background: '#10242d',
    color: '#e8f1f2',
    font: '500 0.85rem/1.2 system-ui, sans-serif',
  },
  venue: { opacity: 0.7 },
  skins: { display: 'flex', gap: '0.35rem', marginLeft: 'auto' },
  skin: (on) => ({
    padding: '0.3rem 0.6rem',
    border: '1px solid #2b4c58',
    borderRadius: '999px',
    background: on ? '#2b4c58' : 'transparent',
    color: 'inherit',
    font: 'inherit',
    cursor: 'pointer',
  }),
  off: { margin: '2rem', padding: '0.6rem 0.8rem', borderRadius: '0.5rem', background: '#10242d', color: '#cfe3e8', font: '500 0.8rem/1.4 system-ui, sans-serif' },
};

export default function BandedWorldPreviewPage() {
  const [skin, setSkin] = useState(PREVIEW_SKINS[0]);

  if (!bandedWorldPreviewEnabled()) {
    return (
      <main style={S.off} data-testid="banded-world-disabled">
        <p>
          Banded world preview is off. Set <code>NEXT_PUBLIC_BANDED_WORLD_PREVIEW=1</code> and
          restart to enable it.
        </p>
      </main>
    );
  }

  return (
    <main style={S.page}>
      <header style={S.bar}>
        <span style={S.venue}>{PREVIEW_VENUE}</span>
        <div style={S.skins} role="group" aria-label="Skin">
          {PREVIEW_SKINS.map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => setSkin(id)}
              aria-pressed={skin === id}
              style={S.skin(skin === id)}
              data-testid={`skin-${id}`}
            >
              {id}
            </button>
          ))}
        </div>
      </header>
      <BandedWorldMap
        skin={skin}
        /* Dev-only handle, same shape as DisplayMap's onMapReady: it lets a
           Playwright driver or a perf trace set the camera directly instead of
           synthesising pinch gestures. The route's flag is what keeps this out
           of the shipped experience. */
        onReady={(map) => {
          window.__bandedMap = map;
        }}
      />
    </main>
  );
}
