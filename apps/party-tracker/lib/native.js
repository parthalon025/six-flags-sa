/**
 * Capacitor native APIs with web fallbacks.
 *
 * Store binaries (ADR-0005) go through here so Location, haptics, share,
 * battery, and network work the same on a PWA and in the shell. Background
 * Location still needs a dedicated plugin before App Store / Play submit —
 * @capacitor/geolocation is foreground-only.
 */

let plugins = null;

/** @param {object | null} next */
export function _setPluginsForTests(next) {
  plugins = next;
}

export function _resetPluginsForTests() {
  plugins = null;
}

function nativeFrom(p) {
  try {
    return Boolean(p?.Capacitor?.isNativePlatform?.());
  } catch {
    return false;
  }
}

export function isNativePlatform() {
  if (plugins && typeof plugins === 'object') return nativeFrom(plugins);
  if (typeof window === 'undefined') return false;
  try {
    return Boolean(window.Capacitor?.isNativePlatform?.());
  } catch {
    return false;
  }
}

async function loadPlugins() {
  if (plugins === 'web') return null;
  if (plugins && typeof plugins === 'object') {
    return nativeFrom(plugins) ? plugins : null;
  }
  if (typeof window === 'undefined') {
    plugins = 'web';
    return null;
  }
  try {
    const { Capacitor } = await import('@capacitor/core');
    if (!Capacitor.isNativePlatform()) {
      plugins = 'web';
      return null;
    }
    const [geo, haptics, share, clipboard, device, network] = await Promise.all([
      import('@capacitor/geolocation'),
      import('@capacitor/haptics'),
      import('@capacitor/share'),
      import('@capacitor/clipboard'),
      import('@capacitor/device'),
      import('@capacitor/network'),
    ]);
    plugins = {
      Capacitor,
      Geolocation: geo.Geolocation,
      Haptics: haptics.Haptics,
      Share: share.Share,
      Clipboard: clipboard.Clipboard,
      Device: device.Device,
      Network: network.Network,
    };
    return plugins;
  } catch {
    plugins = 'web';
    return null;
  }
}

export async function haptic(pattern = 10) {
  const p = await loadPlugins();
  if (p?.Haptics?.impact) {
    await p.Haptics.impact({ style: 'Light' });
    return;
  }
  if (typeof navigator !== 'undefined') navigator.vibrate?.(pattern);
}

export async function shareInvite({ code, url }) {
  const p = await loadPlugins();
  const text = url || code;
  try {
    const payload = { title: 'Join my party', text: `Party code ${code}`, url: url || undefined };
    if (p?.Share?.share) {
      await p.Share.share(payload);
      return 'shared';
    }
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      await navigator.share(payload);
      return 'shared';
    }
  } catch (err) {
    if (err?.name !== 'AbortError' && !p?.Clipboard && typeof navigator?.clipboard?.writeText !== 'function') {
      return 'failed';
    }
  }
  try {
    if (p?.Clipboard?.write) {
      await p.Clipboard.write({ string: text });
      return 'copied';
    }
    if (typeof navigator !== 'undefined') {
      await navigator.clipboard.writeText(text);
      return 'copied';
    }
  } catch {
    return 'failed';
  }
  return 'failed';
}

export async function readBattery() {
  const p = await loadPlugins();
  if (p?.Device?.getBatteryInfo) {
    const info = await p.Device.getBatteryInfo();
    const level = Number(info?.batteryLevel);
    return {
      level: Number.isFinite(level) ? level : 0,
      charging: Boolean(info?.isCharging),
    };
  }
  const n = typeof navigator === 'undefined' ? null : navigator;
  if (!n || typeof n.getBattery !== 'function') return null;
  try {
    const b = await n.getBattery();
    return { level: Number(b?.level ?? 0), charging: Boolean(b?.charging) };
  } catch {
    return null;
  }
}

export async function connectionQuality() {
  const p = await loadPlugins();
  if (p?.Network?.getStatus) {
    const status = await p.Network.getStatus();
    if (!status?.connected) return 0;
    const byType = { wifi: 1, cellular: 0.6, none: 0, unknown: 0.5 };
    return byType[status.connectionType] ?? 0.5;
  }
  const n = typeof navigator === 'undefined' ? null : navigator;
  if (n && n.onLine === false) return 0;
  const conn = n?.connection || n?.mozConnection || n?.webkitConnection || null;
  if (!conn) return 0.5;
  const byType = { 'slow-2g': 0.1, '2g': 0.25, '3g': 0.6, '4g': 1 };
  if (typeof conn.effectiveType === 'string' && byType[conn.effectiveType] !== undefined) {
    return byType[conn.effectiveType];
  }
  if (Number.isFinite(conn.downlink)) return Math.min(1, conn.downlink / 10);
  return 0.5;
}

export async function watchPosition(onOk, onErr, options) {
  const p = await loadPlugins();
  if (p?.Geolocation?.watchPosition) {
    const id = await p.Geolocation.watchPosition(options, (pos, err) => {
      if (err) onErr?.(err);
      else onOk?.(pos);
    });
    return { native: true, id };
  }
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    onErr?.({ code: 2, message: 'unsupported' });
    return { native: false, id: null };
  }
  const id = navigator.geolocation.watchPosition(onOk, onErr, options);
  return { native: false, id };
}

export async function clearWatch(handle) {
  if (!handle || handle.id == null) return;
  if (handle.native) {
    const p = await loadPlugins();
    await p?.Geolocation?.clearWatch?.({ id: handle.id });
    return;
  }
  if (typeof navigator !== 'undefined') navigator.geolocation?.clearWatch(handle.id);
}

export async function getCurrentPosition(options) {
  const p = await loadPlugins();
  if (p?.Geolocation?.getCurrentPosition) {
    return p.Geolocation.getCurrentPosition(options);
  }
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      reject({ code: 2, message: 'unsupported' });
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, options);
  });
}
