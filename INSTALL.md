# Installing Kings Island Tracker

Three ways to get this running, from least to most technical. **Most families want
the first one.**

Whichever you pick, the app ends up as an icon on everyone's phone and one phone
runs the party. There are no accounts, and nobody has to sign up for anything.

---

## Before you start: why a plain link won't do

Phones refuse to hand over GPS to a page that isn't on `https://`. This is a
browser rule, not a setting you can turn off, and it's the reason "just open the
file" or "type in my laptop's IP address" doesn't work — the map will draw, but
everyone stays invisible.

So every route below is really about getting one honest `https://` address. Once
you have it, everything else is automatic.

`http://localhost` is the one exception: browsers trust it, which is why the
development instructions work without any of this.

---

## Option 1 — Put it online once, use it forever

Best for: a family that wants a permanent link and never wants to think about it
again. Takes about ten minutes, once. Free, no card.

1. Make a free account at **[github.com](https://github.com)** and at
   **[vercel.com](https://vercel.com)** — sign in to Vercel *with* GitHub so the
   two are already connected.
2. Put this project in a GitHub repository. On github.com: **New repository** →
   name it `kings-island-tracker` → **Create** → **uploading an existing file** →
   drag in everything from this folder *except* `node_modules` and `.next` →
   **Commit**.
3. On vercel.com: **Add New → Project** → pick that repository → **Deploy**.
   Change nothing; the defaults are right. A minute later you get a link like
   `https://kings-island-tracker.vercel.app`.
4. Open that link on each phone and follow **[Put it on the home screen](#put-it-on-the-home-screen)** below.

That's the whole install. Party hosting runs on the phones themselves, so there
is **no database to set up** and nothing else to configure.

> **A note on what Vercel is doing here.** It serves the app and acts as a relay
> when two phones can't reach each other directly. It is not the source of truth
> for your party — the host phone is. If everyone is on the same wifi, the phones
> talk to each other and Vercel carries almost nothing.

---

## Option 2 — Run it on a machine you own

Best for: anyone who'd rather not put it on someone else's servers, and has a
computer that can stay on.

With Docker, one command:

```bash
docker compose up -d
```

That serves the app on port 3000 and the sync service on 8787. Without Docker:

```bash
./scripts/setup.sh      # checks Node, installs, builds
npm start
```

Either way you still need that `https://` address from the outside world. The
easiest free options:

```bash
npx localtunnel --port 3000       # prints an https://….loca.lt address
```

or a [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/)
if you want a stable name. Point your phones at whichever address it prints.

**Self-hosting buys you** long-lived parties that survive every phone leaving,
and `/api/metrics` if you like graphs. It is not required for the app to work.

---

## Option 3 — Just for one trip

Best for: a single day out, nothing to sign up for, nothing left running
afterwards. Your laptop has to stay awake and online at home while you're at the
park.

```bash
./scripts/setup.sh
npm start
```

Then in a second terminal:

```bash
npx localtunnel --port 3000
```

It prints an `https://….loca.lt` address that works on any phone, GPS included.
The address changes every time you restart the tunnel, so this is a
day-of-the-trip tool rather than a permanent setup.

If you don't have Node yet, install the **LTS** build from
[nodejs.org](https://nodejs.org) and reopen your terminal. `./scripts/setup.sh`
will tell you if the version is too old.

---

## Put it on the home screen

Do this on **every** phone in the group. It takes about fifteen seconds each and
it genuinely matters: installed, the app opens full screen with no browser bars,
and the entire park map is stored on the phone, so it draws instantly and keeps
working when the signal dies in a queue line.

Open the site, go to the **Me** tab, and follow the **Install on this phone**
card. It knows which phone it's on:

- **Android / Chrome** — there's a button. Tap it.
- **iPhone / Safari** — tap **Share** → **Add to Home Screen**. iOS gives no
  automatic prompt, so the card just shows you the taps.

Allow location when asked. If you say no by accident, the app's location screen
explains how to undo that for your specific phone.

---

## Starting and joining a party

One person creates; everyone else joins. No accounts, no invites to accept.

**The host** taps **Start a party**. Their phone becomes the party's server — it
holds the roster and everyone's positions, and it does this locally rather than
sending your family's location to a company.

**Everyone else** joins by whichever of these is easiest at the time:

1. **Scan the QR code** on the host's screen. Fastest, and the only one that
   needs no typing.
2. **Tap the invite link** the host shares by text.
3. **Type the 6-character code** if the other two aren't practical.

If the host's phone dies or goes home, the party doesn't end — the remaining
phones pick a new host automatically, preferring whoever has the most battery.
Nobody has to do anything, and the party code stays the same.

### What's private, and what isn't

Your party's location data is encrypted with a key that only the phones in the
party ever hold. It travels in the QR code and in the fragment of the invite link
— the part after the `#`, which browsers never send to a server. If your phones
end up relaying through the cloud, the relay can see *that* a party is active but
cannot read where anyone is.

Party codes are short enough to read aloud in a queue, which means they're also
short enough to guess. Treat a party as semi-public: use first names, and leave
when you're done, which deletes your record.

---

## If something goes wrong

| What you see | What it means |
|---|---|
| Map draws, but nobody has a position | The address isn't `https://`. See the top of this page. |
| "Location permission was denied" | Undo it in the phone's site settings — the in-app location screen has the exact steps for your phone. |
| Joined, but the roster stays empty | The phones can't reach each other *and* can't reach a relay. Put them on the same wifi, or use Option 1. |
| Everything worked, then stopped in a queue line | Normal. The map and ride heights keep working offline; positions catch up when the signal returns. |
| The host went home and everything froze | Give it about ten seconds — a new host is elected automatically. |

Nothing here needs a reinstall. If you want to start completely fresh, leave the
party and reload the page.

---

## For developers

```bash
./scripts/setup.sh --dev          # install and start the dev server
./scripts/setup.sh --with-tests   # also fetch the browser the suites need
npm test                          # the full functional audit
```

`README.md` covers the architecture, the transport layer and the API surface.
