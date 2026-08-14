'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { MOTION, cadenceFor, classifyMotion, createBroadcastGate } from '@/lib/gps/adaptive';
import { createGpsSmoother } from '@/lib/gps/smooth';

/**
 * States: 'idle' | 'asking' | 'live' | 'denied' | 'unsupported' | 'insecure' | 'manual'
 * The request must be fired from a real user gesture — iOS Safari drops the
 * permission prompt otherwise, which is the usual reason "it doesn't work".
 *
 * The watch is re-armed as motion changes: a phone in a queue or in a pocket
 * asks the radio for far less than a phone walking across the midway. The
 * policy itself lives in lib/gps/adaptive.js so the party layer and the tests
 * can reason about it without a browser.
 */

/** Enough samples to survive one bad fix without re-deriving speed from noise. */
const RECENT_MAX = 6;
/** Re-arm only for a band change worth the cost of dropping the current watch. */
const REARM_SLACK_MS = 1000;

export default function useGeolocation() {
  const [status, setStatus] = useState('idle');
  const [position, setPosition] = useState(null);
  const [error, setError] = useState(null);
  const [heading, setHeading] = useState(null);
  const [battery, setBattery] = useState(null);
  const [motion, setMotion] = useState(MOTION.STANDING);
  const [cadenceMs, setCadenceMs] = useState(() => cadenceFor(MOTION.STANDING, {}));

  const watchId = useRef(null);
  const recent = useRef([]);
  const lastSpeed = useRef(null);
  const isBackground = useRef(false);
  const batteryRef = useRef(null);
  const positionRef = useRef(null);
  // What the live watch is currently tuned for, as opposed to what we now want.
  const armed = useRef({ motion: null, ms: null });
  // Indirection so `arm` can stay identity-stable while the handlers it calls
  // are rebuilt — otherwise arming and handling depend on each other.
  const onFix = useRef(null);
  const onErr = useRef(null);

  const gate = useRef(null);
  if (gate.current === null) gate.current = createBroadcastGate();
  const smoother = useRef(null);
  if (smoother.current === null) smoother.current = createGpsSmoother();

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('geolocation' in navigator)) {
      setStatus('unsupported');
      return;
    }
    // Geolocation is gated to secure contexts. file:// and plain http on a LAN
    // address silently fail, so say so up front rather than spinning forever.
    if (!window.isSecureContext) setStatus('insecure');
  }, []);

  const arm = useCallback((nextMotion, ms) => {
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) return;
    if (watchId.current != null) navigator.geolocation.clearWatch(watchId.current);
    armed.current = { motion: nextMotion, ms };
    watchId.current = navigator.geolocation.watchPosition(
      (pos) => onFix.current?.(pos),
      (err) => onErr.current?.(err),
      {
        // A backgrounded phone gets coarse fixes: nothing is on screen to be
        // wrong, and the GPS chip is what drains the battery.
        enableHighAccuracy: nextMotion !== MOTION.BACKGROUND,
        timeout: Math.min(Math.max(ms * 2, 25000), 60000),
        // Accepting a cached fix up to one cadence old is most of the saving.
        maximumAge: ms,
      },
    );
  }, []);

  /** Re-classify motion and, if the band really moved, re-tune the watch. */
  const retune = useCallback(() => {
    const next = classifyMotion({
      speed: lastSpeed.current,
      recent: recent.current,
      isBackground: isBackground.current,
    });
    const ms = cadenceFor(next, { battery: batteryRef.current });
    setMotion(next);
    setCadenceMs(ms);
    if (watchId.current == null) return;
    const same =
      next === armed.current.motion && Math.abs(ms - (armed.current.ms ?? 0)) < REARM_SLACK_MS;
    if (!same) arm(next, ms);
  }, [arm]);

  const handle = useCallback(
    (pos) => {
      const c = pos.coords;
      const ts = Date.now();
      const raw = {
        lat: c.latitude,
        lng: c.longitude,
        acc: c.accuracy,
        ts,
        manual: false,
      };
      if (Number.isFinite(c.heading)) raw.heading = c.heading;
      if (Number.isFinite(c.speed)) raw.speed = c.speed;

      const fix = smoother.current.update(raw) ?? raw;
      positionRef.current = fix;
      setStatus('live');
      setError(null);
      setPosition(fix);

      // A heading is meaningless when you are barely moving — the GPS returns
      // whatever the last motion was and the arrow spins.
      if (Number.isFinite(c.heading) && c.speed > 0.7) setHeading(c.heading);

      lastSpeed.current = Number.isFinite(c.speed) ? c.speed : null;
      recent.current = [...recent.current, { lat: fix.lat, lng: fix.lng, ts }].slice(-RECENT_MAX);
      retune();
    },
    [retune],
  );

  const fail = useCallback((err) => {
    if (err.code === 1) {
      setStatus('denied');
      setError('Location permission was denied.');
    } else if (err.code === 2) {
      setError('No GPS fix yet. Step out from under cover and try again.');
    } else {
      setError('Location request timed out.');
    }
  }, []);

  useEffect(() => {
    onFix.current = handle;
    onErr.current = fail;
  }, [handle, fail]);

  const request = useCallback(() => {
    if (!('geolocation' in navigator)) {
      setStatus('unsupported');
      return;
    }
    setStatus('asking');
    setError(null);
    // The first fix is always the expensive accurate one — the whole screen is
    // waiting on it. The watch that follows is the one that gets rationed.
    navigator.geolocation.getCurrentPosition(
      (pos) => onFix.current?.(pos),
      (err) => onErr.current?.(err),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
    const next = classifyMotion({
      speed: lastSpeed.current,
      recent: recent.current,
      isBackground: isBackground.current,
    });
    arm(next, cadenceFor(next, { battery: batteryRef.current }));
  }, [arm]);

  const setManual = useCallback((lat, lng) => {
    const fix = smoother.current.update({ lat, lng, acc: null, ts: Date.now(), manual: true });
    positionRef.current = fix;
    setStatus('manual');
    setPosition(fix);
  }, []);

  useEffect(
    () => () => {
      if (watchId.current != null) navigator.geolocation.clearWatch(watchId.current);
    },
    [],
  );

  // Backgrounding is the biggest single lever, and it is free to detect.
  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const onVisibility = () => {
      isBackground.current = document.visibilityState === 'hidden';
      retune();
    };
    onVisibility();
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [retune]);

  // Battery, when the browser still has it. Leader election scores on charge,
  // so it is worth asking; almost everything but Chrome will say no.
  useEffect(() => {
    let cancelled = false;
    let source = null;
    const read = () => {
      if (cancelled || !source) return;
      const next = { level: source.level, charging: source.charging };
      batteryRef.current = next;
      setBattery(next);
      retune();
    };
    (async () => {
      try {
        const pending = navigator.getBattery?.();
        if (!pending) return;
        source = await pending;
        if (cancelled) {
          source = null;
          return;
        }
        read();
        source.addEventListener('levelchange', read);
        source.addEventListener('chargingchange', read);
      } catch {
        source = null; // Removed or blocked by policy: degrade quietly.
      }
    })();
    return () => {
      cancelled = true;
      source?.removeEventListener('levelchange', read);
      source?.removeEventListener('chargingchange', read);
    };
  }, [retune]);

  // Compass. iOS needs an explicit permission call from a gesture too.
  const compassListening = useRef(false);
  const onOriRef = useRef(null);

  const disableCompass = useCallback(() => {
    if (!compassListening.current || !onOriRef.current) return;
    window.removeEventListener('deviceorientationabsolute', onOriRef.current, true);
    window.removeEventListener('deviceorientation', onOriRef.current, true);
    onOriRef.current = null;
    compassListening.current = false;
  }, []);

  const enableCompass = useCallback(async () => {
    const D = typeof window !== 'undefined' ? window.DeviceOrientationEvent : null;
    if (!D) return;
    try {
      if (typeof D.requestPermission === 'function') {
        const res = await D.requestPermission();
        if (res !== 'granted') return;
      }
    } catch {
      return;
    }
    disableCompass();
    // Orientation fires tens of times a second; committing every sample into
    // React state re-renders the whole explore shell (map + sheet). Hold the
    // live value in a ref and publish at most ~8 Hz or when the needle moves.
    let lastPublished = null;
    let lastAt = 0;
    const HEADING_MIN_DEG = 2.5;
    const HEADING_MIN_MS = 125;
    const onOri = (e) => {
      let h = null;
      if (e.webkitCompassHeading != null) h = e.webkitCompassHeading;
      else if (e.alpha != null && e.absolute !== false) h = (360 - e.alpha) % 360;
      if (h == null || Number.isNaN(h)) return;
      const now = Date.now();
      const delta =
        lastPublished == null
          ? Infinity
          : Math.min(Math.abs(h - lastPublished), 360 - Math.abs(h - lastPublished));
      if (delta < HEADING_MIN_DEG && now - lastAt < HEADING_MIN_MS) return;
      lastPublished = h;
      lastAt = now;
      setHeading(h);
    };
    onOriRef.current = onOri;
    window.addEventListener('deviceorientationabsolute', onOri, true);
    window.addEventListener('deviceorientation', onOri, true);
    compassListening.current = true;
  }, [disableCompass]);

  useEffect(() => () => disableCompass(), [disableCompass]);

  /**
   * "Is this fix worth the radio?" — the party layer asks, the policy answers,
   * and the reason comes back with it for the diagnostics panel.
   */
  const shouldBroadcast = useCallback((ctx = {}) => {
    const fix = positionRef.current;
    if (!fix) return { send: false, reason: 'no-fix' };
    return gate.current.shouldSend(fix, ctx);
  }, []);

  return {
    status,
    position,
    error,
    heading,
    battery,
    motion,
    cadenceMs,
    request,
    setManual,
    enableCompass,
    disableCompass,
    shouldBroadcast,
  };
}
