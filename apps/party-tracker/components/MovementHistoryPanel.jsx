'use client';

import { useState } from 'react';
import BrandMark from '@/components/BrandMark';

/**
 * Movement history — opt-in walk log + ground-truth confirms for entrances,
 * exits and amenities. Uploads help the builder learn real midways and pins.
 */
export default function MovementHistoryPanel({ movement, venueName }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const [confirmClear, setConfirmClear] = useState(false);

  if (!movement) return null;

  const {
    enabled,
    setEnabled,
    summaries,
    totals,
    observations,
    nearbyConfirms,
    confirmNearby,
    uploadSessions,
    removeSession,
    clearHistory,
    exportSessionJson,
    formatMetres,
    formatDuration,
    featureLabels,
    ready,
  } = movement;

  const onToggle = () => {
    const next = !enabled;
    setEnabled(next);
    setMessage(
      next
        ? 'Walk tracking is on. Paths and nearby entrance/exit sightings stay on this phone until you upload.'
        : 'Walk tracking is off. Existing history is still here.',
    );
  };

  const onUpload = async (ids) => {
    setBusy(true);
    setMessage(null);
    try {
      const result = await uploadSessions(ids);
      if (!result.ok) {
        setMessage(result.error || 'Upload failed');
      } else {
        const bits = [];
        if (result.paths) bits.push(`${result.paths} path${result.paths === 1 ? '' : 's'}`);
        if (result.truth) bits.push(`${result.truth} ground-truth pin${result.truth === 1 ? '' : 's'}`);
        setMessage(
          `Uploaded ${bits.join(' · ') || `${result.count} session${result.count === 1 ? '' : 's'}`}. Thanks — that helps map real paths and entrances.`,
        );
      }
    } catch {
      setMessage('Upload failed. Try again when you have a signal.');
    } finally {
      setBusy(false);
    }
  };

  const onExport = (id) => {
    const collection = exportSessionJson(id);
    if (!collection) return;
    const blob = new Blob([JSON.stringify(collection, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `parkbound-walk-${id}.geojson`;
    a.click();
    URL.revokeObjectURL(url);
    setMessage('Saved a GeoJSON copy on this phone.');
  };

  const onClear = async () => {
    if (!confirmClear) {
      setConfirmClear(true);
      return;
    }
    setBusy(true);
    await clearHistory();
    setConfirmClear(false);
    setBusy(false);
    setMessage('Walk history cleared on this phone.');
  };

  const onConfirm = async (target) => {
    setBusy(true);
    setMessage(null);
    try {
      const result = await confirmNearby(target);
      setMessage(
        result.ok
          ? `Saved ${featureLabels[target.feature] || target.feature} at ${target.placeName}. Upload when you are ready.`
          : result.error || 'Could not save',
      );
    } catch {
      setMessage('Could not save that confirm.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="dayMoment">
        <BrandMark variant="glyph" size={22} aqua="var(--aqua)" className="brandMark" />
        <div>
          <b>Walks & ground truth</b>
          <span>
            {venueName
              ? `Log midways at ${venueName} and mark real queue entrances, exits and amenities so the map matches the park.`
              : 'Log midways and mark real queue entrances, exits and amenities so the map matches the park.'}
          </span>
        </div>
      </div>

      <div className="label">Tracking</div>
      <div className="rowList">
        <button
          type="button"
          className="row"
          onClick={onToggle}
          aria-pressed={enabled}
          disabled={!ready}
        >
          <span className="rowText">Log walks & nearby pins</span>
          <span className="rowValue">{enabled ? 'On' : 'Off'}</span>
        </button>
      </div>
      <p className="fine">
        Off by default. When on, GPS inside the park stays on this phone. Standing near a ride
        entrance or exit for a while records a dwell sighting automatically; you can also confirm
        “I am here” below. Uploads are anonymised — no name, rounded coordinates — and never write
        straight into the published map.
      </p>

      {enabled && nearbyConfirms?.length > 0 && (
        <>
          <div className="label">Near you — confirm ground truth</div>
          <div className="rowList">
            {nearbyConfirms.map((t) => (
              <button
                key={t.key}
                type="button"
                className="row"
                disabled={busy}
                onClick={() => onConfirm(t)}
              >
                <span className="rowText">
                  {featureLabels[t.feature] || t.feature} · {t.placeName}
                  <span className="fine" style={{ display: 'block', marginTop: 2 }}>
                    {Math.round(t.distanceM)} m away
                    {t.published ? '' : ' · no published pin yet'}
                  </span>
                </span>
                <span className="rowValue">I&apos;m here</span>
              </button>
            ))}
          </div>
          <p className="fine">
            Use this when you are standing at the queue entrance, the exit, a park gate, or an
            amenity — that pin becomes research evidence for the venue builder.
          </p>
        </>
      )}

      <div className="label">This phone</div>
      <div className="rowList">
        <div className="row">
          <span className="rowText">Walks saved</span>
          <span className="rowValue">{totals.walks}</span>
        </div>
        <div className="row">
          <span className="rowText">Distance logged</span>
          <span className="rowValue">{formatMetres(totals.metres)}</span>
        </div>
        <div className="row">
          <span className="rowText">Ground-truth pins</span>
          <span className="rowValue">{totals.observations}</span>
        </div>
        <div className="row">
          <span className="rowText">Ready to upload</span>
          <span className="rowValue">{totals.pending}</span>
        </div>
      </div>

      {totals.pending > 0 && (
        <>
          <div className="rowList" style={{ marginTop: 8 }}>
            <button
              type="button"
              className="row"
              disabled={busy}
              onClick={() => onUpload(null)}
            >
              <span className="rowText">Upload pending data</span>
              <span className="rowValue">{busy ? 'Sending…' : `${totals.pending}`}</span>
            </button>
          </div>
          <p className="fine">
            Uploads help the venue builder spot missing walkways and correct entrance / exit
            geometry. They never write straight into the published park map.
          </p>
        </>
      )}

      {message && <p className="fine block">{message}</p>}

      {observations?.length > 0 && (
        <>
          <div className="label">Ground truth</div>
          <div className="rowList">
            {observations.slice(0, 24).map((o) => (
              <div key={o.id} className="row">
                <span className="rowText">
                  {featureLabels[o.feature] || o.feature} · {o.placeName || o.placeId || 'Place'}
                  <span className="fine" style={{ display: 'block', marginTop: 2 }}>
                    {o.mode === 'confirm' ? 'Confirmed' : 'Dwell'} · {formatWhen(o.ts)}
                    {Number.isFinite(o.deltaM) ? ` · ${o.deltaM} m from map pin` : ' · new pin'}
                  </span>
                </span>
                <span className="rowValue">{o.uploadedAt ? 'Sent' : 'Ready'}</span>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="label">History</div>
      {!summaries.length ? (
        <p className="fine">
          {enabled
            ? 'No walks yet. Walk the midways with GPS on, or confirm a nearby entrance — they will show up here.'
            : 'Turn tracking on, then walk or confirm a pin — your sessions will list here.'}
        </p>
      ) : (
        <div className="rowList">
          {summaries.map((s) => (
            <div key={s.id} className="movementSession">
              <div className="row">
                <span className="rowText">
                  {s.venueName || s.venueId || 'Walk'}
                  <span className="fine" style={{ display: 'block', marginTop: 2 }}>
                    {formatWhen(s.startedAt)} · {formatMetres(s.metres)} ·{' '}
                    {formatDuration(s.durationMs)} · {s.pointCount} pts
                    {s.observationCount ? ` · ${s.observationCount} pins` : ''}
                  </span>
                </span>
                <span className="rowValue">
                  {s.status === 'uploaded' ? 'Sent' : s.status === 'ready' ? 'Ready' : 'Live'}
                </span>
              </div>
              <div className="chips wrap" style={{ padding: '0 4px 8px' }}>
                {s.status === 'ready' && (
                  <button
                    type="button"
                    className="chip"
                    disabled={busy}
                    onClick={() => onUpload([s.id])}
                  >
                    Upload
                  </button>
                )}
                <button type="button" className="chip" onClick={() => onExport(s.id)}>
                  Save GeoJSON
                </button>
                <button
                  type="button"
                  className="chip"
                  disabled={busy}
                  onClick={() => removeSession(s.id)}
                >
                  Delete
                </button>
              </div>
              <SessionSpark points={movement.sessions.find((x) => x.id === s.id)?.points} />
            </div>
          ))}
        </div>
      )}

      {summaries.length > 0 && (
        <>
          <div className="rowList" style={{ marginTop: 12 }}>
            <button type="button" className="row" disabled={busy} onClick={onClear}>
              <span className="rowText">
                {confirmClear ? 'Tap again to erase all walks' : 'Clear walk history'}
              </span>
              <span className="rowValue">{confirmClear ? 'Confirm' : ''}</span>
            </button>
          </div>
          {confirmClear && (
            <p className="fine">
              This only deletes the copy on this phone. Uploaded traces stay with the builder queue.
            </p>
          )}
        </>
      )}
    </div>
  );
}

function formatWhen(ts) {
  if (!Number.isFinite(ts)) return '—';
  try {
    return new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(ts));
  } catch {
    return new Date(ts).toLocaleString();
  }
}

/** Tiny path preview from session points — no map dependency. */
function SessionSpark({ points }) {
  if (!Array.isArray(points) || points.length < 2) return null;
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;
  for (const p of points) {
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lng < minLng) minLng = p.lng;
    if (p.lng > maxLng) maxLng = p.lng;
  }
  const pad = 0.00005;
  minLat -= pad;
  maxLat += pad;
  minLng -= pad;
  maxLng += pad;
  const w = 120;
  const h = 36;
  const dx = maxLng - minLng || 1;
  const dy = maxLat - minLat || 1;
  const d = points
    .map((p, i) => {
      const x = ((p.lng - minLng) / dx) * (w - 4) + 2;
      const y = (1 - (p.lat - minLat) / dy) * (h - 4) + 2;
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(' ');
  return (
    <svg
      className="dayTrailPath"
      viewBox={`0 0 ${w} ${h}`}
      width="100%"
      height={h}
      aria-hidden="true"
      style={{ display: 'block', margin: '0 8px 10px', opacity: 0.85 }}
    >
      <path d={d} fill="none" stroke="var(--aqua)" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
