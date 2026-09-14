// Vehicle registry: license plate -> customer, company, and service history.
//
// WHY THIS EXISTS AND ISN'T IN LEXWARE:
// The Lexware/lexoffice API has no vehicle entity and no custom fields on
// contacts, so there is nowhere in Lexware to record "this plate belongs to
// this customer". The registry therefore lives here.
//
// WHERE IT IS KEPT:
// Redis when KV_REST_API_URL / UPSTASH_REDIS_REST_URL is set (required on
// serverless hosts, which have no disk that survives a request), otherwise a
// JSON file under DATA_DIR. The driver is chosen automatically.

const redis = require('./redis');
const file = require('./file');
const { normalizePlate, displayPlate } = require('../plates');

const MAX_HISTORY = 20;

const driver = redis.isConfigured() ? redis : file;

function isServerless() {
  return Boolean(
    process.env.VERCEL ||
      process.env.AWS_LAMBDA_FUNCTION_NAME ||
      process.env.NETLIFY ||
      process.env.K_SERVICE
  );
}

// Say this loudly at startup rather than letting a garage discover months later
// that no car was ever remembered.
if (driver === file && isServerless()) {
  console.warn(
    'WARNING: running on a serverless host with no Redis configured. The vehicle\n' +
      'registry cannot persist here — every car will be forgotten between requests.\n' +
      'Set KV_REST_API_URL and KV_REST_API_TOKEN (or the UPSTASH_ equivalents).'
  );
}

async function findByPlate(plate) {
  return driver.findByPlate(plate);
}

// Called after an invoice succeeds. Keyed on the normalized plate, so the same
// car can never produce a second record no matter how the plate was typed.
async function recordVisit({
  plate,
  customerName,
  companyKey,
  packageKey,
  voucherNumber,
  invoiceId,
  lexwareContactId,
}) {
  const key = normalizePlate(plate);
  if (!key) return null;

  const now = new Date().toISOString();
  const existing = await driver.findByPlate(plate);

  const vehicle = existing || { plateKey: key, createdAt: now, visits: 0, history: [] };

  vehicle.plate = displayPlate(plate);
  vehicle.customerName = customerName;
  vehicle.companyKey = companyKey;
  vehicle.lastPackageKey = packageKey;
  vehicle.updatedAt = now;
  vehicle.visits = (vehicle.visits || 0) + 1;
  if (lexwareContactId) vehicle.lexwareContactId = lexwareContactId;

  vehicle.history = [
    { at: now, packageKey, voucherNumber, invoiceId },
    ...(vehicle.history || []),
  ].slice(0, MAX_HISTORY);

  await driver.putVehicle(key, vehicle);
  return vehicle;
}

// Type-ahead over plates already on file, so a worker who half-remembers a
// plate can find the car instead of creating a near-duplicate record.
async function searchVehicles(query, limit = 8) {
  const key = normalizePlate(query);
  if (key.length < 2) return [];
  const all = await driver.allVehicles();
  return all
    .filter((v) => v && v.plateKey && v.plateKey.includes(key))
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
    .slice(0, limit);
}

async function recentVehicles(limit = 6) {
  const all = await driver.allVehicles();
  return all
    .filter(Boolean)
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
    .slice(0, limit);
}

async function stats() {
  const all = await driver.allVehicles();
  return {
    vehicles: all.length,
    visits: all.reduce((n, v) => n + ((v && v.visits) || 0), 0),
  };
}

// For `npm run doctor` and /admin.
function describe() {
  return {
    driver: driver.name,
    detail: driver.describe(),
    serverless: isServerless(),
    // A file driver on a serverless host is the silent-data-loss case.
    persistent: driver.name === 'redis' || !isServerless(),
  };
}

async function healthcheck() {
  if (driver.name === 'redis') {
    await driver.ping();
    return 'Redis responded to PING';
  }
  await driver.allVehicles();
  return 'Registry file is readable';
}

module.exports = {
  findByPlate,
  recordVisit,
  searchVehicles,
  recentVehicles,
  stats,
  describe,
  healthcheck,
  _reset: () => file._reset(),
};
