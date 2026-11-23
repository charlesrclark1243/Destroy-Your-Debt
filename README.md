# Destroy Your Debt Dashboard

A credit card debt dashboard that shows where your debt and interest come from, and plans the
cheapest way to pay it off. It runs entirely in your browser, with optional sync through your
own Google Drive.

**Live site:** https://destroy-your-debt.com

## Features

- **Accounts:** add, update and delete cards with balance, APR, compounding method, credit line,
  minimum payment, due day and expected new charges per month. Promotional rates (such as a 0%
  balance transfer) can have an end date, a later APR, and deferred interest. Shows utilization per
  card and overall, and flags cards over their limit and promotions that have ended.
- **Summary:** total debt, utilization, balance-weighted average APR, next statement's interest,
  and total minimum payments.
- **Two charts:** each card's share of your total **debt**, and each card's share of next
  statement's **interest**.
- **Payment planner:** splits what you can pay each month across your cards using one of three
  strategies, projects month by month until you're debt-free, and compares the strategies. Handles
  months with a different amount, such as a bonus or a raise.
- **Google Drive sync (optional):** your accounts and planner settings follow you to any browser
  or device where you sign in with the same Google account.
- Works on phones, and in light and dark mode.

## Your data and privacy

- There's no backend server. Everything is calculated in your browser.
- Without signing in, your data is stored only in your browser (`localStorage`) and never leaves
  your device. Clearing the browser's site data erases it, and each browser and device has its
  own separate copy.
- With Google sync, your data is also saved to a hidden app folder in **your own** Google Drive.
  The site's owner can't read it. To see or delete it: Google Drive → Settings → Manage apps.
- On a shared computer, use **Sign out → Remove from this browser** to clear your data from it.

## Run it locally

Requires Node.js 22.22.3+, 24.15+ or 26+ (`node -v` to check).

```bash
npm install
npm start          # then open http://localhost:4200
```

