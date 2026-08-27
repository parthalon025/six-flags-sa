'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  estimatePyramidBytes,
  formatBundleBytes,
  pyramidBandEntries,
  readBundleManifest,
  syncVenueBundle,
} from '@/lib/venue/download';

/**
 * Guest opt-in pyramid download (ADR-0021 clause 5).
 *
 * States the byte size for overview + close bands before any pyramid bytes
 * move, and runs the download only when the guest taps the button — never on
 * wear or app start.
 */
export default function OfflineParkDownload({ venue }) {
  const [manifest, setManifest] = useState(null);
  const [ready, setReady] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    if (!venue?.id) {
      setManifest(null);
      setReady(true);
      return;
    }
    setReady(false);
    setError(null);
    const next = await readBundleManifest(venue);
    setManifest(next);
    setReady(true);
  }, [venue]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const pyramidBytes = estimatePyramidBytes(manifest);
  const pyramidFiles = pyramidBandEntries(manifest);
  const sizeLabel = formatBundleBytes(pyramidBytes);

  const download = async () => {
    if (!venue?.id || downloading || pyramidBytes < 1) return;
    setDownloading(true);
    setError(null);
    const result = await syncVenueBundle(venue, { scope: 'pyramid' });
    setDownloading(false);
    if (result.ok) {
      setDone(true);
      await refresh();
      return;
    }
    setError(
      result.reason === 'offline'
        ? 'No connection — try again when you have signal.'
        : 'Could not download detail bands. Try again in a moment.',
    );
  };

  if (!venue?.id || !ready) return null;
  if (!pyramidFiles.length) return null;

  return (
    <div className="offlineParkCard" data-testid="offline-park-download">
      <div className="label eyebrow">Offline detail</div>
      <p className="fine block">
        {done ? (
          <>
            <b>{venue.name || 'This park'}</b> detail bands are on this phone — overview and close
            zoom levels stay sharp with no signal.
          </>
        ) : (
          <>
            Make <b>{venue.name || 'this park'}</b> available offline for close-up map detail.
            Mid zoom already ships with the park; this adds overview and close bands (
            <span data-testid="offline-park-bytes">{sizeLabel}</span>).
          </>
        )}
      </p>
      {!done && (
        <button
          type="button"
          className="btn"
          data-testid="offline-park-download-btn"
          disabled={downloading || pyramidBytes < 1}
          onClick={download}
        >
          {downloading ? 'Downloading…' : `Make this park available offline (${sizeLabel})`}
        </button>
      )}
      {error && (
        <p className="fine block" data-testid="offline-park-error">
          {error}
        </p>
      )}
    </div>
  );
}
