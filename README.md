# Garage Invoice App

One shared screen, built for a phone in a workshop. A worker types the license
plate; if the car has been in before, the customer name, company and last
service fill themselves in. Otherwise they pick a company and type the name
once. Either way: pick a package, tap **Create Invoice**, and the app creates
the invoice in Lexware (formerly lexoffice) and emails the PDF — no Lexware
login for staff, ever.

Three companies are set up out of the box: **Lamborghini / McLaren**,
**Ferrari**, and **Bentley**. Picking one recolors the whole screen, so a wrong
brand color is a visible warning that you're about to invoice the wrong company.

**Prices are not stored in this repo.** The service packages staff pick are the
products (*Artikel*) in your Lexware account, fetched over the API. Change a
price in Lexware and the app follows within ten minutes — no edit here, no
redeploy.

## 1. Get a Lexware API key

1. Log in at <https://app.lexware.de>
2. Go to <https://app.lexware.de/addons/public-api>
3. Create an API key and copy it

## 2. Configure

```bash
cp .env.example .env
```

Open `.env` and fill in:

- `LEXWARE_API_KEY` — the key from step 1
- `LAMBO_MCLAREN_BILLING_EMAIL`, `FERRARI_BILLING_EMAIL`,
  `BENTLEY_BILLING_EMAIL` — where each company's invoices go
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`,
  `SMTP_FROM` — any mailbox you can send from (a normal Gmail/Outlook/company
  mailbox works; for Gmail use an
  [app password](https://support.google.com/accounts/answer/185833), not your
  normal password)

**To change a price**, change it in Lexware. Nothing here needs touching.

**To change which packages staff can pick**, edit `packageAllowlist` in
`src/config.js` — a list of product titles, in the order they appear on screen.
An empty list means "offer every product in my Lexware account". To give one
company a different menu, add a `packages: [...]` list to that company.

**To change companies**, edit the `companies` block in `src/config.js`.
If you add a company there, give it a brand color by adding a
`[data-brand="yourkey"]` block in `public/index.html`; unlisted keys fall back
to red.

**Never commit `.env`.** It is already in `.gitignore` — keep it that way, and
put the real values in your hosting provider's environment-variable settings
instead.

## 3. Run it locally to test

```bash
npm install
npm start
```

Open <http://localhost:3000> and create a test invoice. Check that it shows up
in your Lexware voucher list and that the email arrives.

## 4. What Lexware/lexoffice can and can't do here

This is the part worth understanding before you change anything, because it
drives the whole design.

**What Lexware stores:** contacts, **products/services (*Artikel*)**, invoices,
credit notes, and the other billing documents. A contact has a name, addresses,
email addresses, phone numbers and a free-text note. A product has a title,
description, unit, tax rate and a price.

**What Lexware does not have:** any concept of a *vehicle*. There is no car
entity, no license-plate field, and **no custom/user-defined fields on
contacts**. So there is nowhere in Lexware to record "plate M-AB 1234 belongs
to Max Mustermann", and no way to ask its API "which customer owns this
plate?".

That is why the plate lookup is served by a small registry the app keeps
itself (`vehicles.json`), and why that file is the one thing you must not lose.

### What the app does use the Lexware API for

| Call | When | Why |
| --- | --- | --- |
| `GET /articles` | every 10 minutes | the service packages and their prices |
| `GET /contacts?name=…` | before creating a company contact | so a redeploy can't create a second "Ferrari Dealer" |
| `POST /contacts` | only if the search found nothing | first-ever invoice for that company |
| `POST /invoices?finalize=true` | every invoice | creates and finalizes it |
| `GET /invoices/{id}` | every invoice | read back the real voucher number |
| `GET /invoices/{id}/file` | every invoice | download the PDF to email |

Requests are spaced out automatically, because the Lexware API allows only
about **2 requests per second** per key and one invoice costs several calls.

### What you need to do in Lexware

Honestly: **almost nothing.** That's the point of this setup.

1. **Create the API key** (section 1 above). That's the only mandatory step.
1. **Keep your service packages as products in Lexware.** They already are —
   that's where the app reads them from. When you add, rename or reprice one,
   add its title to `packageAllowlist` in `src/config.js` if staff should be
   able to pick it. Run `npm run articles` to print what your account has and
   which allowlist entries matched:

   ```
   npm run articles
   ```

   Titles are matched ignoring case, spaces and punctuation, but the wording
   must otherwise be identical — this script is how you catch a mismatch before
   your staff do.
2. **Don't pre-create the three dealer contacts by hand.** The app creates each
   one the first time you invoice it, and from then on looks it up by name. If
   you create them manually, make the name match `contactName` in
   `src/config.js` *exactly* — otherwise the app won't recognise yours and will
   make its own alongside it.
3. **Check your invoice numbering and VAT settings** in Lexware once, because
   the app takes whatever Lexware is configured to do. Each product's own VAT
   rate is used; the `taxRatePercentage` in `src/config.js` is only a fallback
   for a product that somehow has none.
4. **Don't add the car owners as Lexware contacts.** The invoice is addressed
   to the dealer who pays; the owner's name and plate are printed on the
   invoice as text. Adding one contact per car would bloat your contact list
   for no benefit.

If you ever *do* want the car owners in Lexware as real contacts, the app
already has the hook: `GET /api/contacts?q=…` searches Lexware contacts by
name and the vehicle record has a `lexwareContactId` field ready for it.

### If Lexware can't be reached

The app keeps a built-in copy of the five packages and their prices. If the
API is down or the key is missing, staff see those instead of an empty screen,
with an amber warning saying the prices are not live. Invoicing still works.
Once a fetch succeeds, the live list takes over.

### Linking invoice lines to the product (optional)

By default each invoice line is written as free text carrying the product's
title, description and price. That always works.

Setting `LEXWARE_LINK_ARTICLES=true` instead puts the Lexware **article id** on
the line, which gives you revenue-per-product reporting in Lexware. It's off by
default because the exact payload can't be verified without sending a real
invoice from your account. Turn it on, send **one test invoice**, check it looks
right in Lexware, and keep it on only if it does.

## 5. Duplicate prevention

Two different duplicates can happen, and they're prevented in two different
places.

**Duplicate vehicles/customers.** Every plate is normalized before it is used
as a key: upper-cased with spaces, hyphens and dots stripped, so `M-AB 1234`,
`m ab1234` and `MAB-1234` are all the same car and can only ever produce one
record. On top of that:

- Typing a plate that's already on file loads that car instead of starting a
  new one.
- A plate that *nearly* matches one on file offers the close matches
  ("similar plates already on file — tap one if it is the same car"), so a
  typo doesn't quietly create a twin.
- If a known plate is submitted under a **different customer name or a
  different company**, the app refuses the invoice and asks which is right —
  saved details, or what was typed. Nothing is overwritten without an answer,
  and no invoice is created while the question is open. A change of owner is a
  real thing; so is a typo, and only a human can tell them apart.

**Duplicate Lexware contacts.** The app used to rely purely on a local cache
file, which meant a host that wipes its disk on redeploy would silently create
a second "Ferrari Dealer". Now the cache is only a shortcut: when it's empty,
the app searches Lexware by name first and reuses the existing contact.

## 6. Deploy it cheaply

This is a small Node server, so it needs somewhere that can run Node and hold
your secrets — it can't go on a purely static host like GitHub Pages, because
the Lexware API key must never reach the browser.

Traffic here is tiny (a handful of invoices a day), so the cheapest tiers are
plenty. In rough order of cost:

| Option | Cost | Trade-off |
| --- | --- | --- |
| **Render**, free web service | Free | Sleeps after ~15 min idle; first request after a nap takes ~30–60s |
| **Fly.io**, one small machine | A few € / month | Can auto-stop when idle, so you pay close to nothing |
| **Railway** | A few € / month | Simplest setup, always awake |
| **A VPS you already own** | € 0 extra | You manage Node, restarts, and TLS yourself |

Prices and free tiers change — check the provider before committing.

The steps are the same everywhere:

1. Push this repo to GitHub (private is fine)
2. Create a new Web Service / App and point it at the repo
3. Build command `npm install`, start command `npm start`
4. Add every variable from your `.env` file in the provider's environment
   settings
5. Open the URL it gives you

Then bookmark that URL on the tablet/phone in the garage, or turn it into a
home-screen icon (Share → Add to Home Screen on iOS/Android) so it opens like
an app.

### You need a persistent disk — this is not optional any more

Everything the app must remember lives in one directory, set by `DATA_DIR`
(default `./data`):

- `vehicles.json` — the plate registry. **Losing this loses every car**, and
  the next visit from a known customer starts over as a new one.
- `contacts.json` — a cache of the Lexware contact ids (recoverable: the app
  re-finds them via the API).

**Render's free tier and Railway without a volume both reset the disk on every
deploy and restart.** Before the plate lookup existed that was merely untidy;
now it would wipe your customer history. So:

1. Add a small persistent disk / volume in your host's settings (about €1 a
   month on most; Fly.io's smallest volume is free at the time of writing)
2. Mount it at, say, `/data`
3. Set the environment variable `DATA_DIR=/data`

Then back it up occasionally — it is a single small JSON file, so copying it
somewhere safe now and then is enough.

### Anyone with the URL can create invoices

There is no login. The address is unguessable, but it is not secret — treat it
like a key. If the app will be reachable from outside the garage, put a simple
password in front of it (HTTP basic auth, or your host's built-in access
protection) before you share the link.

## How it works

```
Worker (phone/tablet)
   │  1. types the license plate
   ▼
