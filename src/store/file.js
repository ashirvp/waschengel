// Vehicle registry on the local filesystem. The right choice on any host with
// a real disk (Fly.io with a volume, Render with a disk, a VPS).

const fs = require('fs');
const path = require('path');
const config = require('../config');
const { normalizePlate, displayPlate } = require('../plates');

const FILE = config.vehicleFile;
let db = null;

function load() {
  if (db) return db;
  try {
    const parsed = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    db = parsed && parsed.vehicles ? parsed : { version: 1, vehicles: {} };
  } catch {
    db = { version: 1, vehicles: {} };
  }
  return db;
}

// Writes are serialized: two workers tapping Create at the same moment would
// otherwise interleave read-modify-write and lose one record.
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

module.exports = {
  name: 'file',
  describe: () => `JSON file at ${FILE}`,

  async findByPlate(plate) {
    const key = normalizePlate(plate);
    return key ? load().vehicles[key] || null : null;
  },

  async putVehicle(key, vehicle) {
    load().vehicles[key] = vehicle;
    await persist();
    return vehicle;
  },

  async allVehicles() {
    return Object.values(load().vehicles);
  },

  _reset: () => { db = null; },
};