| Command | What it does |
|---|---|
| `npm start` | Development server with live reload at http://localhost:4200 |
| `npm test -- --watch=false` | Runs the unit tests once |
| `npm run build` | Production build in `dist/debt-dashboard/browser/` |
| `./deploy.sh` | Tests, builds and publishes to AWS (see [Deploying](#deploying)) |

## How the numbers work

With account balances d₁…dₙ and effective annual rates r₁…rₙ (as decimals):

| Chart | Formula |
|---|---|
| Share of total debt | sᵢ = dᵢ / D, where D = Σ dⱼ |
| Share of next statement's interest | sᵢ = mᵢ / Σ mⱼ, where mᵢ = dᵢ((1 + rᵢ)^(1/12) − 1) |

The second chart measures **interest, not debt**: mᵢ is the interest balance i accrues over the
next month (1/12 year) using its own compounding. 0% APR accounts accrue nothing, so they're left
out of this chart and listed under it. The "next statement's interest" figure in the summary is
Σ mᵢ, the total shown in the middle of the interest chart, assuming no payment is made.

### Compounding

Each account has a compounding method, which turns its nominal APR into the effective rate rᵢ:

| Method | rᵢ | Notes |
|---|---|---|
| Daily ÷ 365 (default) | (1 + APR/365)^365 − 1 | Most US cards |
| Daily ÷ 360 | (1 + APR/360)^365 − 1 | Some issuers; slightly higher |
| Monthly | (1 + APR/12)^12 − 1 | Less common |

Check your card agreement for the "daily periodic rate" if you're not sure.

### Promotional rates

If a card's current APR is a promotion, tick **Current APR is a promotional rate** and enter the
month it ends and the APR afterwards. The charts and summary use the current rate; the payment
planner switches to the later rate after the end month.

Tick **Deferred interest** for offers like "no interest if paid in full by…" (common on store
cards): if any balance is left when the promotion ends, the interest that would have accrued at
the later rate is charged all at once. The planner estimates this from today on, since interest a
promotion built up before today isn't known.

## Payment planner

Enter a regular monthly amount and pick a strategy. Every strategy does the same three things
first, in this order:

1. pays every card's minimum;
2. pays new charges in full on cards that are already paid off, so they stay interest-free;
3. sets aside enough each month to clear deferred-interest promotions before they end.

They differ in where the rest goes:

| Strategy | Where the extra goes |
|---|---|
| **Avalanche** | Highest-rate card first, until it's paid off, then the next |
| **Snowball** | Smallest balance first, so whole cards get paid off sooner |
| **Level the charges** | The card with the biggest monthly interest charge (balance × monthly rate) until its charge is down to the next card's, then both together, and so on |

Add any months that will be different: **Only in** a month (say, a $1,500 bonus in March) or
**Every month from** a month on (say, $600 a month from January). A one-off overrides an ongoing
change for its month.

The planner shows:

- this month's payment for each card;
- total interest until debt-free and the debt-free month (the month of your last payment);
- the month each card is paid off;
- a month-by-month table of what to pay each card;
- all three strategies compared with your amounts, with the cheapest marked.

Avalanche always has the lowest total interest and finishes soonest, with steady or varying
amounts. The unit tests check this on hundreds of random sets of cards. The other strategies
trade some interest for other goals. Money paid earlier saves more than the same money paid
later, so a lump sum is worth applying as soon as you have it.

**New charges:** each card's expected new charges are added every month. While a card carries a
balance, new charges accrue interest from mid-month (there's no grace period); once it's paid off,
the plan pays its new charges in full each month. "Debt-free" means no card carries a balance
from one month to the next. After that, keep paying your new charges in full.

The planner warns you when:

- this month's amount doesn't cover all minimums (it covers them in the strategy's order and skips
  the projection);
- a later month doesn't cover the minimums due then (the projection stops at that month);
- the amounts never pay the balances off, because they don't keep up with interest and new
  charges;
- a deferred-interest promotion will end with a balance left, with the estimated interest charged
  and the month.

**Assumptions:** payments post at the start of the billing cycle, new charges are spread evenly
through each month, and rates (apart from promotions ending) and minimums stay the same. The
planner doesn't model fees or rewards.

## Google Drive sync

Click **Sign in with Google to sync** in the header. The app talks to Google directly from the
browser; there's no backend.

- Changes upload a moment after you make them. Other devices pick them up when the app loads or
  comes back into focus, and about once a minute while it's open.
- Conflicts are resolved per account: the most recent edit of each card wins, and deletions are
  remembered so an old copy on another device can't bring a card back. Planner settings sync as
  one unit, and the most recent change wins.
- The first time you sign in, if both the browser and your Drive already have accounts, you
  choose whether to merge them or use the Drive copy.
- Google's access tokens last about an hour. When one expires, sync pauses (your changes are still
  saved in the browser) until you click **Reconnect**.
- The sign-in window is a pop-up, so allow pop-ups for the site. On iPhone, check
  Settings → Safari → Block Pop-ups.

### Google setup

The OAuth client ID is in `src/app/core/sync-config.ts`. It isn't a secret: Google only accepts
it from the origins registered for it (`https://destroy-your-debt.com` and
`http://localhost:4200`). With an empty ID, the sign-in button is hidden and the app never
contacts Google.

To run your own copy at a different address, create your own client ID (free):

1. Open https://console.cloud.google.com and create a project.
2. **APIs & Services → Library:** enable the **Google Drive API**. You don't need to create
   credentials there.
3. **Google Auth Platform** (called "OAuth consent screen" in older versions of the console):
   - **Branding:** set an app name and support email, and add your domain under
     **Authorized domains**.
   - **Audience:** choose **External**, leave the app in **Testing**, and add every Google
     account that will use it as a **test user** (up to 100). While in Testing, sign-in shows a
     "Google hasn't verified this app" notice; click **Continue**.
   - **Data access:** add the scope `https://www.googleapis.com/auth/drive.appdata`.
4. **Clients → Create client:** choose **Web application**, and under **Authorized JavaScript
   origins** add every address you'll open the app from, such as `http://localhost:4200` and
   `https://your-domain.example`. No redirect URIs are needed. Ignore the client secret; the app
   doesn't use it.
5. Put the client ID in `src/app/core/sync-config.ts`.

## Deploying

The site is static files served from a private **S3** bucket through **CloudFront** (HTTPS),
with the domain registered in **Route 53** and a free certificate from **AWS Certificate
Manager**.

To publish the local code:

```bash
./deploy.sh              # test, build, upload, clear the CloudFront cache
./deploy.sh --dry-run    # show what would change, without changing anything
./deploy.sh --help       # all options
```

The script:

1. checks that the AWS CLI is signed in and the bucket is reachable;
2. runs the tests, then builds;
3. uploads the new JavaScript and CSS first, then `index.html` and the icons, then removes the
   previous build's files, so visitors never get a page that points at missing files;
4. clears the CloudFront cache and waits for that to finish.

It uses the `debt-dashboard` bucket and finds the CloudFront distribution from
`destroy-your-debt.com`. Override these with environment variables, for example
`BUCKET=my-bucket DOMAIN=example.com ./deploy.sh` or `DISTRIBUTION_ID=E123ABC ./deploy.sh`.
Add `AWS_PROFILE=name` to use a named AWS CLI profile.

**Caching:** JavaScript and CSS file names change with every build, so they're cached for a year.
`index.html` and the icons use `no-cache`, so visitors always get the latest version.

### One-time AWS setup

1. **S3:** create a bucket and leave **Block Public Access** on. Don't enable static website
   hosting.
2. **CloudFront:** create a distribution with the bucket as an **Amazon S3** origin, using
   **origin access control**. Use these settings:
   - **Viewer protocol policy:** Redirect HTTP to HTTPS.
   - **Cache policy:** CachingOptimized.
   - **Response headers policy:** SecurityHeadersPolicy.
   - **Default root object:** `index.html`.

   Make sure the bucket policy lets the distribution read the bucket. The console offers to add
   it.
3. **Domain:** register it in Route 53, request a certificate in **us-east-1**, add the domain
   to the distribution as an alternate domain name, and create **A** and **AAAA** alias records
   pointing to the distribution.
4. **Google:** add the site's `https://` address to the OAuth client's authorized JavaScript
   origins.

## Project layout

| Path | What's there |
|---|---|
| `src/app/core/debt-math.ts` | Rates, compounding, shares, summary figures |
| `src/app/core/payment-plan.ts` | Payment strategies and the payoff projection |
| `src/app/core/payment-schedule.ts` | Monthly amounts with one-off and ongoing changes |
| `src/app/core/account.store.ts` | Accounts and planner settings, saved to `localStorage` |
| `src/app/core/sync-merge.ts` | How two copies of the data are combined when syncing |
| `src/app/core/drive-sync.service.ts` | Google sign-in and Google Drive sync |
| `src/app/core/sync-config.ts` | The Google OAuth client ID |
| `src/app/components/` | Donut chart, account form, payment planner, sync status, dialogs |
| `src/app/app.*` | Page layout, summary tiles, accounts table |
| `public/` | Icons (`favicon.svg`, `favicon.ico`) |
| `deploy.sh` | Build and publish to S3 and CloudFront |

The calculation, planning, scheduling, sync-merge and storage code is unit-tested, in the
`*.spec.ts` files next to each source file.

## License

Copyright © 2026 Charles R. Clark. All rights reserved.
