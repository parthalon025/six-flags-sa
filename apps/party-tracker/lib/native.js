/**
 * Capacitor native APIs with web fallbacks.
 *
 * Store binaries (ADR-0005) go through here so Location, haptics, share,
 * battery, and network work the same on a PWA and in the shell. Native
 * watches prefer @capacitor-community/background-geolocation so a pocketed
 * Host still updates the Party.
 */

let plugins = null;
let loading = null;

/** @param {object | null} next */
export function _setPluginsForTests(next) {
  plugins = next;
  loading = null;
}

export function _resetPluginsForTests() {
  plugins = null;
  loading = null;
}

function browserWindow() {
  if (typeof globalThis !== 'undefined' && globalThis.window) return globalThis.window;
  if (typeof window !== 'undefined') return window;
  return null;
}

function nativeFrom(p) {
  try {
    return Boolean(p?.Capacitor?.isNativePlatform?.());
  } catch {
    return false;
  }
}

/** True only when the iOS/Android shell has already injected the bridge. */
function nativeBridgePresent() {
  try {
    return Boolean(browserWindow()?.Capacitor?.isNativePlatform?.());
  } catch {
    return false;
  }
}

export function isNativePlatform() {
  if (plugins && typeof plugins === 'object') return nativeFrom(plugins);
  return nativeBridgePresent();
}

async function loadPlugins() {
  if (plugins === 'web') return null;
  if (plugins && typeof plugins === 'object') {
    return nativeFrom(plugins) ? plugins : null;
  }
  if (!loading) {
    loading = loadPluginsUncached();
  }
  return loading;
}

async function loadPluginsUncached() {
  // The PWA, Playwright, and SSR have no bridge. Importing @capacitor/core
  // still runs initCapacitorGlobal and pulls plugin chunks into the web client.
  // The store shell injects window.Capacitor before page JS (ADR-0005).
  if (!nativeBridgePresent()) {
    plugins = 'web';
    return null;
  }
  try {
    const { Capacitor } = await import('@capacitor/core');
    if (!Capacitor.isNativePlatform()) {
      plugins = 'web';
      return null;
    }
    const [geo, haptics, share, clipboard, device, network, bg, push, app, core] = await Promise.all([
      import('@capacitor/geolocation'),
      import('@capacitor/haptics'),
      import('@capacitor/share'),
      import('@capacitor/clipboard'),
      import('@capacitor/device'),
      import('@capacitor/network'),
      import('@capacitor-community/background-geolocation'),
      import('@capacitor/push-notifications'),
      import('@capacitor/app'),
      import('@capacitor/core'),
    ]);
    const { registerPlugin } = core;
    const WatchCompass = registerPlugin('WatchCompass');
    plugins = {
      Capacitor,
      Geolocation: geo.Geolocation,
      Haptics: haptics.Haptics,
      Share: share.Share,
      Clipboard: clipboard.Clipboard,
      Device: device.Device,
      Network: network.Network,
      BackgroundGeolocation: bg.BackgroundGeolocation ?? bg.default,
      PushNotifications: push.PushNotifications,
      App: app.App,
      WatchCompass,
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

function toGeoPosition(loc) {
  if (!loc) return loc;
  if (loc.coords && Number.isFinite(loc.coords.latitude)) return loc;
  return {
    coords: {
      latitude: loc.latitude,
      longitude: loc.longitude,
      accuracy: loc.accuracy,
      altitude: loc.altitude ?? null,
      heading: loc.bearing ?? loc.heading ?? null,
      speed: loc.speed ?? null,
    },
    timestamp: loc.time ?? loc.timestamp ?? Date.now(),
  };
}

/** Push is for Party alerts — never prompt at launch (App Review 5.1.1). */
export function shouldRegisterPush(party) {
  return Boolean(party?.active);
}

export async function registerPush({ onToken, onNotification } = {}) {
  const p = await loadPlugins();
  const Push = p?.PushNotifications;
  if (!Push?.register) return 'web';
  const perm = await Push.requestPermissions();
  if (perm?.receive && perm.receive !== 'granted') return 'denied';
  await Push.register();
  await Push.addListener?.('registration', (t) => {
    onToken?.(t?.value || t?.token || '');
  });
  if (onNotification) {
    await Push.addListener?.('pushNotificationReceived', onNotification);
  }
  return 'native';
}

export async function listenInviteUrls(onUrl) {
  const p = await loadPlugins();
  const App = p?.App;
  if (!App) return () => {};
  const launch = await App.getLaunchUrl?.();
  if (launch?.url) onUrl(launch.url);
  const sub = await App.addListener?.('appUrlOpen', (ev) => {
    if (ev?.url) onUrl(ev.url);
  });
  return () => {
    void sub?.remove?.();
  };
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
  if (p?.BackgroundGeolocation?.addWatcher) {
    const id = await p.BackgroundGeolocation.addWatcher(
      {
        backgroundMessage:
          'Park Bound keeps Location on so your party can see you on the map.',
        backgroundTitle: 'Park Bound',
        requestPermissions: true,
        stale: false,
        distanceFilter: options?.distanceFilter ?? 15,
      },
      (loc, err) => {
        if (err) onErr?.(err);
        else onOk?.(toGeoPosition(loc));
      },
    );
    return { native: true, background: true, id };
  }
  if (p?.Geolocation?.watchPosition) {
    const id = await p.Geolocation.watchPosition(options, (pos, err) => {
      if (err) onErr?.(err);
      else onOk?.(pos);
    });
    return { native: true, background: false, id };
  }
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    onErr?.({ code: 2, message: 'unsupported' });
    return { native: false, background: false, id: null };
  }
  const id = navigator.geolocation.watchPosition(onOk, onErr, options);
  return { native: false, background: false, id };
}

export async function clearWatch(handle) {
  if (!handle || handle.id == null) return;
  if (handle.background) {
    const p = await loadPlugins();
    await p?.BackgroundGeolocation?.removeWatcher?.({ id: handle.id });
    return;
  }
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

/**
 * Push facing-Compass state to the paired Apple Watch (ADR-0011).
 * No-op on web / when the native plugin is absent.
 *
 * @param {{
 *   heading?: number|null,
 *   marks?: object[],
 *   nextTurn?: string|null,
 *   settings?: object,
 *   raised?: boolean,
 * }} state
 */
export async function pushWatchCompass(state) {
  if (!isNativePlatform()) return { ok: false, reason: 'web' };
  const p = await loadPlugins();
  const plugin = p?.WatchCompass;
  if (!plugin?.pushState) return { ok: false, reason: 'no-plugin' };
  await plugin.pushState(state || {});
  return { ok: true };
}
