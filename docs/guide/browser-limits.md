# What a browser cannot do

[← README](../../README.md) · [Guide index](index.md)

Stated plainly rather than stubbed to look finished:

- **Background location.** There is no web API for it. When the screen locks, the PWA is
  suspended and positions stop updating — a phone in a pocket goes stale rather than
  reporting a stale position as live. After 5 minutes the map rings that person with a
  broken circle and prints how long ago it heard from them, and stops drawing the arrow
  for which way they were walking. App Store / Play binaries use Capacitor background
  Location so a pocketed Host still updates the Party — [fastlane/README.md](../../fastlane/README.md).
- **BLE advertising and discovery**, as above.
- **A phone acting as an HTTP listener**, and `party.local` mDNS resolution. The host
  phone runs the party *service*; peers reach it over WebRTC, not a socket it opened.

---
[← README](../../README.md) · [Guide index](index.md)
