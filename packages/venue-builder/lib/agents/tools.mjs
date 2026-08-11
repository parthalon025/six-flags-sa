/**
 * Agent tool catalogue — maps roles to adapter ids and builder commands.
 */

export const AGENT_ROLES = ['orchestrator', 'qa', 'research', 'gis', 'vision', 'validation'];

/** Tools each agent may invoke (license-safe defaults). */
export const ROLE_TOOLS = {
  orchestrator: ['qa', 'research', 'gis', 'validation', 'llm-plan'],
  qa: ['venue-audit', 'route-qa', 'venue-checklist'],
  research: ['official-fetch', 'playwright', 'parks-api', 'venue-research', 'sync-external-sources'],
  gis: ['route-qa', 'tippecanoe', 'osm-rebuild'],
  vision: ['sam2', 'mapillary-tools', 'evidence-graph'],
  validation: ['attractions-refresh', 'evidence-html', 'evidence-graph', 'attractions-report'],
};

export const TOOL_ADAPTERS = {
  playwright: 'playwright',
  'parks-api': 'parks-api',
  tippecanoe: 'tippecanoe',
  'evidence-html': 'evidence-html',
  'evidence-graph': 'evidence-graph',
};
