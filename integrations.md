# VLY Integrations

First-order integrations for AI, email, and payments with automatic usage billing through VLY integration keys.

## Environment Variables

The following environment variables are automatically set during project creation:

- `VLY_INTEGRATION_KEY`: Your unique integration key (format: `sk_*`)
- `VLY_INTEGRATION_BASE_URL`: The base URL for the integration gateway (default: `https://integrations.freebuff.com/`)

## Installation

The `@vly-ai/integrations` package is already included in package.json.

## Usage in Convex Actions

```typescript
"use node";

import { vly } from '../lib/vly-integrations';
import { action } from "./_generated/server";

export const generateAIResponse = action({
  handler: async (ctx, args) => {
    // AI Completions
    const completion = await freebuff.com.completion({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: 'Hello!' }
      ],
      temperature: 0.7,
      maxTokens: 150
    });
    
    return completion;
  }
});
```

## Available Features

### AI Integration
```typescript
// Create completion
const completion = await freebuff.com.completion({
  model: 'gpt-4o-mini', // or 'gpt-4o', 'claude-3-haiku', etc.
  messages: [...],
  temperature: 0.7,
  maxTokens: 150
});

// Stream completion
await freebuff.com.streamCompletion(
  request,
  (chunk: string) => console.log(chunk)
);

// Generate embeddings
const embeddings = await freebuff.com.embeddings("Your text here");
```

### Email Integration
```typescript
// Send email
const emailResult = await vly.email.send({
  to: 'user@example.com',
  subject: 'Welcome!',
  html: '<h1>Welcome to our service!</h1>',
  text: 'Welcome to our service!'
});

// Send batch emails
const batchResult = await vly.email.sendBatch([...emails]);
```

### Payments Integration
```typescript
// Create payment intent
const paymentIntent = await vly.payments.createPaymentIntent({
  amount: 2000, // $20.00 in cents
  currency: 'usd',
  description: 'Premium subscription',
  customer: {
    email: 'customer@example.com'
  }
});

// Create subscription
const subscription = await vly.payments.createSubscription({...});

// Create checkout session
const session = await vly.payments.createCheckoutSession({...});
```

## Error Handling

All methods return an ApiResponse object:

```typescript
interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  usage?: {
    credits: number;
    operation: string;
  };
}
```

Example error handling:

```typescript
const result = await freebuff.com.completion({ ... });

if (result.success) {
  console.log('Response:', result.data);
  console.log('Credits used:', result.usage?.credits);
} else {
  console.error('Error:', result.error);
}
```

## Important Notes

1. The integration key (`VLY_INTEGRATION_KEY`) is automatically injected during project creation
2. All API calls are automatically billed to your deployment based on usage
3. Must be used in Convex actions with `"use node"` directive
4. The integration key should never be exposed to the client

## Checking Integration Status

To verify the integration is properly configured:

```typescript
const hasIntegration = !!process.env.VLY_INTEGRATION_KEY;
if (!hasIntegration) {
  console.error("VLY integration key not found");
}
```

## Google OAuth

Sign-in with Google is wired via the Auth.js Google provider in
`src/convex/auth.ts` (`googleProvider`). Set these in the project's
**Keys / API keys tab** (never hardcode):

| Key | Purpose |
| --- | --- |
| `GOOGLE_CLIENT_ID` | Google Cloud OAuth client id |
| `GOOGLE_CLIENT_SECRET` | Google Cloud OAuth client secret |

In the Google Cloud console (APIs & Services > Credentials), create an OAuth
client (Web application) and add this exact redirect URI:

```
<CONVEX_SITE_URL>/api/auth/callback/google
```

Without these keys the Google button shows a clear "not configured" error and
email/guest sign-in still work.

## Study companion features (this build)

- **Daily quotes** — one AI-written motivation per day (`dailyQuotes` + hourly
  fallback cron; deterministic pool when the AI key is missing).
