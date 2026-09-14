# Garage Invoice App

One shared screen. Staff pick the customer company, type the customer name and
license plate, pick a service package, then tap **Create Invoice**. The app
creates the invoice in Lexware (formerly lexoffice) and emails the PDF — no
Lexware login for staff, ever.

Three companies are set up out of the box: **Lamborghini / McLaren**,
**Ferrari**, and **Bentley**, each with its own prices and its own billing
email address. Picking a company recolors the whole screen, so a wrong brand
color is a visible warning that you're about to invoice the wrong company.

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

To change companies, service packages, or prices later, edit `src/config.js` —
that file is the single source of truth, and the form rebuilds itself from it.
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

## 4. Deploy it cheaply

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

### Important if you deploy on a free or ephemeral tier

The first invoice for each company creates a Lexware contact automatically and
remembers its ID in `data/contacts.json`, so later invoices reuse the same
contact instead of creating duplicates.

On hosts with an ephemeral filesystem — **Render's free tier and Railway
without a volume both reset the disk on every deploy and restart** — that file
disappears, and the next invoice creates a *second* "Ferrari Dealer" contact in
Lexware. Over months you get a pile of duplicates.

Three ways to deal with it, cheapest first:

- Accept it and tidy up the duplicate contacts in Lexware occasionally
- Attach a small persistent disk/volume mounted at `data/` (a paid option on
  most hosts, usually about €1/month)
- Change `getOrCreateCompanyContact` in `src/lexware.js` to look the contact up
  by name through the Lexware API instead of trusting the local file — no disk
  needed at all

### Anyone with the URL can create invoices

There is no login. The address is unguessable, but it is not secret — treat it
like a key. If the app will be reachable from outside the garage, put a simple
password in front of it (HTTP basic auth, or your host's built-in access
protection) before you share the link.

## How it works

```
Employee (phone/tablet)
   │  fills in: company, customer name, plate, package
   ▼
This web app (Node/Express)
   │
   ├─► Lexware API: find/create company contact → create + finalize invoice
   ├─► Lexware API: download the invoice PDF
   └─► SMTP: email the PDF to the company's billing address
```

No customer database is needed because the customer name and license plate are
written straight onto the invoice as text — they don't need to exist as
separate Lexware contacts. Only the three companies are set up as contacts,
since that's what the recurring billing relationship is with.

## Troubleshooting

- **"LEXWARE_API_KEY is not set"** — check `.env` (locally) or your hosting
  provider's environment variables (in production).
- **Invoice created but no email** — check the SMTP credentials; the invoice is
  still safely saved in Lexware either way (the app says so in an amber
  "Invoice created" message).
- **Wrong price for a package** — edit `netPrice` in `src/config.js`, redeploy.
- **Duplicate contacts in Lexware** — see the ephemeral-filesystem note above.
