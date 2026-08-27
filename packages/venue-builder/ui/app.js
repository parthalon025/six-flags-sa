const root = document.getElementById('root');
const approvals = JSON.parse(localStorage.getItem('venue-builder-approvals') || '{}');

function saveApprovals() {
  localStorage.setItem('venue-builder-approvals', JSON.stringify(approvals));
}

function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function load() {
  const [compareRes, certRes] = await Promise.all([
    fetch('/api/compare'),
    fetch('/api/certifications'),
  ]);
  const data = await compareRes.json();
  const certifications = certRes.ok ? await certRes.json() : null;
  const certByVenue = new Map((certifications?.venues || []).map((v) => [v.venueId, v]));

  root.innerHTML = '';

  const sum = document.createElement('p');
  sum.className = 'summary';
  sum.textContent = `${data.passed} of ${data.total} venues match manifest`;
  root.appendChild(sum);

  if (certifications) {
    const certSum = document.createElement('p');
    certSum.className = 'summary cert-summary';
    const parts = [`${certifications.certified} of ${certifications.total} venues certified`];
    if (certifications.uncertified) parts.push(`${certifications.uncertified} uncertified`);
    if (certifications.missing) parts.push(`${certifications.missing} missing certification.json`);
    certSum.textContent = parts.join(' · ');
    root.appendChild(certSum);
  }

  const grid = document.createElement('div');
  grid.className = 'grid';

  for (const { stats, issues } of data.reports) {
    const cert = certByVenue.get(stats.id);
    const card = document.createElement('article');
    const driftClass = stats.ok ? 'ok' : 'fail';
    const certClass = cert?.available ? (cert.certified ? 'cert-ok' : 'cert-fail') : 'cert-missing';
    card.className = `card ${driftClass} ${certClass}`;

    const badge = document.createElement('span');
    badge.className = `badge ${stats.ok ? 'ok' : 'fail'}`;
    badge.textContent = stats.ok ? 'Matches manifest' : 'Drift detected';
    card.appendChild(badge);

    if (cert?.available) {
      const certBadge = document.createElement('span');
      certBadge.className = `badge cert ${cert.certified ? 'ok' : 'fail'}`;
      certBadge.textContent = cert.certified ? 'Certified' : 'Not certified';
      card.appendChild(certBadge);
    } else if (certifications) {
      const certBadge = document.createElement('span');
      certBadge.className = 'badge cert missing';
      certBadge.textContent = 'No certification.json';
      card.appendChild(certBadge);
    }

    const h2 = document.createElement('h2');
    h2.textContent = stats.name;
    card.appendChild(h2);

    const dl = document.createElement('dl');
    dl.className = 'stats';
    const rows = [
      ['POIs', `${stats.actual.pois} / ${stats.manifest.pois ?? '?'}`],
      ['Rides', `${stats.actual.rides} / ${stats.manifest.rides ?? '?'}`],
      ['Heights', `${stats.actual.heights} / ${stats.manifest.heights ?? '?'}`],
      ['Paths', `${stats.actual.paths} / ${stats.coverage.ways ?? '?'}`],
      ['Rides tab', stats.actual.hasHeightsTab ? 'yes' : 'no'],
    ];
    if (stats.actual.campsites) rows.push(['Campsites', stats.actual.campsites]);
    if (cert?.available) {
      rows.push(['Cert checks', `${cert.checksPassed} / ${cert.checksTotal} pass`]);
    }
    for (const [k, v] of rows) {
      dl.innerHTML += `<dt>${k}:</dt><dd>${v}</dd>`;
    }
    card.appendChild(dl);

    if (issues.length) {
      const ul = document.createElement('ul');
      ul.className = 'issues';
      for (const i of issues) {
        const li = document.createElement('li');
        li.textContent = i;
        ul.appendChild(li);
      }
      card.appendChild(ul);
    }

    if (cert?.available && !cert.certified && cert.blockingChecks.length) {
      const blockers = document.createElement('ul');
      blockers.className = 'blockers';
      for (const key of cert.blockingChecks) {
        const li = document.createElement('li');
        li.textContent = `Blocking check: ${key}`;
        blockers.appendChild(li);
      }
      card.appendChild(blockers);
    }

    if (cert?.available && !cert.certified && cert.blockingAsks?.length) {
      const asks = document.createElement('ul');
      asks.className = 'asks';
      for (const ask of cert.blockingAsks) {
        const li = document.createElement('li');
        li.textContent = `${ask.need}: ${ask.why}`;
        asks.appendChild(li);
      }
      card.appendChild(asks);
    }

    const actions = document.createElement('div');
    actions.className = 'actions';

    const preview = document.createElement('a');
    preview.href = `/venues/${stats.id}.map.json`;
    preview.target = '_blank';
    preview.textContent = 'View map JSON';
    actions.appendChild(preview);

    const pois = document.createElement('a');
    pois.href = `/venues/${stats.id}.pois.json`;
    pois.target = '_blank';
    pois.textContent = 'View POIs';
    actions.appendChild(pois);

    const evidence = document.createElement('a');
    evidence.href = `/evidence/${stats.id}`;
    evidence.target = '_blank';
    evidence.textContent = 'Evidence review';
    evidence.dataset.venue = stats.id;
    evidence.className = 'evidence-link';
    actions.appendChild(evidence);

    if (cert?.available) {
      const certBtn = document.createElement('button');
      certBtn.type = 'button';
      certBtn.className = 'cert-detail-btn';
      certBtn.textContent = 'Certification report';
      certBtn.addEventListener('click', () => toggleCertDetail(card, stats.id));
      actions.appendChild(certBtn);
    }

    const approve = document.createElement('button');
    approve.type = 'button';
    approve.className = `approve ${approvals[stats.id] ? 'on' : ''}`;
    approve.textContent = approvals[stats.id] ? 'Approved for ship' : 'Approve for ship';
    approve.addEventListener('click', () => {
      approvals[stats.id] = !approvals[stats.id];
      saveApprovals();
      approve.classList.toggle('on', approvals[stats.id]);
      approve.textContent = approvals[stats.id] ? 'Approved for ship' : 'Approve for ship';
    });
    actions.appendChild(approve);

    card.appendChild(actions);
    grid.appendChild(card);
  }

  root.appendChild(grid);
  await markEvidenceLinks(grid);
}

