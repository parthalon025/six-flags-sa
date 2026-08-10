'use client';

/**
 * BLE transport — a placeholder that reports the truth.
 *
 * This adapter holds its slot in the selection order and nothing more. It
 * cannot be made to work from a browser at any effort level: Web Bluetooth
 * exposes only the GATT *central* role, so a page can connect outward to an
 * already-advertising device but can never advertise, never run a GATT server,
 * and never scan raw advertisements. Two phones running this app are both
 * centrals, and two centrals cannot see each other.
 *
 * Making this real needs a native shell, not more JavaScript:
 *   - iOS/Android wrapper (Capacitor/React Native) exposing CoreBluetooth
 *     peripheral mode / Android BluetoothLeAdvertiser + GattServer, so one
 *     phone can host, plus
 *   - ideally Nearby Connections (Android) / MultipeerConnectivity (iOS) for
 *     the throughput the roster actually wants, since BLE GATT tops out around
 *     a few KB/s and the snapshot frames would need chunking.
 * Until that shell exists, `probe` returns unavailable and the manager skips
 * straight past this to the next rank.
 */

import { defineTransport, RANK } from './types.js';

const UNSUPPORTED = 'unsupported';
const NO_PERIPHERAL = 'no-peripheral-mode';

function reasonFor() {
  if (typeof navigator === 'undefined' || !navigator.bluetooth) return UNSUPPORTED;
  // The API is present, which only means this browser can act as a central.
  // A phone still cannot host over BLE, so the slot stays unavailable.
  return NO_PERIPHERAL;
}

export function createBluetooth() {
  return defineTransport({
    name: 'bluetooth-le',
    rank: RANK.BLUETOOTH,

    probe: async () => ({ available: false, reason: reasonFor() }),

    open: async () => {
      throw new Error(
        'bluetooth-le cannot open: Web Bluetooth is central-only, so no browser can host a party over BLE',
      );
    },

    send: async () => {
      throw new Error('bluetooth-le cannot send: transport is not implementable in a browser');
    },

    close: async () => {},

    describe: () => ({ reason: reasonFor(), implemented: false }),
  });
}
