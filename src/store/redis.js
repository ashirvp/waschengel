// Vehicle registry in Redis, over Upstash's HTTP API.
//
// This exists for serverless hosts (Vercel, Lambda, Netlify), where there is no
// disk that survives a request. HTTP rather than a TCP client matters there:
// serverless functions can't keep a connection pool alive between invocations.
//
// One Redis hash, one field per car. Per-field writes mean two invoices saved
// at the same moment can't overwrite each other's car, which a single
// whole-registry JSON blob would.

const { normalizePlate } = require('../plates');

const HASH = process.env.REDIS_VEHICLE_KEY || 'garage:vehicles';

function credentials() {
  // Vercel KV and Upstash set differently-named variables for the same thing.
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url: url.replace(/\/+$/, ''), token } : null;
}

function isConfigured() {
  return credentials() !== null;
}

async function command(args) {
  const creds = credentials();
  if (!creds) throw new Error('Redis is not configured');

  const res = await fetch(creds.url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${creds.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Redis ${res.status} ${res.statusText}${body ? ': ' + body.slice(0, 200) : ''}`);
  }
  const data = await res.json();
  if (data.error) throw new Error(`Redis: ${data.error}`);
  return data.result;
}

function parse(raw) {
  if (raw === null || raw === undefined) return null;
  try {
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    return null;
  }
}

module.exports = {
  name: 'redis',
  isConfigured,
  describe: () => {
    const c = credentials();
    // Host only — the token must never reach a log or a report.
    let host = 'configured';
    try { host = new URL(c.url).host; } catch { /* keep the fallback */ }
    return `Redis hash "${HASH}" at ${host}`;
  },

  async findByPlate(plate) {
    const key = normalizePlate(plate);
    if (!key) return null;
    return parse(await command(['HGET', HASH, key]));
  },

  async putVehicle(key, vehicle) {
    await command(['HSET', HASH, key, JSON.stringify(vehicle)]);
    return vehicle;
  },

  async allVehicles() {
    // HGETALL returns a flat [field, value, field, value, ...] array.
    const flat = await command(['HGETALL', HASH]);
    if (!Array.isArray(flat)) {
      // Some gateways return an object instead; handle both.
      return Object.values(flat || {}).map(parse).filter(Boolean);
    }
    const out = [];
    for (let i = 1; i < flat.length; i += 2) {
      const v = parse(flat[i]);
      if (v) out.push(v);
    }
    return out;
  },

  async ping() {
    return command(['PING']);
  },
};
