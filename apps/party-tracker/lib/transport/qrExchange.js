/**
 * In-memory offer/answer handoff for QR WebRTC pairing.
 *
 * Tests wire host and client halves directly; PairQr wires UI callbacks to the
 * same shape createWebRTC({ signal: 'qr', qr }) expects.
 */

/**
 * @returns {{ host: object, client: object, reset: () => void }}
 */
export function createQrExchange() {
  let offerPayload = null;
  let answerPayload = null;

  const host = {
    onOfferReady: async (encoded) => {
      offerPayload = encoded;
    },
    waitForAnswer: async () => {
      while (!answerPayload) {
        await new Promise((r) => setTimeout(r, 0));
      }
      return answerPayload;
    },
  };

  const client = {
    waitForOffer: async () => {
      while (!offerPayload) {
        await new Promise((r) => setTimeout(r, 0));
      }
      return offerPayload;
    },
    onAnswerReady: async (encoded) => {
      answerPayload = encoded;
    },
  };

  return {
    host,
    client,
    reset: () => {
      offerPayload = null;
      answerPayload = null;
    },
  };
}