This web app ──► vehicles.json : known plate?
   │                 │
   │                 ├─ yes ─► fills in customer, company, last service
   │                 └─ no  ─► worker picks company + types the name once
   │
   │  2. worker picks a package (only that company's packages/prices)
   │  3. taps Create Invoice
   ▼
   ├─► Lexware API: find (or create) the company contact
   ├─► Lexware API: create + finalize the invoice
   ├─► Lexware API: download the invoice PDF
   ├─► SMTP: email the PDF to the company's billing address
   └─► vehicles.json: record the visit against the plate
```

The customer name and license plate are written straight onto the invoice as
text, so car owners don't need to exist in Lexware at all. Only the companies
you actually bill are Lexware contacts, because that's where the recurring
billing relationship is.

## Project layout

| File | What's in it |
| --- | --- |
| `src/config.js` | companies, and which Lexware products staff may pick |
| `src/articles.js` | fetches the packages/prices from Lexware, caches, falls back |
| `scripts/list-articles.js` | `npm run articles` — check your titles match |
| `src/plates.js` | plate normalization; the basis of duplicate detection |
| `src/store.js` | the vehicle registry (plate → customer, company, history) |
| `src/lexware.js` | Lexware API calls, contact dedupe, rate limiting |
| `src/mailer.js` | sending the invoice PDF over SMTP |
| `server.js` | HTTP endpoints and the invoice flow |
| `public/index.html` | the whole mobile UI, no build step |

## Troubleshooting

- **"LEXWARE_API_KEY is not set"** — check `.env` (locally) or your hosting
  provider's environment variables (in production).
- **Invoice created but no email** — check the SMTP credentials; the invoice is
  still safely saved in Lexware either way (the app says so in an amber
  "Invoice created" message).
- **Wrong price for a package** — change it in Lexware; the app picks it up
  within ten minutes (restart to apply immediately).
- **A package is missing from the app** — its title in `packageAllowlist`
  doesn't match the product in Lexware. Run `npm run articles` to see which.
- **Amber "prices could not be loaded from Lexware"** — the app is showing its
  built-in fallback prices. Check `LEXWARE_API_KEY` and that the account's plan
  includes API access.
- **Known cars have been forgotten after a deploy** — `DATA_DIR` isn't on a
  persistent volume. See "You need a persistent disk" above.
- **Duplicate contacts in Lexware** — if two already exist from before, delete
  the unused one in Lexware and the app will settle on the survivor.
- **"This plate is already on file"** — working as intended: the car is known
  under a different name or company. Pick whichever is correct.
- **Lookup says "Lookup failed"** — the app is unreachable or the registry is
  unreadable; the worker can still type everything by hand and invoice.