- **Study-vibe music** — persistent ambient player in `src/components/music-player.tsx`.
  Tracks are synthesized in-browser with the Web Audio API (rain / deep focus /
  breeze) so no audio files or licensing are required. To add real lo-fi tracks,
  upload MP3s to R2 and add them to the `TRACKS` list with a `url`.
- **Quizzes** — AI-generated, server-scored, premium-gated (`src/convex/quizzes.ts`).
- **Notes** — sticky notes with difficulty tags that tune the AI tutor's pacing.
- **Journey** — analytics page (`/journey`) with real hours, quiz trend, topic
  completion and cross-subject topic correlations.
- **Calendar** — week view (`/calendar`); AI study plans auto-create study-block
  events linked via `sourceStudyPlanId`.
- **Profile/settings/theme** — `/settings` with avatar upload, display name,
  stream, and a working light theme (see `src/index.css` `.light` tokens).
  Stream is chosen at first sign-in and personalizes the dashboard + tutor.
- **Admin control center** — `/admin` tabs: Overview, Content, Users (premium
  grant/expire/cancel for support), Payments, System (env key status).

## Gamification + social layer

XP, levels, achievements, study groups and in-app notifications are built on
Convex (`src/convex/xp.ts`, `achievements.ts`, `studyGroups.ts`,
`notifications.ts`, `dailyChallenge.ts`):

- **XP + levels** — XP is only ever written server-side through
  `internal.xp.awardXp` from real action success paths (quiz completed =
  20 + 5/correct, focus session ≥20 min = 15, streak day = 10, plan week =
  30, daily challenge correct = 10). Level curve: `level = floor(sqrt(xp/50)) + 1`.
  Level-ups surface as non-intrusive toasts + a bell notification, never an
  interstitial.
- **Achievements** — 10 meaningful ones, seeded idempotently from code. Every
  requirement checks real data (`checkAndAward` is idempotent); locked
  achievements show their exact requirement. `/achievements` shows the full
  grid with tier colors and a recent-XP feed.
- **Study groups** — opt-in and private: reachable only via a 6-char invite
  code, capped at 20 members, weekly leaderboard ranks XP only (never quiz
  scores or weak topics). `/groups` has create/join/leave + the board.
- **Notifications** — in-app only (no push infra fabricated): achievement,
  level-up, group-joined and plan-week notifications with an unread badge in
  the app shell.
- **Daily challenge** — one AI question per subject per day (deterministic by
  Addis date, cached globally), surfaced on the dashboard. Correct answer
  earns XP; completing it keeps the streak alive either way.

## GitHub Integration

GitHub provides backup and version control for this project. The Freebuff platform
manages git (git commands are blocked inside the project sandbox), so syncing is
configured from the Freebuff UI:

1. Open the project in Freebuff and go to the **Integrations tab** (left sidebar /
   top bar of the project view).
2. Connect your GitHub account and choose (or create) the repository for this
   project.
3. Deploys/snapshots push to that repo automatically from then on.

### Required key

Set this in the project's **Keys / API keys** tab (never hardcode it):

