'use client';

import { useEffect, useRef } from 'react';
import { metresToFeet } from '@/lib/geo';

/* Spoken directions, the one part of a maps app you use with the phone in your
   pocket. The browser's own speech synthesiser does the talking — no network,
   no voices to download, nothing to configure.

   The rules are the ones a driver would recognise, at walking distances: name
   the maneuver once while there is still time to get in the right lane of the
   midway, again as you reach it, and say when you have arrived. Each is said
   at most once per instruction, because a phone that repeats itself every GPS
   fix is a phone that gets muted. */

const PREPARE_M = 90;
const NOW_M = 22;

function spokenDistance(m) {
  const ft = metresToFeet(m);
  if (ft < 1000) return `${Math.max(50, Math.round(ft / 50) * 50)} feet`;
  const mi = ft / 5280;
  return `${mi.toFixed(1)} miles`;
}

export default function useVoiceGuidance(enabled, { route, progress, target, phase }) {
  const said = useRef(new Set());
  const routeKey = useRef(null);

  // A new route — or a new destination — is a clean slate to talk about.
  const key = route ? `${target?.label}:${route.points.length}:${Math.round(route.metres)}` : null;
  useEffect(() => {
    if (routeKey.current !== key) {
      routeKey.current = key;
      said.current = new Set();
    }
  }, [key]);

  useEffect(() => {
    if (!enabled || phase !== 'go' || !route || !progress) return;
    const synth = typeof window !== 'undefined' ? window.speechSynthesis : null;
    if (!synth) return;

    const say = (id, text) => {
      if (said.current.has(id)) return;
      said.current.add(id);
      const utter = new SpeechSynthesisUtterance(text);
      utter.rate = 1.05;
      synth.speak(utter);
    };

    const step = progress.step;
    if (!step) return;
    const i = progress.stepIndex;

    if (step.turn === 'arrive') {
      if (progress.remaining < 40) say('arrive', `You have arrived at ${target.label}.`);
      return;
    }

    if (progress.toStep <= NOW_M) say(`${i}:now`, step.text);
    else if (progress.toStep <= PREPARE_M) {
      say(`${i}:prep`, `In ${spokenDistance(progress.toStep)}, ${lower(step.text)}`);
    }
  }, [enabled, phase, route, progress, target]);

  // Stop mid-sentence when the guidance is switched off or the route ends.
  useEffect(() => {
    if (enabled && phase === 'go') return undefined;
    return () => window.speechSynthesis?.cancel();
  }, [enabled, phase]);
}

const lower = (text) => text.charAt(0).toLowerCase() + text.slice(1);
