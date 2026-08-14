# Notifications

[← README](../../README.md) · [Guide index](index.md)

Everything the app has to say used to be said in a toast that lasts a few seconds and a
vibration nobody feels through a bag, which is no use at all for the one message the party
feature exists to carry. Web Push fixes that, and it is off unless you give it keys:

```bash
node -e "console.log(require('web-push').generateVAPIDKeys())"
# put the pair in .env.local as VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY,
# plus VAPID_SUBJECT=mailto:you@example.com
```

Without them `/api/push/key` says so once, nothing asks again, and the app behaves exactly
as it did before.

A notification is the most revealing frame this app has — it says a name, and usually where
that name is — so it is sealed with the party key before it goes anywhere and opened again
by the service worker on the receiving phone. Our relay sees an endpoint and a blob; the
push service sees the same plus whose phone it is going to; only the phone sees the words.
The worker wakes with no page attached, so the key is kept in IndexedDB beside the party
id, written as the party changes and cleared on leaving — which is what makes a push from a
party you have left unreadable rather than merely unwelcome.

Four things are worth waking a phone for: somebody needing help, somebody joining or
leaving, the meet-up moving, and somebody going quiet. The last one can cry wolf — a queue
building eats signal for five minutes routinely — so it waits twelve and is off by default.
The first three are sent by whoever does them; going quiet is nobody's action, so the host
notices it alone.

On an iPhone this only works once the app is on the Home Screen. The button says so rather
than failing quietly.

---
[← README](../../README.md) · [Guide index](index.md)
