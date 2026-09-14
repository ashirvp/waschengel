// Service packages come from the PRODUCTS you keep in Lexware (Artikel), not
// from prices copied into this repo. Change a price in Lexware and the app
// follows within a few minutes — nobody has to redeploy anything.
//
// Lexware calls them "articles": GET /v1/articles.

const config = require('./config');
const lexware = require('./lexware');

// Used only when Lexware can't be reached (no key yet, API down, no network).
// Staff can still invoice; the prices are the ones agreed at the time of
// writing and are replaced by the live ones as soon as a fetch succeeds.
const FALLBACK = [
  {
    title: 'Complete Ferrari NW',
    netPrice: 530,
    taxRate: 19,
    unitName: 'Stück',
    description:
      'Vacuuming of the interior and trunk, interior and exterior window cleaning, hand wash of the exterior, paint cleaning, wheel cleaning, vehicle sealing, vehicle polishing, hologram removal including fine sanding and polishing, cleaning of door sills and edges, intensive cleaning and care of the cockpit/plastics throughout the interior, headliner cleaning, carpet and floor mat cleaning, leather seat and upholstery cleaning (shampooing), refreshing of exterior plastic parts and tires',
  },
  {
    title: 'Complete GW',
    netPrice: 435,
    taxRate: 19,
    unitName: 'Stück',
    description:
      'Vacuuming of the interior and trunk, interior and exterior window cleaning, hand washing of the exterior, paint cleaning, wheel cleaning, vehicle sealing, vehicle polishing, vehicle waxing, cleaning of door sills and edges, intensive cleaning and care of the cockpit/plastic surfaces throughout the interior, headliner cleaning, carpet and floor mat cleaning, leather seat and upholstery care (shampooing), refreshing of exterior plastic parts and tires',
  },
  {
    title: 'Complete NW',
    netPrice: 330,
    taxRate: 19,
    unitName: 'Stück',
    description:
      'Vacuuming of the interior and trunk, interior and exterior window cleaning, hand washing of the exterior, paint cleaning, wheel cleaning, vehicle sealing, vehicle polishing, hologram removal and polishing, cleaning of door sills and edges, intensive cleaning and care of the entire interior cockpit/plastic surfaces, headliner cleaning, carpet and floor mat cleaning, cleaning of exterior plastic parts and tires',
  },
  {
    title: 'Servicewäsche Basic',
    netPrice: 50,
    taxRate: 19,
    unitName: 'Stück',
    description: 'Schnelle Service Reinigung',
  },
  {
    title: 'Servicewäsche Plus',
    netPrice: 150,
    taxRate: 19,
    unitName: 'Stück',
    description: 'Innen / Außenreinigung',
  },
];

// Stable key for a package. Derived from the title rather than the Lexware id,
// so a vehicle's remembered "last package" still resolves if the fallback list
// is in use, or if the article is recreated in Lexware.
function slug(title) {
  return String(title || '')
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function matchKey(title) {
  return slug(title);
}

function normalizeArticle(a) {
  const price = a.price || {};
  const net =
    typeof price.netPrice === 'number'
      ? price.netPrice
      : typeof price.grossPrice === 'number' && typeof price.taxRate === 'number'
      ? price.grossPrice / (1 + price.taxRate / 100)
      : null;

  if (net === null) return null;

  return {
    key: slug(a.title),
    title: a.title,
    description: a.description || a.note || '',
    netPrice: Math.round(net * 100) / 100,
    taxRate: typeof price.taxRate === 'number' ? price.taxRate : config.taxRatePercentage,
    unitName: a.unitName || 'Stück',
    articleId: a.id || null,
    articleNumber: a.articleNumber || null,
    articleType: a.type || null,
    source: 'lexware',
  };
}

function fallbackPackages() {
  return FALLBACK.map((f) => ({
    key: slug(f.title),
    title: f.title,
    description: f.description,
    netPrice: f.netPrice,
    taxRate: f.taxRate,
    unitName: f.unitName,
    articleId: null,
    articleNumber: null,
    articleType: null,
    source: 'fallback',
  }));
}

// --- cache ---------------------------------------------------------------

let cache = { at: 0, packages: null, lastError: null, usedFallback: true };

function filterToAllowlist(packages) {
  const allow = config.packageAllowlist || [];
  if (!allow.length) return packages;

  // Keep the ORDER of the allowlist: that's the order staff see on screen, and
  // it should be the order you decided, not whatever Lexware returns.
  const byKey = new Map(packages.map((p) => [p.key, p]));
  const picked = [];
  const missing = [];
  allow.forEach((wanted) => {
    const hit = byKey.get(matchKey(wanted));
    if (hit) picked.push(hit);
    else missing.push(wanted);
  });

  if (missing.length) {
    console.warn(
      'These packages are listed in src/config.js but were not found in Lexware: ' +
        missing.join(', ') +
        '. Check the article titles match exactly (run: npm run articles).'
    );
  }
  return picked;
}

async function refresh() {
  const live = await lexware.listArticles();
  const normalized = live.map(normalizeArticle).filter(Boolean);
  const picked = filterToAllowlist(normalized);

  // An empty result means the allowlist matches nothing in Lexware. Falling
  // back is better than showing staff an empty screen they can't work with.
  if (!picked.length) {
    throw new Error('No matching articles found in Lexware');
  }

  cache = { at: Date.now(), packages: picked, lastError: null, usedFallback: false };
  return cache.packages;
}

// Returns the package list, refreshing in the background when stale. Never
// throws and never blocks invoicing: worst case staff get the fallback prices.
async function getPackages() {
  const fresh = cache.packages && Date.now() - cache.at < config.articleCacheMs;
  if (fresh) return cache.packages;

  try {
    return await refresh();
  } catch (e) {
    cache.lastError = e.detail || e.message;
    console.error('Could not load articles from Lexware:', cache.lastError);
    if (cache.packages) return cache.packages; // stale but real
    cache = { at: 0, packages: fallbackPackages(), lastError: cache.lastError, usedFallback: true };
    return cache.packages;
  }
}

async function findPackage(key) {
  const all = await getPackages();
  return all.find((p) => p.key === key) || null;
}

function status() {
  return {
    usedFallback: cache.usedFallback,
    lastError: cache.lastError,
    fetchedAt: cache.at ? new Date(cache.at).toISOString() : null,
    count: cache.packages ? cache.packages.length : 0,
  };
}

module.exports = { getPackages, findPackage, refresh, status, slug, fallbackPackages, FALLBACK };
