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
  const offerWaiters = [];
  const answerWaiters = [];

  const waitFor = (get, waiters) =>
    new Promise((resolve) => {
      const cur = get();
      if (cur) {
        resolve(cur);
        return;
      }
      waiters.push(() => resolve(get()));
    });

  const resolveOffer = () => {
    while (offerWaiters.length) offerWaiters.shift()(offerPayload);
  };

  const resolveAnswer = () => {
    while (answerWaiters.length) answerWaiters.shift()(answerPayload);
  };

  const host = {
    onOfferReady: async (encoded) => {
      offerPayload = encoded;
      resolveOffer();
    },
    waitForOfferEncoded: () => waitFor(() => offerPayload, offerWaiters),
    waitForAnswer: () => waitFor(() => answerPayload, answerWaiters),
    submitAnswer: async (encoded) => {
      answerPayload = encoded;
      resolveAnswer();
    },
  };

  const client = {
    submitOffer: async (encoded) => {
      offerPayload = encoded;
      resolveOffer();
    },
    waitForOffer: () => waitFor(() => offerPayload, offerWaiters),
    waitForAnswerEncoded: () => waitFor(() => answerPayload, answerWaiters),
    onAnswerReady: async (encoded) => {
      answerPayload = encoded;
      resolveAnswer();
    },
  };

  return {
    host,
    client,
    reset: () => {
      offerPayload = null;
      answerPayload = null;
      offerWaiters.length = 0;
      answerWaiters.length = 0;
    },
  };
}
