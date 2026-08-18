'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

export default function AdminVenuesPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [approvals, setApprovals] = useState({});

  useEffect(() => {
    try {
      setApprovals(JSON.parse(localStorage.getItem('venue-builder-approvals') || '{}'));
    } catch {
      setApprovals({});
    }
    fetch('/api/admin/venues')
      .then((r) => r.json())
      .then(setData)
      .catch((e) => setError(e.message));
  }, []);

  const toggleApproval = (id) => {
    setApprovals((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      localStorage.setItem('venue-builder-approvals', JSON.stringify(next));
      return next;
    });
  };

  if (error) {
    return (
      <main className="adminPage">
        <h1>World inspection</h1>
        <p className="fine">Could not load comparison: {error}</p>
        <Link href="/">Back to map</Link>
      </main>
    );
  }

  if (!data) {
    return (
      <main className="adminPage">
        <h1>World inspection</h1>
        <p className="fine">Loading built Worlds…</p>
      </main>
    );
  }

  return (
    <main className="adminPage">
      <header className="adminHeader">
        <div>
          <h1>World inspection</h1>
          <p className="fine">
            Built World bundles compared to the manifest. Approve before merging a World rebuild PR.
          </p>
        </div>
        <Link className="btn small" href="/">
          Back to map
        </Link>
      </header>

      <p className="adminSummary">
          <b>{data.passed}</b> of <b>{data.total}</b> Worlds match the manifest
      </p>

      <div className="adminGrid">
        {data.reports.map(({ stats, issues }) => (
          <article key={stats.id} className={`adminCard ${stats.ok ? 'ok' : 'fail'}`}>
            <span className={`adminBadge ${stats.ok ? 'ok' : 'fail'}`}>
              {stats.ok ? 'Matches' : 'Drift'}
            </span>
            <h2>{stats.name}</h2>
            <dl className="adminStats">
              <div><dt>POIs</dt><dd>{stats.actual.pois} / {stats.manifest.pois ?? '?'}</dd></div>
              <div><dt>Rides</dt><dd>{stats.actual.rides} / {stats.manifest.rides ?? '?'}</dd></div>
              <div><dt>Heights</dt><dd>{stats.actual.heights} / {stats.manifest.heights ?? '?'}</dd></div>
              <div><dt>Paths</dt><dd>{stats.actual.paths} / {stats.coverage.ways ?? '?'}</dd></div>
              <div><dt>Rides tab</dt><dd>{stats.actual.hasHeightsTab ? 'yes' : 'no'}</dd></div>
              {stats.actual.campsites > 0 && (
                <div><dt>Campsites</dt><dd>{stats.actual.campsites}</dd></div>
              )}
            </dl>
            {issues.length > 0 && (
              <ul className="adminIssues">
                {issues.map((i) => (
                  <li key={i}>{i}</li>
                ))}
              </ul>
            )}
            <div className="adminActions">
              <Link className="btn small" href={`/?venue=${stats.id}`}>
                Open in app
              </Link>
              <button
                type="button"
                className={`btn small ${approvals[stats.id] ? 'primary' : ''}`}
                onClick={() => toggleApproval(stats.id)}
              >
                {approvals[stats.id] ? 'Approved' : 'Approve for ship'}
              </button>
            </div>
          </article>
        ))}
      </div>
    </main>
  );
}
