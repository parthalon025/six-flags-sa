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

export default function BandedWorldPreviewPage() {
  const [skin, setSkin] = useState(PREVIEW_SKINS[0]);

  if (!bandedWorldPreviewEnabled()) {
    return (
      <main className="bandedWorldOff" data-testid="banded-world-disabled">
        <p>
          Banded world preview is off. Set <code>NEXT_PUBLIC_BANDED_WORLD_PREVIEW=1</code> and
          restart to enable it.
        </p>
      </main>
    );
  }

  return (
    <main className="bandedWorldPage">
      <header className="bandedWorldBar">
        <span className="bandedWorldVenue">{PREVIEW_VENUE}</span>
        <div className="bandedWorldSkins" role="group" aria-label="Skin">
          {PREVIEW_SKINS.map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => setSkin(id)}
              aria-pressed={skin === id}
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
