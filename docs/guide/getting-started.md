# Get it running

[← README](../../README.md) · [Guide index](index.md)

**[INSTALL.md](../../INSTALL.md) is the guide for the people who will actually use this** — it
assumes no terminal and leads with why a plain link cannot work.

The two short versions:

```bash
npm run phone        # builds, starts, tunnels, prints a QR — scan it
```

or click Deploy in [INSTALL.md](../../INSTALL.md) for a permanent link. There is nothing to
configure either way: no database, no environment variables, no accounts. A party is
hosted by one of the phones in it.

For development:

```bash
npm run setup        # checks Node, installs, builds
npm run dev          # http://localhost:3000
```

`localhost` counts as a secure context, so GPS works there without a tunnel.

---
[← README](../../README.md) · [Guide index](index.md)
