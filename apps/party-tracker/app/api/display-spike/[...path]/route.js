/**
 * Byte server for the MapLibre display-pipeline spike (issue #527) — see
 * lib/displaySpike.js for why this exists instead of publishing to
 * public/venues. 404s outright unless mapLibreDisplayEnabled(); serves only
 * the allow-listed files — Big Kahuna's one certified Skin's pack plus
 * MapLibre's worker bundle (see lib/displaySpike.js for why), nothing else
 * on disk. Honors Range so pmtiles' own byte-range fetches work — it is
 * a PMTiles archive, not a single blob a client downloads whole.
 */
import { createReadStream, statSync } from 'node:fs';
import { mapLibreDisplayEnabled } from '@/lib/mapLibreConfigured';
import { displaySpikeContentType, displaySpikeFile, parseByteRange } from '@/lib/displaySpike';

export const dynamic = 'force-dynamic';

function streamToWeb(nodeStream) {
  return new ReadableStream({
    start(controller) {
      nodeStream.on('data', (chunk) => controller.enqueue(chunk));
      nodeStream.on('end', () => controller.close());
      nodeStream.on('error', (err) => controller.error(err));
    },
    cancel() {
      nodeStream.destroy();
    },
  });
}

export async function GET(request, { params }) {
  if (!mapLibreDisplayEnabled()) {
    return new Response('Not found', { status: 404 });
  }

  const segments = (await params).path || [];
  const name = segments.join('/');
  const file = displaySpikeFile(name);
  if (!file) return new Response('Not found', { status: 404 });

  let size;
  try {
    size = statSync(file).size;
  } catch {
    return new Response('Not found', { status: 404 });
  }

  const contentType = displaySpikeContentType(name) || 'application/octet-stream';
  const range = request.headers.get('range');
  if (!range) {
    return new Response(streamToWeb(createReadStream(file)), {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(size),
        'Accept-Ranges': 'bytes',
      },
    });
  }

  const span = parseByteRange(range, size);
  if (!span) {
    return new Response('Invalid range', { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
  }
  const { start, end } = span;

  return new Response(streamToWeb(createReadStream(file, { start, end })), {
    status: 206,
    headers: {
      'Content-Type': contentType,
      'Content-Length': String(end - start + 1),
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Accept-Ranges': 'bytes',
    },
  });
}
