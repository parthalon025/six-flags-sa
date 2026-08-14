/**
 * Encode and validate iPhone App Store preview videos.
 *
 * Apple: 886×1920 portrait, 15–30s, H.264 High ≤ Level 4.0, ≤30 fps,
 * stereo AAC. Fastlane maps `IPHONE_67` to the 6.9" slot.
 *
 *   npm run store:app-preview
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = join(here, '../..');
export const PREVIEW_DIR = join(REPO_ROOT, 'fastlane/app_previews');

export const IPHONE_PREVIEW = {
  width: 886,
  height: 1920,
  minSeconds: 15,
  maxSeconds: 30,
  maxFps: 30,
  maxBytes: 500 * 1024 * 1024,
  deviceToken: 'IPHONE_67',
};

/** Playwright `recordVideo` at DSF 2 leaves the 390×844 UI in the top-left. */
export const RECORDING = {
  width: 780,
  height: 1688,
  cropWidth: 390,
  cropHeight: 844,
  cropX: 0,
  cropY: 0,
};

export function previewFilename(slug = 'family-day') {
  return `${IPHONE_PREVIEW.deviceToken}_${slug}.mp4`;
}

export function listingPreviewPath(root = REPO_ROOT, slug = 'family-day') {
  return join(root, 'fastlane/app_previews/en-US', previewFilename(slug));
}

export function parseFps(rate) {
  if (!rate) return 0;
  const [num, den] = String(rate).split('/').map(Number);
  if (den) return num / den;
  return Number(rate) || 0;
}

export function parseFfprobe(json, path) {
  const video = (json.streams || []).find((s) => s.codec_type === 'video');
  const audio = (json.streams || []).find((s) => s.codec_type === 'audio');
  return {
    path,
    width: video?.width || 0,
    height: video?.height || 0,
    duration: Number(json.format?.duration || video?.duration || 0),
    fps: parseFps(video?.r_frame_rate || video?.avg_frame_rate),
    videoCodec: String(video?.codec_name || '').toLowerCase(),
    profile: video?.profile || '',
    audioCodec: audio ? String(audio.codec_name || '').toLowerCase() : null,
    audioChannels: audio?.channels || 0,
    bytes: Number(json.format?.size || 0),
  };
}

export function probeVideo(path) {
  const raw = execFileSync(
    'ffprobe',
    ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', path],
    { encoding: 'utf8' },
  );
  return parseFfprobe(JSON.parse(raw), path);
}

export function previewIssues(probe) {
  const issues = [];
  if (probe.width !== IPHONE_PREVIEW.width || probe.height !== IPHONE_PREVIEW.height) {
    issues.push(
      `resolution must be ${IPHONE_PREVIEW.width}×${IPHONE_PREVIEW.height}, got ${probe.width}×${probe.height}`,
    );
  }
  if (
    !(probe.duration >= IPHONE_PREVIEW.minSeconds && probe.duration <= IPHONE_PREVIEW.maxSeconds)
  ) {
    issues.push(
      `duration must be ${IPHONE_PREVIEW.minSeconds}–${IPHONE_PREVIEW.maxSeconds}s, got ${probe.duration}`,
    );
  }
  if (probe.fps > IPHONE_PREVIEW.maxFps + 0.05) {
    issues.push(`frame rate must be ≤ ${IPHONE_PREVIEW.maxFps} fps, got ${probe.fps}`);
  }
  if (probe.videoCodec !== 'h264') {
    issues.push(`video codec must be h264, got ${probe.videoCodec}`);
  }
  if (probe.profile && !/high/i.test(String(probe.profile))) {
    issues.push(`H.264 profile must be High, got ${probe.profile}`);
  }
  if (probe.audioCodec !== 'aac') {
    issues.push(`audio codec must be aac, got ${probe.audioCodec}`);
  }
  if (probe.audioChannels !== 2) {
    issues.push(`audio must be stereo (2 channels), got ${probe.audioChannels}`);
  }
  if (probe.bytes > IPHONE_PREVIEW.maxBytes) {
    issues.push(`file must be ≤ 500MB, got ${probe.bytes}`);
  }
  return issues;
}

