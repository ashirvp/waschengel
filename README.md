# Garage Invoice App

One screen, three taps. A worker types the vehicle number, taps the company,
taps the service package — the app creates the invoice in Lexware (formerly
lexoffice) and emails it automatically. No Lexware login for staff, ever.

```
Vehicle number  ->  Company  ->  Package  ->  invoice created + emailed
```

**The app stores nothing.** There is no database, no customer records, no
vehicle history, no files on disk. The vehicle number is written onto the
invoice and exists nowhere else. That means nothing to back up, nothing to lose
on a redeploy, and the app runs anywhere — including serverless hosts like
Vercel.

Each company maps to the **real customer in your Lexware account** that gets
billed, and the app uses that customer's own address, payment terms and email:

| Staff tap | Invoice is addressed to |
| --- | --- |
| Ferrari | Scuderia Feser-Graf GmbH |
| Lamborghini / McLaren | Feser Sportwagen GmbH |
| Bentley | Feser- Graf Exclusive Cars GmbH |

**Each company has its own service packages**, listed in `src/config.js`.
Prices come from your Lexware products, so changing a price in Lexware is
enough — no edit here, no redeploy.

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
- `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS` — the mailbox the invoice email is
  sent from. Use the address on your letterhead (`info@waschengel.info`) so the
  email and the invoice match. `SMTP_PORT` (587), `SMTP_SECURE` (false) and
  `SMTP_FROM` (same as `SMTP_USER`) have defaults and can be left out (a normal Gmail/Outlook/company
  mailbox works; for Gmail use an
  [app password](https://support.google.com/accounts/answer/185833), not your
  normal password)
- `LAMBO_MCLAREN_BILLING_EMAIL`, `FERRARI_BILLING_EMAIL`,
  `BENTLEY_BILLING_EMAIL` — **optional.** Leave empty and each invoice goes to
  the email on that customer's record in Lexware, which is what you normally
  want. Set one only to redirect a company's invoices elsewhere.

**To change a price**, change it in Lexware. Nothing here needs touching.

**To change which packages a company offers**, edit that company's `packages`
list in `src/config.js`. Each company has its own, and the order there is the
order on screen:

```js
ferrari: {
  label: 'Ferrari',
  contactName: 'Scuderia Feser-Graf GmbH',
  packages: [
    'Komplett Ferrari NW',
    'Komplett GW',
    ...
  ],
},
```

A service that costs a different amount for a different company is simply its
own product in Lexware (which is why `Komplett Ferrari NW` is separate from
`Komplett NW`) — list it under the company it belongs to. Run
`npm run articles` to see exactly what your account has.

**Never commit `.env`.** It is in `.gitignore`; keep it there, and put the real
values in your hosting provider's environment settings.

## 3. Check the setup

One command checks everything — the API key, the three customers, the products,
the email login, and that every company resolves to its Lexware customer:

```bash
npm run doctor
```

It prints a report with a PASS/PROBLEM line per check and a summary of what's
still broken. **It never prints your API key or SMTP password**, so the output
is safe to paste into a chat or an email when you need help.

### Without a terminal

The checks have to run where the app runs, because that's what has network
access to Lexware. So the deployed app can show the same report in a browser:

1. Set `ADMIN_TOKEN` in your hosting provider's environment settings to a long
   random value
2. Open `https://your-app-url/admin?token=THAT_VALUE` on your phone
3. Tap **Copy report as text** if you need to send it to someone

The page is **disabled unless `ADMIN_TOKEN` is set**, and a wrong token gets a
403. Keep the token secret: the report shows your customer names, their email
addresses and your Lexware account name. It never shows your API key or SMTP
password.

Two narrower commands do one job each:

```bash
npm run contacts   # which Lexware customer each brand bills, and its email
npm run articles   # your products, and which ones staff will be offered
```

## 4. Run it locally to test

```bash
npm install
npm start
```

Open <http://localhost:3000> and create a test invoice. Check that it shows up
in your Lexware voucher list and that the email arrives.

## 5. What Lexware/lexoffice can and can't do here

This is the part worth understanding before you change anything, because it
drives the whole design.

**What Lexware stores:** contacts, **products/services (*Artikel*)**, invoices,
credit notes, and the other billing documents. A contact has a name, addresses,
email addresses, phone numbers and a free-text note. A product has a title,
description, unit, tax rate and a price.

**What Lexware does not have:** any concept of a *vehicle*. There is no car
entity and no custom fields on contacts, so a vehicle number can't be stored as
structured data there — which is fine, because this app doesn't store it at
all. It goes onto the invoice as text, which is where you'd look for it anyway.

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
2. **Make sure the three dealer customers exist and are complete.** These are
   the real customers the invoices are addressed to:

   - Scuderia Feser-Graf GmbH
   - Feser Sportwagen GmbH
   - Feser- Graf Exclusive Cars GmbH

   The spelling must match the customer record exactly — punctuation included.
   Two of these carry hyphens that are easy to miss, and one has a space after
   the hyphen. `npm run contacts` is the check.

   Each needs its address, VAT id, payment terms and a **business email
   address** filled in, because the app takes all of that from Lexware. The app
   looks them up by name and **will not create them**: if a name doesn't match,
   it refuses to invoice and says so, rather than inventing a bare duplicate
   with no address on a real invoice. Check with:

   ```
   npm run contacts
   ```

   This prints which Lexware customer each brand resolves to and the email its
   invoices will go to. Run it after any rename, on either side.
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

## 6. What happens when something is wrong

The app refuses rather than guessing, and says why on screen:

- **A company's customer isn't found in Lexware** (or two customers share the
  name) — invoicing that company is blocked, and the company panel turns red
  before anyone taps anything. `contactName` in `src/config.js` must match the
  customer in Lexware exactly, punctuation included. The app never creates a customer: a bare
  stand-in with no address on a real invoice is worse than an error.
- **A customer has no email on file** — blocked with that specific reason,
  rather than creating an invoice nobody receives.
- **A package isn't on that company's list** — rejected, so Bentley can't be
  billed for a Ferrari-only product.
- **Prices can't be loaded from Lexware** — staff see a built-in fallback list
  with an amber warning that the prices aren't live.
- **The invoice is created but the email fails** — the screen says exactly
  that. The invoice is safe in Lexware; only the email needs redoing.

## 7. Deploy it cheaply

### Deploying to Vercel

Vercel needs `api/index.js` and `vercel.json`, both already in this repo:
Vercel doesn't run `npm start`, it imports a handler. Without them it would
serve `public/index.html` as a static page and 404 every `/api/` call — the
screen would appear and nothing on it would work.

Beyond that, just set the environment variables (`LEXWARE_API_KEY`, the
`SMTP_*` values, `ADMIN_TOKEN`) in the Vercel project settings and deploy.
Because the app stores nothing, there is no database or volume to add.

### Other hosts

Fly.io, Render, Railway or a VPS all work with `npm install` and `npm start`.
Nothing to mount, nothing to back up.

This app can't go on a purely static host like GitHub Pages, because the
Lexware API key must never reach the browser.

### Anyone with the URL can create invoices

There is no login. The address is unguessable, but it is not secret — treat it
like a key. If the app will be reachable from outside the garage, put a simple
password in front of it (HTTP basic auth, or your host's built-in access
protection) before you share the link.

## How it works

```
Worker (phone/tablet)
   │  types the vehicle number
   │  taps the company
   │  taps a package   (only that company's packages and prices)
   │  taps Create & Send
   ▼
This web app (Node/Express, stateless)
   │
   ├─► Lexware API: find the company's customer record (never creates one)
   ├─► Lexware API: create + finalize the invoice, vehicle number on the line
   ├─► Lexware API: download the invoice PDF
   └─► SMTP: email the PDF to that customer's address from Lexware
```

The vehicle number is written onto the invoice as text and kept nowhere else,
so no customer or vehicle database is needed. Only the three dealer companies
are Lexware customers, because that's where the recurring billing relationship
is.

## Project layout

| File | What's in it |
| --- | --- |
| `src/config.js` | companies, their Lexware customer, and their packages |
| `src/app.js` | the Express app and all its routes |
| `server.js` | starts the app on a normal host |
| `api/index.js` | the same app, as a Vercel/serverless handler |
| `src/articles.js` | fetches packages/prices from Lexware, caches, falls back |
| `src/contacts.js` | resolves each company to its real Lexware customer |
| `src/lexware.js` | Lexware API calls and rate limiting |
| `src/mailer.js` | the German invoice email and your letterhead signature |
| `src/plates.js` | tidying the vehicle number for the invoice |
| `src/checks.js` | the setup checks, shared by `npm run doctor` and `/admin` |
| `public/index.html` | the whole mobile UI, no build step |

## The invoice email

The email is German, since the recipients are German dealerships and the
attached invoice is a German document:

```
From:    Waschengel GmbH <info@waschengel.info>
Subject: Rechnung RE-2026-0001 – Fahrzeug M-AB 1234

Guten Tag,

anbei erhalten Sie unsere Rechnung RE-2026-0001 für das Fahrzeug M-AB 1234.

Mit freundlichen Grüßen
Waschengel GmbH
--
Waschengel GmbH
Äußere Sulzbacher Straße 23
90491 Nürnberg
...
```

The signature comes from the `business` block in `src/config.js`, which should
match your Lexware letterhead. Every field can be overridden with a
`BUSINESS_*` environment variable.

**Lexware itself does not send the email.** Its public API creates the invoice
and gives you the PDF, but has no endpoint to mail a document, so this app does
the sending. That means `SMTP_FROM` decides what the dealer sees as the sender
— set it to the address on your letterhead.

## Security

- **Never commit `.env`.** It is in `.gitignore`; keep it there. Put the real
  values in your hosting provider's environment settings.
- **This repository is public.** Anything committed here is world-readable and
  stays in the git history even after you delete it. Automated scanners find
  committed API keys within minutes, so a key that lands in a commit must be
  treated as compromised and rotated, not just removed.
- **If a key is ever exposed**, revoke it at
  <https://app.lexware.de/addons/public-api> and issue a new one. A Lexware key
  can read and write your invoices and customer data.
- **The app has no login** — see the note above.
- **`/admin` is off by default.** It only works when `ADMIN_TOKEN` is set, and
  it exposes customer names and emails, so treat the token like a password.

## Troubleshooting

- **"LEXWARE_API_KEY is not set"** — check `.env` (locally) or your hosting
  provider's environment variables (in production).
- **Invoice created but no email** — check the SMTP credentials; the invoice is
  still safely saved in Lexware either way (the app says so in an amber
  "Invoice created" message).
- **Wrong price for a package** — change it in Lexware; the app picks it up
  within ten minutes (restart to apply immediately).
- **A package is missing from the app** — its title in that company's
  `packages` list doesn't match the product in Lexware. Run `npm run articles`
  to see which.
- **"Could not find the Lexware customer for …"** — `contactName` in
  `src/config.js` doesn't match a customer in Lexware. Run `npm run contacts`;
  the message also lists the closest names it found.
- **"Lexware has 2 customers named …"** — two customer records share that name.
  Archive or rename one; the app won't guess which to bill.
- **"No email address for … in Lexware"** — that customer has no business email
  on file. Add one in Lexware, or set the company's billing-email override
  in `.env`.
- **The app shows "Customer not found in Lexware" under a company** — same
  cause; staff should not invoice that company until it's fixed.
- **Amber "prices could not be loaded from Lexware"** — the app is showing its
  built-in fallback prices. Check `LEXWARE_API_KEY` and that the account's plan
  includes API access.
- **Anything at all** — run `npm run doctor` first; it checks every one of the
  causes below in one go.
