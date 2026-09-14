// Vehicle registry: license plate -> customer, company, and service history.
//
// WHY THIS EXISTS AND ISN'T IN LEXWARE:
// The Lexware/lexoffice API has no vehicle entity and no custom fields on
// contacts, so there is nowhere in Lexware to record "this plate belongs to
// this customer". The registry therefore lives here. It is small (one row per
// car) and stored as a single JSON file so there is no database to pay for.
//
// IMPORTANT: this file must survive restarts. On a host with an ephemeral
// filesystem, point DATA_DIR at a mounted volume — see the README.

const fs = require('fs');
const path = require('path');
const config = require('./config');
const { normalizePlate, displayPlate } = require('./plates');

const FILE = config.vehicleFile;
const MAX_HISTORY = 20;

let db = null;

function load() {
  if (db) return db;
  try {
    const parsed = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    db = parsed && parsed.vehicles ? parsed : { version: 1, vehicles: {} };
  } catch {
    // Missing or unreadable file just means "no vehicles known yet".
    db = { version: 1, vehicles: {} };
  }
  return db;
}

// Writes are serialized through this chain. Two workers tapping Create at the
// same moment would otherwise interleave read-modify-write and lose one record.
let writeChain = Promise.resolve();

function persist() {
  const snapshot = JSON.stringify(load(), null, 2);
  writeChain = writeChain.then(
    () =>
      new Promise((resolve) => {
        try {
          fs.mkdirSync(path.dirname(FILE), { recursive: true });
          // Write-then-rename, so a crash mid-write can't truncate the registry.
          const tmp = `${FILE}.${process.pid}.tmp`;
          fs.writeFileSync(tmp, snapshot);
          fs.renameSync(tmp, FILE);
        } catch (e) {
          console.error('Could not save the vehicle registry:', e.message);
        }
        resolve();
      })
  );
  return writeChain;
}

function findByPlate(plate) {
  const key = normalizePlate(plate);
  if (!key) return null;
  return load().vehicles[key] || null;
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
  const store = load();
  const existing = store.vehicles[key];

  const vehicle = existing || {
    plateKey: key,
    createdAt: now,
    visits: 0,
    history: [],
  };

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

  store.vehicles[key] = vehicle;
  await persist();
  return vehicle;
}

// Type-ahead over plates already on file, so a worker who half-remembers a
// plate can find the car instead of creating a near-duplicate record.
function searchVehicles(query, limit = 8) {
  const key = normalizePlate(query);
  if (key.length < 2) return [];
  return Object.values(load().vehicles)
    .filter((v) => v.plateKey.includes(key))
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
    .slice(0, limit);
}

function recentVehicles(limit = 6) {
  return Object.values(load().vehicles)
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
    .slice(0, limit);
}

function stats() {
  const all = Object.values(load().vehicles);
  return { vehicles: all.length, visits: all.reduce((n, v) => n + (v.visits || 0), 0) };
}

module.exports = {
  findByPlate,
  recordVisit,
  searchVehicles,
  recentVehicles,
  stats,
  _reset: () => {
    db = null;
  },
};