async function toggleCertDetail(card, venueId) {
  const existing = card.querySelector('.cert-detail');
  if (existing) {
    existing.remove();
    return;
  }
  const panel = document.createElement('div');
  panel.className = 'cert-detail';
  panel.innerHTML = '<p class="loading">Loading certification report…</p>';
  card.appendChild(panel);
  try {
    const res = await fetch(`/api/certification/${encodeURIComponent(venueId)}`);
    if (!res.ok) throw new Error(`certification ${res.status}`);
    const data = await res.json();
    panel.innerHTML = `<pre class="cert-markdown">${esc(data.markdown)}</pre>`;
  } catch (e) {
    panel.innerHTML = `<p class="issues">Failed to load certification: ${esc(e.message)}</p>`;
  }
}

async function markEvidenceLinks(grid) {
  const links = [...grid.querySelectorAll('a.evidence-link')];
  await Promise.all(
    links.map(async (link) => {
      const venueId = link.dataset.venue;
      try {
        const res = await fetch(`/api/evidence/${encodeURIComponent(venueId)}`);
        if (!res.ok) throw new Error(`evidence status ${res.status}`);
        const data = await res.json();
        if (!data.available) {
          link.classList.add('missing');
          link.textContent = 'Evidence not generated';
          link.title = 'Evidence review map not generated for this venue';
        }
      } catch {
        link.classList.add('missing');
        link.title = 'Could not check evidence review status';
      }
    }),
  );
}

load().catch((e) => {
  root.innerHTML = `<p class="issues">Failed to load: ${e.message}</p>`;
});
