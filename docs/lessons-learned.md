# Lessons learned

Append-only log of implementation mistakes and guardrails.  
Format per entry:

```text
## YYYY-MM-DD — short title
- Lesson:
- Root cause:
- Fix:
- Regression test:
- Guardrail:
```

---

## 2026-08-10 — Dual store without dual write

- **Lesson:** Introducing PostGIS must not create a second silent writer of `public/venues/*`.
- **Root cause:** Platform twin and phone snapshot are easy to conflate into “just update the DB.”
- **Fix:** ADR dual-layer truth; builder/export remains sole publisher of generated venue JSON.
- **Regression test:** (pending) assert no runtime path writes `public/venues`.
- **Guardrail:** AGENTS.md builder ↔ app contract; contribution overlays only.

## 2026-08-10 — Profiles required, map still offline

- **Lesson:** Required user profiles must not imply “online-only app.”
- **Root cause:** Auth is often implemented as a hard network gate on every screen.
- **Fix:** Sign-in once → cache profile/session entitlements; map/routing remain SW-precached; contribution sync authenticates when online.
- **Regression test:** (pending) signed-in offline session still draws map and enqueues contributions.
- **Guardrail:** Backlog epic **EP**; master spec “User profiles (required).”
