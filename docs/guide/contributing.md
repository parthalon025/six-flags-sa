# Contributing

[← README](../../README.md) · [Guide index](index.md)

Issues and feature ideas live in [GitHub Issues](https://github.com/parthalon025/six-flags-sa/issues).
Before opening a pull request, read the [architecture map](../architecture-map.md) and
[package seams](../../packages/README.md). App changes that touch generated venue output must go
through the [venue builder](../../packages/venue-builder/) — see `AGENTS.md` for the builder ↔ app
contract.

Screenshots and the walkthrough video live under `docs/images/readme/` and are listed in
`docs/images/readme/shots.json`. Recapture them when you change a screen they show
(map, heights, walking, party):

```bash
npm run start          # or npm run dev
npm run readme:shots   # stills + walkthrough.mp4
npm run readme:shots:check
```

CI runs the check against `origin/main`. A PR that edits a listed source file without
updating the matching PNG or video fails until you recapture.

---
[← README](../../README.md) · [Guide index](index.md)
