const root = document.getElementById('root');

async function postReview(venueId, decision) {
  const res = await fetch('/api/review', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ venueId, decision }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data.decision;
}

async function loadReviews() {
  const res = await fetch('/api/reviews');
  if (!res.ok) throw new Error(`reviews ${res.status}`);
  return res.json();
}

async function load() {
  const [compareRes, reviews] = await Promise.all([
    fetch('/api/compare'),
    loadReviews(),
  ]);
  const data = await compareRes.json();
  root.innerHTML = '';

  const sum = document.createElement('p');
  sum.className = 'summary';
  sum.textContent = `${data.passed} of ${data.total} venues match manifest`;
  root.appendChild(sum);

  const grid = document.createElement('div');
  grid.className = 'grid';

  for (const { stats, issues } of data.reports) {
    const card = document.createElement('article');
    card.className = `card ${stats.ok ? 'ok' : 'fail'}`;

    const badge = document.createElement('span');
    badge.className = `badge ${stats.ok ? 'ok' : 'fail'}`;
    badge.textContent = stats.ok ? 'Matches manifest' : 'Drift detected';
    card.appendChild(badge);

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

    let decision = reviews[stats.id] ?? null;

    const approve = document.createElement('button');
    approve.type = 'button';
    approve.className = `approve ${decision === 'approve' ? 'on' : ''}`;
    approve.textContent = decision === 'approve' ? 'Approved for ship' : 'Approve for ship';
    approve.addEventListener('click', async () => {
      approve.disabled = true;
      try {
        decision = await postReview(stats.id, 'approve');
        approve.classList.toggle('on', decision === 'approve');
        approve.textContent = decision === 'approve' ? 'Approved for ship' : 'Approve for ship';
        reject.classList.toggle('on', decision === 'reject');
      } catch (e) {
        alert(e.message);
      } finally {
        approve.disabled = false;
      }
    });
    actions.appendChild(approve);

    const reject = document.createElement('button');
    reject.type = 'button';
    reject.className = `reject ${decision === 'reject' ? 'on' : ''}`;
    reject.textContent = decision === 'reject' ? 'Rejected' : 'Reject';
    reject.addEventListener('click', async () => {
      reject.disabled = true;
      try {
        decision = await postReview(stats.id, 'reject');
        reject.classList.toggle('on', decision === 'reject');
        reject.textContent = decision === 'reject' ? 'Rejected' : 'Reject';
        approve.classList.toggle('on', decision === 'approve');
        approve.textContent = decision === 'approve' ? 'Approved for ship' : 'Approve for ship';
      } catch (e) {
        alert(e.message);
      } finally {
        reject.disabled = false;
      }
    });
    actions.appendChild(reject);

    card.appendChild(actions);
    grid.appendChild(card);
  }

  root.appendChild(grid);
}

load().catch((e) => {
  root.innerHTML = `<p class="issues">Failed to load: ${e.message}</p>`;
});
