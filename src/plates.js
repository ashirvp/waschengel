// License plates are typed by hand on a phone, in a hurry, by different people.
// "M-AB 1234", "m ab1234" and "MAB-1234" are the same car, so every lookup and
// every duplicate check goes through normalizePlate() — the normalized form is
// the only thing we ever use as a key.

// Keep German umlauts: some plates legitimately contain Ä/Ö/Ü.
function normalizePlate(raw) {
  return String(raw == null ? '' : raw)
    .toUpperCase()
    .replace(/[^A-Z0-9ÄÖÜ]/g, '');
}

// What we show back to the worker: their own spacing, just tidied and upper-cased.
// We deliberately don't reformat into a canonical "M-AB 1234" shape, because
// foreign plates don't follow the German pattern and guessing looks broken.
function displayPlate(raw) {
  return String(raw == null ? '' : raw)
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}

// Loose on purpose. A garage sees Swiss, Austrian and dealer plates too, so we
// only reject input that can't be a plate at all rather than enforcing a format.
function isPlausiblePlate(raw) {
  const key = normalizePlate(raw);
  return key.length >= 2 && key.length <= 15;
}

module.exports = { normalizePlate, displayPlate, isPlausiblePlate };
