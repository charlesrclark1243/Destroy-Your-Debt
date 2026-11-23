# Destroy Your Debt Dashboard

A local Angular dashboard for tracking credit card debt.

## Run it

Requires Node.js 20.19+ (or 22.12+).

```bash
npm install
npm start          # then open http://localhost:4200
```

Run `npm test` for the unit tests, and `npm run build` for a static build in `dist/`.

Data is saved in your browser's `localStorage`. Without sync, nothing leaves your machine,
and clearing the browser's site data erases it. To keep data across browsers and devices,
turn on Google Drive sync (below).

## Charts

With account balances d₁…dₙ and effective annual rates r₁…rₙ (as decimals):

| Chart | Formula |
|---|---|
| Share of total debt | sᵢ = dᵢ / D, where D = Σ dⱼ |
| Share of next statement's interest | sᵢ = mᵢ / Σ mⱼ, where mᵢ = dᵢ((1 + rᵢ)^(1/12) − 1) |

The second chart measures **interest, not debt**: mᵢ is the interest balance i accrues over
the next month (1/12 year) using its own compounding, so each slice is that account's share of
your next statement's interest. 0% APR accounts accrue nothing and are left out of this chart
(they're listed under it).

### Compounding

Each account has a compounding method, which turns its nominal APR into the effective rate rᵢ:

| Method | rᵢ | Notes |
|---|---|---|
| Daily ÷ 365 (default) | (1 + APR/365)^365 − 1 | Most US cards |
| Daily ÷ 360 | (1 + APR/360)^365 − 1 | Some issuers; slightly higher |
| Monthly | (1 + APR/12)^12 − 1 | Less common |

The "next statement's interest" figure in the summary is Σ mᵢ, the same total shown in the middle of the interest chart.

## Payment planner

Enter how much you can pay each month and pick a strategy. Every strategy pays all minimums
first; they differ in where the rest goes:

| Strategy | Where the extra goes |
|---|---|
| **Avalanche** | Highest-rate card first, until it's paid off, then the next |
| **Snowball** | Smallest balance first, so whole cards get paid off sooner |
| **Level the charges** | The card with the biggest monthly interest charge (balance × monthly rate) until its charge is down to the next card's, then both together, and so on |

Set a regular monthly amount, then add any months that will be different: **Only in** a month
(say, a $1,500 bonus in March) or **Every month from** a month on (say, $600 a month from
January). A one-off overrides an ongoing change for its month.

The planner shows this month's payment for each card and projects your amounts month by month
until you're debt-free: total interest, the debt-free month (the month of your last payment),
when each card is paid off, and a month-by-month table of what to pay each card. It also
compares all three strategies with your amounts and marks the cheapest. Avalanche always has
the lowest total interest and finishes soonest, with steady or varying amounts (the unit tests
check this on hundreds of random sets of cards); the others trade some interest for other goals.
Money paid earlier saves more than the same money paid later, so a lump sum is worth applying
as soon as you have it.

If this month's amount doesn't cover all minimums, the planner warns you, covers minimums in the
strategy's order, and skips the projection. If a later month doesn't cover the minimums due then,
the projection stops at that month and says which one. It assumes payments post at the start of the
billing cycle, rates and minimums stay the same, and there are no new charges. It doesn't model
fees, promotional rates ending, or rewards. The amounts, changes and strategy are saved with your
accounts, so they sync through Google Drive too (the most recent change wins).

## Google Drive sync (optional)

Signing in with Google stores your accounts in a hidden app folder in **your own** Google Drive,
so they follow you to any browser or device where you sign in with the same Google account.
There is no backend: the app talks to Google directly from the browser.

- Each person's data goes in their own Drive. The app's owner can't read it.
- The folder is hidden in Drive's file list. To see or delete it: Drive → Settings → Manage apps.
- Changes upload a moment after you make them. Other devices pick them up when the app
  loads or comes back into focus, and about once a minute while it's open.
- Conflicts are resolved per account: the most recent edit of each card wins, and deletions
  are remembered so an old copy on another device can't bring a card back.
- Google's access tokens last about an hour. When one expires, sync pauses (your changes are
  still saved in the browser) until you click **Reconnect**.

### Setup (one time, free)

1. Open https://console.cloud.google.com and create a project (e.g. "Debt Dashboard").
2. **APIs & Services → Library**: find **Google Drive API** and click **Enable**.
3. **Google Auth Platform** (called "OAuth consent screen" in older versions of the console):
   - Fill in an app name and your email. For audience, choose **External**.
   - Under **Data access**, add the scope `https://www.googleapis.com/auth/drive.appdata`.
   - Under **Audience**, leave the app in **Testing** and add every Google account that will
     use it as a **test user** (up to 100). This avoids Google's app review. When signing
     in, you'll see a "Google hasn't verified this app" notice: click **Continue**.
4. **Clients → Create client**, type **Web application**. Under **Authorized JavaScript
   origins**, add every address you'll open the app from, for example:
   - `http://localhost:4200`
   - `https://your-cloudfront-domain.example.com` (HTTPS is required for anything except localhost)

   No redirect URIs are needed.
5. Copy the client ID (it ends in `.apps.googleusercontent.com`) into
   `src/app/core/sync-config.ts`:

   ```ts
   export const GOOGLE_CLIENT_ID = '1234567890-abc123.apps.googleusercontent.com';
   ```

   The client ID isn't a secret, so it's fine to commit it and ship it in the build.
6. Restart `npm start` and click **Sign in with Google to sync**. If the popup doesn't
   appear, allow pop-ups for the site. Content blockers can also block `accounts.google.com`.

With `GOOGLE_CLIENT_ID` left empty, the app never contacts Google and works browser-only.

## Code layout

- `src/app/core/debt-math.ts`: all calculations (unit-tested in `debt-math.spec.ts`)
- `src/app/core/account.store.ts`: account state and persistence
- `src/app/core/payment-plan.ts`: the payment strategies and payoff projection (unit-tested)
- `src/app/core/payment-schedule.ts`: monthly amounts with one-off and ongoing changes (unit-tested)
- `src/app/components/payment-planner/`: the planner section
- `src/app/core/sync-merge.ts`: how two copies of the data are combined (unit-tested)
- `src/app/core/drive-sync.service.ts`: Google sign-in and Drive sync
- `src/app/core/sync-config.ts`: your Google OAuth client ID
- `src/app/components/sync-status/`: sync status, sign-in and sign-out in the header
- `src/app/components/donut-chart/`: SVG donut chart, no chart library needed
- `src/app/components/account-form/`: add/update dialog
- `src/app/app.*`: dashboard layout, summary tiles, accounts table
