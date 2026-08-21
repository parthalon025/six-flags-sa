# Name-keyed → deterministic-id override migration

The venue builder does not migrate its hand-written override files from
display-name keys to deterministic id (slug) keys. Name keys are the
contract; id keys are an escape hatch, not a destination.

## Why this is out of scope

Override files are read and edited against a park's published height
chart, where the display name is the thing a human can check.
[`docs/park-intelligence-review.md`](../docs/park-intelligence-review.md)
records the decision:

> **Name-keyed overrides stay.** Converting 196 hand-written entries to
> slugs would be a downgrade: those files are read and edited against a
> park's published height chart, where `"BATMAN The Ride"` is checkable
> and `batman-the-ride` is not. Id keys become an *escape hatch* for the
> ambiguous cases. This is the title-separate-from-key rule doing its
> job — the overrides file is the title side, the bundle is where the
> key lives.

The deterministic-id machinery itself is landed and is not what this
rejection covers: every venue carries an `ids.json` ledger, built POIs
carry stable `i` keys, and `resolveOverride` in the venue-ids library
(shared by `applyOverrides` and the heights sidecar) resolves by
deterministic key first and display name second. Any individual override
*can* be id-keyed today — that is the intended escape hatch for
ambiguous names (for example, one of Cedar Point's 26 "Restrooms"
entries). What stays rejected is the wholesale conversion of the
hand-written entries.

## Prior requests

- #278: "Builder E1.2: migrate name-keyed overrides to deterministic ids"
