/**
 * WEBRTC, REMOVED FROM THE PAGE (review R13) — imported first, before any other renderer code runs.
 *
 * The app never uses WebRTC, and its traffic is the one kind the network seal cannot see: ICE/STUN is
 * UDP outside `webRequest`, and CSP does not govern `RTCPeerConnection`. Main already forces the
 * `disable_non_proxied_udp` policy (network.ts), which removes UDP and local-address gathering;
 * measured, a script could still reach a TURN server over TCP. Deleting the constructors closes that
 * for any code in this document.
 *
 * NOT A BOUNDARY ON ITS OWN: a fresh same-origin iframe has its own copies. CSP (`default-src 'self'`)
 * is what keeps foreign script out of the page in the first place; this is depth behind it.
 */
const WEBRTC_GLOBALS = ['RTCPeerConnection', 'webkitRTCPeerConnection', 'RTCDataChannel', 'RTCIceCandidate', 'RTCSessionDescription'];

for (const name of WEBRTC_GLOBALS) {
  try {
    delete (window as unknown as Record<string, unknown>)[name];
  } catch {
    // A non-configurable global stays; the main-process policy still applies to it.
  }
}

export {};
