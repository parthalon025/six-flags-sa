'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  anonymizeSession,
  sessionToGeoJSON,
  sessionsToFeatureCollection,
  summarizeSession,
  formatMetres,
  formatDuration,
} from '@/lib/gps/movementLog';
import {
  appendFix,
  clearAllSessions,
  deleteSession,
  loadPrefs,
  loadState,
  markUploaded,
  savePrefs,
} from '@/lib/gps/movementStore';

/**
 * Opt-in movement logger. Feeds off the live GPS position already held by the
 * page — it does not open a second watchPosition.
 */
export default function useMovementLog({ position, venue } = {}) {
  const [prefs, setPrefs] = useState(() => defaultClientPrefs());
  const [sessions, setSessions] = useState([]);
  const [openId, setOpenId] = useState(null);
  const [ready, setReady] = useState(false);
  const [lastReason, setLastReason] = useState('idle');
  const writing = useRef(false);
  const lastTs = useRef(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const p = loadPrefs();
      const state = await loadState();
      if (cancelled) return;
      setPrefs(p);
      setSessions(state.sessions || []);
      setOpenId(state.openId || null);
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!ready || !prefs.enabled || !position || !venue?.id) return;
    if (position.manual) return;
    if (position.ts && position.ts === lastTs.current) return;
    if (writing.current) return;

    writing.current = true;
    lastTs.current = position.ts || Date.now();
    appendFix({
      point: position,
      venueId: venue.id,
      venueName: venue.name,
      bounds: venue.bounds,
      enabled: true,
    })
      .then((next) => {
        setSessions(next.sessions || []);
        setOpenId(next.openId || null);
        setLastReason(next.reason || 'idle');
      })
      .catch(() => {
        setLastReason('store-error');
      })
      .finally(() => {
        writing.current = false;
      });
  }, [ready, prefs.enabled, position, venue?.id, venue?.name, venue?.bounds]);

  const setEnabled = useCallback((enabled) => {
    const next = savePrefs({ ...loadPrefs(), enabled: Boolean(enabled) });
    setPrefs(next);
    return next;
  }, []);

  const setAutoUpload = useCallback((autoUpload) => {
    const next = savePrefs({ ...loadPrefs(), autoUpload: Boolean(autoUpload) });
    setPrefs(next);
    return next;
  }, []);

  const refresh = useCallback(async () => {
    const state = await loadState();
    setSessions(state.sessions || []);
    setOpenId(state.openId || null);
    return state;
  }, []);

  const removeSession = useCallback(async (id) => {
    const next = await deleteSession(id);
    setSessions(next.sessions || []);
    setOpenId(next.openId || null);
    return next;
  }, []);

  const clearHistory = useCallback(async () => {
    const next = await clearAllSessions();
    setSessions([]);
    setOpenId(null);
    return next;
  }, []);

  const buildUploadPayload = useCallback(
    (ids) => {
      const want = ids ? new Set(ids) : null;
      const picked = sessions.filter((s) => {
        if ((s.points || []).length < 2) return false;
        if (want && !want.has(s.id)) return false;
        return true;
      });
      return sessionsToFeatureCollection(picked, { anonymize: true });
    },
    [sessions],
  );

  const uploadSessions = useCallback(
    async (ids) => {
      const collection = buildUploadPayload(ids);
      if (!collection.features.length) {
        return { ok: false, error: 'Nothing ready to upload yet' };
      }
      const res = await fetch('/api/contributions/traces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(collection),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        return { ok: false, error: body.error || `Upload failed (${res.status})` };
      }
      const uploadedIds = collection.features.map((f) => f.properties.sessionId);
      const next = await markUploaded(uploadedIds);
      setSessions(next.sessions || []);
      return { ok: true, count: uploadedIds.length, body };
    },
    [buildUploadPayload],
  );

  const exportSessionJson = useCallback(
    (id) => {
      const session = sessions.find((s) => s.id === id);
      if (!session) return null;
      return sessionToGeoJSON(anonymizeSession(session), { anonymize: false });
    },
    [sessions],
  );

  const summaries = sessions
    .map(summarizeSession)
    .sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));

  const totals = summaries.reduce(
    (acc, s) => {
      acc.metres += s.metres || 0;
      acc.walks += s.pointCount >= 2 ? 1 : 0;
      acc.pending += s.status === 'ready' ? 1 : 0;
      return acc;
    },
    { metres: 0, walks: 0, pending: 0 },
  );

  return {
    ready,
    prefs,
    enabled: prefs.enabled,
    setEnabled,
    setAutoUpload,
    sessions,
    summaries,
    openId,
    lastReason,
    totals,
    refresh,
    removeSession,
    clearHistory,
    uploadSessions,
    exportSessionJson,
    formatMetres,
    formatDuration,
  };
}

function defaultClientPrefs() {
  if (typeof window === 'undefined') {
    return { enabled: false, autoUpload: false };
  }
  return loadPrefs();
}
