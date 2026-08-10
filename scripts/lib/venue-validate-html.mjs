/**
 * Static HTML evidence review map for maintainers.
 */

import { PUBLISH_AT } from './evidence.mjs';
import { graphFromSidecar } from './evidence-graph.mjs';

const BAND_COLOR = {
  very_high: '#1a7f37',
  high: '#2da44e',
  moderate: '#bf8700',
  low: '#cf222e',
  unknown: '#6e7781',
};

function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * @param {object} opts
 * @param {string} opts.venueId
 * @param {string} opts.venueName
 * @param {object} opts.mapMeta — center from map.json meta
 * @param {object} opts.sidecar — attractions.json
 * @param {object} opts.geojson — entrance points GeoJSON
 */
export function renderEvidenceHtml({ venueId, venueName, mapMeta = {}, sidecar = {}, geojson = null } = {}) {
  const { nodes, summary } = graphFromSidecar(sidecar);
  const center = mapMeta.center || { lat: 0, lng: 0 };
  const features = (geojson?.features || nodes
    .filter((n) => n.kind !== 'ride' && n.at)
    .map((n) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [n.at.lng, n.at.lat] },
      properties: {
        ride: n.rideName || n.label,
        feature: n.kind,
        band: n.fusion?.band || 'unknown',
        published: n.published,
        report: n.report,
      },
    })));

  const fc = geojson || { type: 'FeatureCollection', features };
  const rows = nodes
    .filter((n) => n.kind !== 'ride' && (n.claims?.length || n.fusion))
    .map((n) => {
      const color = BAND_COLOR[n.fusion?.band] || BAND_COLOR.unknown;
      return `<tr data-id="${esc(n.id)}">
        <td>${esc(n.rideName || n.label)}</td>
        <td>${esc(n.kind)}</td>
        <td style="color:${color}"><b>${esc(n.fusion?.band || '—')}</b></td>
        <td>${n.published ? 'yes' : 'no'}</td>
        <td>${esc(n.report || '')}</td>
      </tr>`;
    })
    .join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>${esc(venueName)} — entrance evidence</title>
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
  <style>
    body { margin: 0; font-family: system-ui, sans-serif; }
    #map { height: 52vh; }
    main { padding: 12px 16px 24px; }
    table { width: 100%; border-collapse: collapse; font-size: 14px; }
    th, td { border-bottom: 1px solid #ddd; padding: 6px 8px; text-align: left; }
    th { background: #f6f8fa; }
    .meta { color: #57606a; font-size: 13px; margin-bottom: 12px; }
  </style>
</head>
<body>
  <div id="map"></div>
  <main>
    <h1>${esc(venueName)}</h1>
    <p class="meta">Venue <code>${esc(venueId)}</code> · publish at <code>${PUBLISH_AT}</code> ·
      ${summary.features} features · ${summary.published} published · ${summary.highBand} high band</p>
    <table>
      <thead><tr><th>Ride</th><th>Feature</th><th>Band</th><th>Publish</th><th>Convergence</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </main>
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <script>
    const fc = ${JSON.stringify(fc)};
    const colors = ${JSON.stringify(BAND_COLOR)};
    const map = L.map('map').setView([${center.lat}, ${center.lng}], 16);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap'
    }).addTo(map);
    const layer = L.geoJSON(fc, {
      pointToLayer(f, latlng) {
        const band = f.properties.band || 'unknown';
        return L.circleMarker(latlng, {
          radius: 7,
          color: colors[band] || '#6e7781',
          fillColor: colors[band] || '#6e7781',
          fillOpacity: 0.85,
          weight: 2
        });
      },
      onEachFeature(f, l) {
        const p = f.properties;
        l.bindPopup('<b>' + p.ride + '</b><br>' + p.feature + ' · ' + p.band + (p.published ? ' · published' : ''));
      }
    }).addTo(map);
    if (layer.getBounds().isValid()) map.fitBounds(layer.getBounds(), { padding: [24, 24] });
  </script>
</body>
</html>`;
}
