/* What each POI category means, in one place. */

export const ONTOLOGY = {
  version: 1,
  interfaces: {
    Locatable: 'has a coordinate the map can draw and the router can snap to',
    Rideable: 'a height rule may apply; the filter and the report button care',
    Queueable: 'may carry e — a queue entrance is a claim on the ride, not a row',
    HeightChecked: 'may carry h',
    Reportable: 'ride status can be set and replicated',
    Sheltered: 'weather treats as under cover by default',
    Schedulable: 'opening hours would matter if they were ever read',
    Inert: 'weather and status ignore it',
    MeetCandidate: 'a named standing-room place suitable as a reunification point',
  },
  categories: {
    coaster: {
      label: 'Coasters',
      interfaces: ['Locatable', 'Rideable', 'Queueable', 'HeightChecked', 'Reportable'],
    },
    ride: {
      label: 'Rides',
      interfaces: ['Locatable', 'Rideable', 'Queueable', 'HeightChecked', 'Reportable'],
    },
    food: { label: 'Food', interfaces: ['Locatable', 'Sheltered', 'MeetCandidate'] },
    restroom: { label: 'Restrooms', interfaces: ['Locatable', 'Sheltered', 'MeetCandidate'] },
    service: { label: 'Services', interfaces: ['Locatable', 'Sheltered', 'MeetCandidate'] },
    shop: { label: 'Shops', interfaces: ['Locatable', 'Sheltered', 'MeetCandidate'] },
    show: { label: 'Shows', interfaces: ['Locatable', 'Schedulable', 'MeetCandidate'] },
    gate: { label: 'Gates', interfaces: ['Locatable', 'Inert'] },
    landmark: { label: 'Landmarks', interfaces: ['Locatable', 'Inert', 'MeetCandidate'] },
    campsite: { label: 'Camping', interfaces: ['Locatable', 'Sheltered'] },
    parking: { label: 'Parking', interfaces: ['Locatable', 'Inert'] },
  },
};

export const CATEGORY_KEYS = Object.keys(ONTOLOGY.categories);

export function implementsIface(poi, iface) {
  const cat = poi?.c;
  if (!cat) return false;
  const row = ONTOLOGY.categories[cat];
  return Boolean(row?.interfaces?.includes(iface));
}

export function categoriesWith(iface) {
  return CATEGORY_KEYS.filter((key) => ONTOLOGY.categories[key].interfaces.includes(iface));
}

export const isRideable = (poi) => implementsIface(poi, 'Rideable');
export const isQueueable = (poi) => implementsIface(poi, 'Queueable');
export const isReportable = (poi) => implementsIface(poi, 'Reportable');
export const isMeetCandidate = (poi) => implementsIface(poi, 'MeetCandidate');
export const isSheltered = (poi) => implementsIface(poi, 'Sheltered');
export const isSchedulable = (poi) => implementsIface(poi, 'Schedulable');
export const isInert = (poi) => implementsIface(poi, 'Inert');

export const rideable = isRideable;