| Key | Purpose |
| --- | --- |
| `GITHUB_TOKEN` | GitHub personal access token with `repo` scope (fine-grained: read/write access to the connected repo's Contents + Commit statuses) |

Generate it at: GitHub > Settings > Developer settings > Personal access tokens >
Generate new token (classic: `repo` scope; or fine-grained scoped to the connected
repo with Contents: Read and write).

If `GITHUB_TOKEN` is missing, GitHub-backed operations that require the API will
report a clear configuration error instead of silently failing.

## GitHub Advanced Security

CodeQL code scanning, secret scanning, and Dependabot are configured in this
repo:

- `.github/workflows/codeql.yml` — CodeQL static analysis (javascript-typescript)
  on push/PR to `main` plus a weekly scheduled scan. Results land in the
  Security > Code scanning tab.
- `.github/dependabot.yml` — weekly version updates for the `bun` ecosystem
  (text `bun.lock`) and for GitHub Actions.
- Secret scanning + push protection are enabled in the repo itself
  (Settings > Code security and analysis). Custom secret-scanning patterns for
  private repos are configured in Settings, not by file.

### Required key

| Key | Purpose |
| --- | --- |
| `GITHUB_TOKEN` | Personal access token with `repo` scope (same key as the GitHub integration). The CodeQL workflow itself uses the automatic Actions `GITHUB_TOKEN`; a PAT is only needed for GitHub API operations outside workflows. |

To activate: enable Advanced Security on the connected repo in GitHub
(Settings > Code security and analysis), then push this branch so the workflow
actions are picked up.

## AI Tutor (Grok / xAI)

The AI tutor and study-plan generator call the Grok chat-completions API
(`https://api.x.ai/v1/chat/completions`) from Convex actions. Set these in the
project's **Keys / API keys** tab (never hardcode):

| Key | Purpose |
| --- | --- |
| `XAI_API_KEY` | xAI API key (https://console.x.ai) — required for the tutor and plans |
| `AI_MODEL` | Optional — model name, defaults to `grok-4.6` |

Without `XAI_API_KEY`, the tutor and plan generator surface a clear
"not configured" error in the UI.

## Payments — TeleBirr + M-Pesa (Ethiopia)

Premium subscriptions are paid via TeleBirr (Ethio telecom) or M-Pesa. The
provider adapters (`src/convex/providers/`) are built against public
provider documentation; before going live, confirm the exact createOrder field
names with the TeleBirr merchant portal and the M-Pesa Ethiopia gateway with
Safaricom Ethiopia (noted in the adapter files). Set these keys in the
**Keys / API keys** tab:

| Key | Purpose |
| --- | --- |
| `TELEBIRR_APP_ID` | TeleBirr merchant app id |
| `TELEBIRR_APP_KEY` | TeleBirr app secret |
| `TELEBIRR_SHORT_CODE` | TeleBirr merchant code (6 digits) |
| `TELEBIRR_FABRIC_APP_ID` | TeleBirr fabric app id (UUID) for the gateway token |
| `TELEBIRR_PRIVATE_KEY` | TeleBirr RSA private key (merchant signing) |
| `TELEBIRR_NOTIFY_URL` | Public webhook URL for TeleBirr notifications (`<CONVEX_URL>/webhooks/telebirr`) |
| `TELEBIRR_REDIRECT_URL` | Optional user return URL |
| `TELEBIRR_ENVIRONMENT` | `sandbox` (default) or `production` |
| `MPESA_CONSUMER_KEY` | M-Pesa Daraja consumer key |
| `MPESA_CONSUMER_SECRET` | M-Pesa Daraja consumer secret |
| `MPESA_SHORTCODE` | M-Pesa business shortcode (paybill/till) |
| `MPESA_PASSKEY` | Lipa na M-Pesa passkey (STK push password) |
| `MPESA_CALLBACK_URL` | Public callback URL (`<CONVEX_URL>/webhooks/mpesa`) |
| `MPESA_ENVIRONMENT` | `sandbox` (default) or `production` |
| `MPESA_BASE_URL` | Optional override (M-Pesa Ethiopia gateway) |

Webhook endpoints: `POST <CONVEX_URL>/webhooks/telebirr` and
`POST <CONVEX_URL>/webhooks/mpesa`. Both verify server-to-server with the
provider before settling (never trust callback params alone).

## Streak reminders

In-app streak reminders run via a Convex cron (hourly check, fires once per
user per day). No email/SMS provider is wired up — reminders surface as an
in-app banner. If real push/email reminders are wanted later, a transactional
email or push service would need to be added. Timezone is fixed to
Africa/Addis_Ababa (UTC+3) until per-user timezones are stored.
