# Contributing

[← README](../../README.md) · [Guide index](index.md)

Issues and feature ideas live in [GitHub Issues](https://github.com/parthalon025/six-flags-sa/issues).
Before opening a pull request, read the [architecture map](../architecture-map.md) and
[package seams](../../packages/README.md). App changes that touch generated venue output must go
through the [venue builder](../../packages/venue-builder/) — see `AGENTS.md` for the builder ↔ app
contract.

Screenshots in this README live under `docs/images/readme/`. Regenerate them after major UI
changes with the dev server running:

```bash
npm run dev
node test/app/audit-visual.mjs   # writes test/audit/*.png — copy picks into docs/images/readme/
```

---
[← README](../../README.md) · [Guide index](index.md)
