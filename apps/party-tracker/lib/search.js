/* Searching a park by the words people actually use.
 *
 * A place list matched on nothing but the name gets the easy half of the job
 * right and the half that matters wrong. Nobody standing in a queue with a
 * five-year-old types "Restrooms" — they type "toilet", and a name-only match
 * answers "Nothing matches that." at a park with eleven of them.
 *
 * So a query is tried three ways: against the category's own label, against a
 * table of the plain words someone says out loud, and against the name and the
 * land as before. The label pass is the one that never rots — a category added
 * later is findable by its own name with no entry here — and the table is the
 * one that earns its keep, because none of "toilet", "lunch", "exit", "nurse"
 * or "cash machine" appear in any label.
 */
import { CATEGORY_LABELS } from '@/lib/theme';

/* Deliberately plain and deliberately not exhaustive: these are words for a
   park, not OpenStreetMap's vocabulary. Ordinary misspellings are not handled
   and should not be — a wrong guess that returns the wrong end of the park is
   worse than no results. */
export const CATEGORY_WORDS = {
  restroom: [
    'toilet', 'toilets', 'bathroom', 'restroom', 'washroom', 'loo', 'wc',
    'ladies', 'gents', 'mens', 'womens', 'changing', 'baby change', 'nappy', 'diaper',
  ],
  food: [
    'food', 'eat', 'eating', 'lunch', 'dinner', 'breakfast', 'snack', 'snacks',
    'drink', 'drinks', 'coffee', 'soda', 'pizza', 'burger', 'ice cream',
    'hungry', 'thirsty', 'restaurant', 'cafe',
  ],
  service: [
    'first aid', 'firstaid', 'aid', 'medic', 'medical', 'nurse', 'doctor',
    'sick', 'hurt', 'injured', 'atm', 'cash', 'cash machine', 'money', 'bank',
    'water', 'fountain', 'drinking water', 'lost', 'lost and found',
    'guest services', 'stroller', 'pushchair', 'wheelchair', 'locker',
    'lockers', 'charging', 'charger',
  ],
  gate: ['exit', 'entrance', 'entry', 'gate', 'way out', 'turnstile', 'ticket', 'tickets'],
  parking: ['parking', 'car', 'car park', 'carpark', 'lot', 'my car', 'van', 'bus'],
  shop: ['shop', 'store', 'gift', 'souvenir', 'shopping', 'hat', 'sunscreen', 'poncho'],
  coaster: ['coaster', 'coasters', 'rollercoaster', 'roller coaster', 'thrill'],
  ride: ['ride', 'rides', 'kiddie', 'carousel', 'ferris', 'family ride'],
  show: ['show', 'shows', 'theatre', 'theater', 'stage', 'concert', 'music', 'parade'],
  landmark: ['landmark', 'statue', 'fountain', 'sign', 'photo'],
  campsite: [
    'camp', 'campsite', 'camp site', 'campground', 'campground', 'camping',
    'rv', 'caravan', 'motorhome', 'trailer', 'tent', 'pitch', 'site',
    'cabin', 'cottage', 'hookup', 'dump station', 'registration', 'check in',
  ],
};

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/* A short query matches at a word start only. Without this the three letters
   of "atm" find BATMAN The Ride, which is the one result on the screen that is
   certainly not a cash machine. Longer queries keep the loose match, because
   "rattler" ought to find Iron Rattler. */
function matcherFor(q) {
  if (!q) return () => true;
  const wordStart = q.length <= 4 ? new RegExp(`\\b${esc(q)}`, 'i') : null;
  return (text) =>
    wordStart ? wordStart.test(text || '') : String(text || '').toLowerCase().includes(q);
}

/**
 * Which categories a query is asking for, as a Set of category codes. Matched
 * from either end so that a half-typed "toil" finds toilets and a fuller
 * "toilets please" still finds them.
 */
export function categoriesFor(query) {
  const q = (query || '').trim().toLowerCase();
  const hit = new Set();
  if (!q) return hit;
  for (const [category, words] of Object.entries(CATEGORY_WORDS)) {
    if (words.some((w) => w.startsWith(q) || q.startsWith(w))) hit.add(category);
  }
  for (const [category, label] of Object.entries(CATEGORY_LABELS)) {
    if (label.toLowerCase().startsWith(q)) hit.add(category);
  }
  return hit;
}

/**
 * One place against one query. `cats` comes from `categoriesFor` and is hoisted
 * by the caller so it is computed once per query rather than once per place.
 */
/**
 * @param facets optional extra searchable text per place, keyed by id — the
 *   caller's chance to make something findable that is nowhere in its name.
 *   Every pitch in a campground is called "Site 247", so "50 amp" and
 *   "pull through" would otherwise match nothing at all.
 */
export function matchesQuery(poi, query, cats, facets = null) {
  const q = (query || '').trim().toLowerCase();
  if (!q) return true;
  const contains = matcherFor(q);
  if (contains(poi.n) || contains(poi.a)) return true;
  const extra = facets?.get?.(poi.id);
  if (extra && contains(extra)) return true;
  return Boolean(cats && cats.has(poi.c));
}

/**
 * Did this place match because of what it is called, or only because of what
 * kind of thing it is? Something that answers by name outranks the category it
 * happens to share: "atm" means the cash machine first and the rest of the
 * services after it, not the nearest first-aid hut.
 */
export function matchedByName(poi, query) {
  const q = (query || '').trim().toLowerCase();
  if (!q) return false;
  const contains = matcherFor(q);
  return contains(poi.n) || contains(poi.a);
}
