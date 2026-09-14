// The vehicle number is the only per-job detail, and it goes onto the invoice
// as text. Nothing is stored, so this is just tidy-up and a sanity check.

// Workers type in a hurry on a phone; show the plate back in a clean form.
function displayPlate(raw) {
  return String(raw == null ? '' : raw)
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}

// Loose on purpose. A garage sees Swiss, Austrian and dealer plates too, so we
// only reject input that can't be a plate at all rather than enforcing a format.
function isPlausiblePlate(raw) {
  const bare = String(raw == null ? '' : raw).replace(/[^A-Za-z0-9ÄÖÜäöü]/g, '');
  return bare.length >= 2 && bare.length <= 15;
}

module.exports = { displayPlate, isPlausiblePlate };
