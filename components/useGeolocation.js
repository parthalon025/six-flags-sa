'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * States: 'idle' | 'asking' | 'live' | 'denied' | 'unsupported' | 'insecure' | 'manual'
 * The request must be fired from a real user gesture — iOS Safari drops the
 * permission prompt otherwise, which is the usual reason "it doesn't work".
 */
export default function useGeolocation() {
  const [status, setStatus] = useState('idle');
  const [position, setPosition] = useState(null);
  const [error, setError] = useState(null);
  const [heading, setHeading] = useState(null);
  const watchId = useRef(null);

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

  const handle = useCallback((pos) => {
    setStatus('live');
    setError(null);
    setPosition({
      lat: pos.coords.latitude,
      lng: pos.coords.longitude,
      acc: pos.coords.accuracy,
      ts: Date.now(),
      manual: false,
    });
    if (pos.coords.heading != null && !Number.isNaN(pos.coords.heading) && pos.coords.speed > 0.7) {
      setHeading(pos.coords.heading);
    }
  }, []);

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

  const request = useCallback(() => {
    if (!('geolocation' in navigator)) {
      setStatus('unsupported');
      return;
    }
    setStatus('asking');
    setError(null);
    navigator.geolocation.getCurrentPosition(handle, fail, {
      enableHighAccuracy: true,
      timeout: 15000,
      maximumAge: 0,
    });
    if (watchId.current != null) navigator.geolocation.clearWatch(watchId.current);
    watchId.current = navigator.geolocation.watchPosition(handle, fail, {
      enableHighAccuracy: true,
      timeout: 25000,
      maximumAge: 3000,
    });
  }, [handle, fail]);

  const setManual = useCallback((lat, lng) => {
    setStatus('manual');
    setPosition({ lat, lng, acc: null, ts: Date.now(), manual: true });
  }, []);

  useEffect(
    () => () => {
      if (watchId.current != null) navigator.geolocation.clearWatch(watchId.current);
    },
    [],
  );

  // Compass. iOS needs an explicit permission call from a gesture too.
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
    const onOri = (e) => {
      let h = null;
      if (e.webkitCompassHeading != null) h = e.webkitCompassHeading;
      else if (e.alpha != null && e.absolute !== false) h = (360 - e.alpha) % 360;
      if (h != null && !Number.isNaN(h)) setHeading(h);
    };
    window.addEventListener('deviceorientationabsolute', onOri, true);
    window.addEventListener('deviceorientation', onOri, true);
  }, []);

  return { status, position, error, heading, request, setManual, enableCompass };
}