export function assertAppleIphonePreview(probe) {
  const issues = previewIssues(probe);
  if (issues.length) throw new Error(issues.join('\n'));
  return probe;
}

export function assTime(seconds) {
  const cs = Math.max(0, Math.round(Number(seconds) * 100));
  const h = Math.floor(cs / 360_000);
  const m = Math.floor((cs % 360_000) / 6_000);
  const s = Math.floor((cs % 6_000) / 100);
  const c = cs % 100;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(c).padStart(2, '0')}`;
}

export function buildAss(captions, { width = IPHONE_PREVIEW.width, height = IPHONE_PREVIEW.height } = {}) {
  const header = `[Script Info]
Title: Parkbound App Preview
ScriptType: v4.00+
WrapStyle: 0
ScaledBorderAndShadow: yes
PlayResX: ${width}
PlayResY: ${height}

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Caption,Inter SemiBold,42,&H00FFFFFF,&H000000FF,&HCC0B1829,&H00000000,-1,0,0,0,100,100,0,0,3,12,0,8,48,48,96,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
  const lines = captions.map((cap) => {
    const text = String(cap.text || '').replace(/\n/g, '\\N');
    return `Dialogue: 0,${assTime(cap.start)},${assTime(cap.end)},Caption,,0,0,0,,${text}`;
  });
  return header + lines.join('\n') + '\n';
}

function videoFilters({ crop = RECORDING, captionsPath }) {
  const parts = [
    `crop=${crop.cropWidth}:${crop.cropHeight}:${crop.cropX}:${crop.cropY}`,
    `scale=${IPHONE_PREVIEW.width}:${IPHONE_PREVIEW.height}:flags=lanczos`,
    'fps=30',
    'setsar=1',
    'format=yuv420p',
  ];
  if (captionsPath) {
    const escaped = captionsPath.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
    parts.push(`ass='${escaped}'`);
  }
  return parts.join(',');
}

export function encodeAppPreview({
  source,
  output,
  trimStart = 0,
  trimEnd,
  captions = [],
  crop = RECORDING,
} = {}) {
  if (!source || !output) throw new Error('source and output are required');
  mkdirSync(dirname(output), { recursive: true });

  const args = ['-y'];
  if (trimStart) args.push('-ss', String(trimStart));
  if (trimEnd != null) args.push('-to', String(trimEnd));
  // Quiet white noise so AAC holds ~256 kbps (true silence encodes at ~2 kbps
  // and App Store Connect asks for stereo AAC at 256 kbps).
  args.push(
    '-i',
    source,
    '-f',
    'lavfi',
    '-i',
    'anoisesrc=color=white:amplitude=0.0008:sample_rate=44100,aformat=channel_layouts=stereo',
  );

  let captionsPath;
  if (captions.length) {
    captionsPath = join(tmpdir(), `parkbound-preview-${process.pid}.ass`);
    writeFileSync(captionsPath, buildAss(captions));
  }

  args.push(
    '-filter_complex',
    `[0:v]${videoFilters({ crop, captionsPath })}[v]`,
    '-map',
    '[v]',
    '-map',
    '1:a',
    '-c:v',
    'libx264',
    '-profile:v',
    'high',
    '-level:v',
    '4.0',
    '-pix_fmt',
    'yuv420p',
    '-preset',
    'medium',
    '-b:v',
    '10M',
    '-maxrate',
    '12M',
    '-bufsize',
    '24M',
    '-r',
    '30',
    '-fps_mode',
    'cfr',
    '-c:a',
    'aac',
    '-b:a',
    '256k',
    '-ac',
    '2',
    '-ar',
    '44100',
    '-shortest',
    '-movflags',
    '+faststart',
    output,
  );

  try {
    execFileSync('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    const detail = [err.stderr, err.stdout].filter(Boolean).join('\n').trim();
    throw new Error(detail || err.message);
  }
  return probeVideo(output);
}
