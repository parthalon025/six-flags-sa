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
