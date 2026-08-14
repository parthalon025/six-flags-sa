# App Privacy — App Store Connect questionnaire

Use this when filling **App Privacy** for Park Bound: Explore (`ai.kurat0r.parkbound`). Adjust if the live app changes.

## Data collection summary

**Do you or your third-party partners collect data from this app?**  
Yes.

**Is data used for tracking?**  
No (no ad network, no IDFA, no cross-app tracking).

---

## Data types

### Location — Precise Location

| Question | Answer |
|----------|--------|
| Collected? | Yes |
| Linked to user? | Yes when Profile signed in or Party member with display name; guest map-only use is on-device for navigation |
| Used for tracking? | No |
| Purposes | App Functionality (map, directions, Party Location, Side Quest proximity) |

### Contact Info — Name

| Question | Answer |
|----------|--------|
| Collected? | Yes (display name for Party; Clerk profile name when signed in) |
| Linked to user? | Yes |
| Tracking? | No |
| Purposes | App Functionality |

### Contact Info — Email Address

| Question | Answer |
|----------|--------|
| Collected? | Optional — from Apple/Google via Clerk when user signs in |
| Linked to user? | Yes |
| Tracking? | No |
| Purposes | App Functionality (account) |

### User Content — Other User Content

| Question | Answer |
|----------|--------|
| Collected? | Yes — Contributions, ride reports, Side Quest submissions |
| Linked to user? | Profile for Contributions; display name for in-Party ride reports |
| Tracking? | No |
| Purposes | App Functionality |

### Identifiers — User ID

| Question | Answer |
|----------|--------|
| Collected? | Yes — Clerk user id for Profile |
| Linked to user? | Yes |
| Tracking? | No |
| Purposes | App Functionality |

### Usage Data — Product Interaction (if Connect asks)

| Question | Answer |
|----------|--------|
| Collected? | Optional aggregate analytics (Vercel Analytics) |
| Linked to user? | No |
| Tracking? | No |
| Purposes | Analytics (performance) |

### Diagnostics — Performance (if Connect asks)

| Question | Answer |
|----------|--------|
| Collected? | Optional (Vercel Speed Insights, sampled) |
| Linked to user? | No |
| Tracking? | No |
| Purposes | App Functionality / Analytics |

---

## Not collected

- Health data (height inches are user-entered ride eligibility, not HealthKit)
- Financial info
- Browsing history off-app
- Purchases (free app, no IAP at 1.0)
- Photos / videos (unless user adds in a future feature — not at 1.0)
- Sensitive info

---

## Third-party SDKs (disclosure)

| SDK | Data | Purpose |
|-----|------|---------|
| Clerk | Auth identifiers, name, email from OAuth provider | Sign-in |
| Vercel Analytics | Aggregated page views | Performance |
| Vercel Speed Insights | Performance metrics (sampled) | Performance |

Privacy policy: https://parkbound.kurat0r.ai/privacy
