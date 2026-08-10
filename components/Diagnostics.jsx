'use client';

import { useEffect, useState } from 'react';

/**
 * What the transport layer is actually doing, in a park, on somebody else's
 * phone.
 *
 * Every line here is a fact the stack already tracks and would otherwise only
 * exist in a console nobody can open: which transport won, what each candidate
 * said when it was probed, how many envelopes are sitting in the outbox, and
 * how fast the GPS is being asked for fixes. A transport layer that fails over
 * silently is a transport layer nobody can debug, which is the whole reason
 * this panel exists.
 */

const REFRESH_MS = 1000;

const Row = ({ label, value, tone }) => (
  <div className="diagRow">
    <span className="diagKey">{label}</span>
    <span className={`diagVal ${tone || ''}`}>{value}</span>
  </div>
);

/** Milliseconds as something readable at a glance. */
const ms = (n) => (Number.isFinite(n) ? (n >= 1000 ? `${(n / 1000).toFixed(1)}s` : `${n}ms`) : '—');

const toneFor = (status) => {
  if (status === 'ready') return 'ok';
  if (status === 'degraded') return 'warn';
  if (status === 'failed') return 'bad';
  return '';
};

/** Format an ISO build stamp for diagnostics. */
const formatBuilt = (raw) => {
  if (!raw) return '—';
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? raw : d.toLocaleString();
};

export default function Diagnostics({ runtime, geo, appVersion, appBuilt, remoteVersion, remoteBuilt, updateStatus }) {
  const [snap, setSnap] = useState(null);

  // Polled rather than pushed: most of this changes without any state change
  // the UI would otherwise re-render for (probe timings, queue depth, counters).
  useEffect(() => {
    if (!runtime) return undefined;
    const read = () => setSnap(runtime.stats());
    read();
    const timer = setInterval(read, REFRESH_MS);
    return () => clearInterval(timer);
  }, [runtime]);

  const transport = snap?.transport || null;
  const probes = transport?.probes || [];
  const candidates = transport?.candidates || [];

  return (
    <div className="diag">
      <div className="label">App</div>
      <div className="diagTable">
        <Row label="Installed version" value={appVersion || '—'} />
        <Row label="Installed build" value={formatBuilt(appBuilt)} />
        <Row label="Server version" value={remoteVersion || '—'} />
        <Row label="Server build" value={formatBuilt(remoteBuilt)} />
        <Row
          label="Update status"
          value={
            updateStatus === 'offline'
              ? 'offline — cached build'
              : updateStatus === 'update-available' || updateStatus === 'updating'
                ? 'updating'
                : updateStatus || '—'
          }
          tone={
            updateStatus === 'offline'
              ? 'warn'
              : updateStatus === 'current'
                ? 'ok'
                : ''
          }
        />
      </div>

      <div className="label">Connection</div>
      <div className="diagTable">
        <Row
          label="Active transport"
          value={transport?.active || 'none'}
          tone={transport?.active ? 'ok' : 'bad'}
        />
        <Row label="Role" value={snap?.role || 'not in a party'} />
        <Row label="Host id" value={snap?.hostId || '—'} />
        <Row label="Your id" value={snap?.selfId || '—'} />
        <Row label="Party id" value={snap?.partyId || '—'} />
        <Row label="State version" value={snap ? `v${snap.version}` : '—'} />
        <Row label="Roster size" value={snap?.members ?? 0} />
        <Row
          label="Queued messages"
          value={snap?.queued ?? 0}
          tone={snap?.queued ? 'warn' : 'ok'}
        />
        {snap?.error ? <Row label="Last error" value={snap.error} tone="bad" /> : null}
      </div>

      <div className="label">Transports</div>
      {candidates.length === 0 ? (
        <p className="fine" style={{ marginTop: 0 }}>
          Nothing to report until this phone is in a party — the transports are built with the
          party&apos;s session and probed when it opens.
        </p>
      ) : (
        <div className="diagTable">
          {candidates.map((c) => {
            const probe = probes.find((p) => p.name === c.name);
            const reason = probe && !probe.available ? probe.reason || 'unavailable' : c.reason;
            return (
              <div key={c.name} className="diagCard">
                <div className="diagRow">
                  <span className="diagKey">
                    {c.name} <em>rank {c.rank}</em>
                  </span>
                  <span className={`diagVal ${toneFor(c.status)}`}>{c.status}</span>
                </div>
                <div className="diagFine">
                  probe {probe ? (probe.available ? 'available' : 'unavailable') : 'not run'}
                  {reason ? ` · ${reason}` : ''}
                  {' · '}
                  sent {c.sent} · received {c.received} · errors {c.errors}
                  {c.mode ? ` · ${c.mode}` : ''}
                  {Number.isFinite(c.queued) ? ` · ${c.queued} held` : ''}
                  {Number.isFinite(c.peers) ? ` · ${c.peers} peers` : ''}
                </div>
                {c.lastError ? <div className="diagFine bad">{c.lastError}</div> : null}
              </div>
            );
          })}
        </div>
      )}

      <div className="label">Location Policy</div>
      <div className="diagTable">
        <Row label="GPS state" value={geo?.status || 'idle'} />
        <Row label="Motion" value={geo?.motion || '—'} />
        <Row label="Fix cadence" value={ms(geo?.cadenceMs)} />
        <Row
          label="Battery"
          value={
            geo?.battery
              ? `${Math.round(geo.battery.level * 100)}%${geo.battery.charging ? ' charging' : ''}`
              : 'not reported'
          }
        />
        <Row
          label="Accuracy"
          value={geo?.position?.acc != null ? `±${Math.round(geo.position.acc)} m` : '—'}
        />
      </div>
      <p className="fine">
        The motion band sets how often the radio is asked for a fix, and the broadcast gate then
        decides which of those fixes is worth putting on the wire. Standing in a queue costs a
        fraction of what walking the midway does.
      </p>

      {snap?.party ? (
        <>
          <div className="label">Protocol Counters</div>
          <div className="diagTable">
            <Row label="Frames sent" value={snap.party.sent ?? 0} />
            <Row label="Frames received" value={snap.party.received ?? 0} />
            <Row label="Dropped" value={snap.party.dropped ?? 0} />
            {snap.party.role === 'client' ? (
              <>
                <Row label="Patches applied" value={snap.party.patches ?? 0} />
                <Row label="Version gaps" value={snap.party.gaps ?? 0} tone={snap.party.gaps ? 'warn' : ''} />
                <Row label="Resyncs asked for" value={snap.party.resyncs ?? 0} />
                <Row label="Electing" value={snap.party.election?.electing ? 'yes' : 'no'} />
              </>
            ) : (
              <Row label="Commands applied" value={snap.party.applied ?? 0} />
            )}
            {snap.party.lastError ? (
              <Row label="Last error" value={snap.party.lastError} tone="bad" />
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}
