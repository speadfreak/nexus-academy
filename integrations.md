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

## Study rooms — LiveKit Cloud (video + screen share + group chat)

Rooms always belong to a study group (invite-code only, members only — no
public room discovery). Video runs on **LiveKit Cloud** (managed WebRTC: SFU,
TURN, reconnection) via `@livekit/components-react`; chat and the shared
workspace use Convex reactive queries (`roomMessages`, `roomSharedItems`).
Safety is server-side: join tokens are minted only after group-membership +
block checks, blocked users can't join rooms or speak into them, and report +
block are one tap away from every participant tile (admin Reports tab in
`/admin`). **No recording exists anywhere in this build** — ending a room
deletes it via the provider API, terminating video for everyone.

Set these keys in the **Keys / API keys** tab (from your LiveKit Cloud
project — Project Settings > Keys; sign up at livekit.io/cloud):

| Key | Purpose |
| --- | --- |
| `LIVEKIT_URL` | WebSocket URL, e.g. `wss://<project>.livekit.cloud` |
| `LIVEKIT_API_KEY` | LiveKit Cloud API key |
| `LIVEKIT_API_SECRET` | LiveKit Cloud API secret |

Without them, room calls throw a clear "not configured" error in the UI.
Free tier at time of writing: Build plan $0/mo (no card), 5,000 WebRTC
minutes/mo + 40k free API requests, 50GB transfer.

## Hosting — Render (static frontend, Convex backend)

The app is a Vite/React SPA backed by Convex (`https://hearty-seahorse-455.convex.cloud`).
Render serves the static build; it runs NO backend code and holds NO secrets —
all backend keys live in the Convex dashboard's environment variables.

`render.yaml` (repo root) is a Render Blueprint: static site, build command
(`bun install && bun run build`, falls back to npm), publish dir `./dist`,
and an SPA rewrite (`/*` -> `/index.html`) so direct refreshes on
`/dashboard`, `/admin`, `/rooms/:id` work.

### Deploy steps

1. Repo is already on GitHub (`speadfreak/nexus-academy`).
2. Render dashboard: **New + -> Blueprint** -> pick the repo. Render reads
   `render.yaml` and creates the site.
3. **Env var on Render (build-time):** `VITE_CONVEX_URL`
   (`https://hearty-seahorse-455.convex.cloud` for the dev deployment; use
   the production deployment URL once one exists via `bunx convex deploy`).
   Optional: `VITE_VLY_APP_ID` / `VITE_VLY_MONITORING_URL` (error telemetry;
   the app no-ops without them).
4. Deploy, then test at the Render URL. Auth (email OTP, Google), payments,
   LiveKit rooms and R2 downloads all talk to Convex directly — nothing else
   to configure.

Auth caveat: Google OAuth's callback is `${CONVEX_SITE_URL}/api/auth/callback/google`
— that stays on the Convex domain, so Google sign-in works from any frontend
origin without extra setup.

## Profile + login (username handle, no passwords)

- **No passwords are stored.** Sign-in is email-OTP (6-digit code), Google
  OAuth, or guest — the safer choice for under-18 students.
- Students can set a **username** (login handle) in Settings → Profile;
  `/auth` accepts **email OR username**, resolving the handle server-side
  (`profile.resolveLoginIdentifier`) before sending the code. "Forgot
  password" is therefore "forgot your username?" — re-enter your email or
  username and a fresh code is emailed (`Resend code` on the OTP step).
- Avatars upload to Convex file storage; until one is set, the UI renders an
  initials avatar everywhere (shell, dashboard greeting, groups, rooms).
- The dashboard greets the student by first name with a time-of-day greeting
  ("Good morning, …" / "Late night grind").

## Admin command center + observability (Phase: Admin overhaul)

- **`systemEvents` table + `src/convex/systemEvents.ts`** — internal
  observability. Critical paths log events: AI tutor/classifier calls
  (cost + latency), payments, auth failures, room create/join, content
  uploads. Admin queries: `getSystemEvents` (paginated/filterable),
  `getSystemHealthSummary` (24h counts, error rate, avg AI latency, active
  users), plus `testIntegrationConnection` (live ping of xAI/R2/TeleBirr/
  M-Pesa/LiveKit/Google/GitHub/YouTube/Gemini keys).
- **Admin /admin** is now a sidebar command center: Dashboard (live charts),
  Content (AI-assisted upload), Users, Finance, Reports, **Terminal**
  (live-scrolling monospace event feed, color-coded, filterable, real-time
  via Convex reactivity), **Broadcast** (Telegram), System (integration
  health — status only, never secret values).
- **AI content auto-classification** — `src/convex/contentAI.ts`
  (`classifyContentText`): admin upload form extracts the first pages of a
  PDF **in the browser** (pdf.js — it crashes the Convex node analyzer, so
  it never runs server-side), sends the sample to Grok, and pre-fills the
  upload form marked "AI suggested — review before confirming". Nothing is
  ever auto-saved; the admin always confirms. Topic candidates become real
  `topics` rows + `contentTopics` links and power the reader's related-
  resources strip.
- **Telegram** — `src/convex/telegramActions.ts` (node) + `telegram.ts`
  (mutations/queries): `sendTelegramMessage`, channels, broadcast templates,
  broadcast log. The auto-post-on-upload hook defaults to **OFF** (admin
  toggle per channel). Requires `TELEGRAM_BOT_TOKEN` (see STOP-AND-ASK
  below for BotFather steps).

## Cinematic student library + reader (Phase: Reader)

- **Bookshelf redesign** — `/dashboard` content grid is now book-cover tiles
  (per-subject gradient spine, type icon, premium/year chips) with Framer
  Motion layout reflow, a **Bookmark** toggle per tile, and a
  "Bookmarked" reading-list filter (`bookmarks` table).
- **In-app reader at `/read/:contentId`** — real PDF rendering (react-pdf +
  pdfjs worker served as a Vite asset), page nav + zoom, dark chrome.
  Collapsible side panel (drawer on phones) with three tabs:
  - **AI companion** — `src/convex/geminiReader.ts` (`askReaderQuestion`):
    prefers `GEMINI_API_KEY` (Google AI Studio), falls back to Grok until
    that key lands; grounded in the specific document's title/subject/topics;
    shares the fair free daily cap, premium unlimited.
  - **Videos** — `src/convex/media.ts` (`searchYouTubeVideos`): 3-5 topic
    videos, opened in a new tab (never embedded/autoplayed). Requires
    `YOUTUBE_API_KEY`; graceful "not configured" state when missing.
  - **Scratchpad** — mathjs expression evaluator + free notes, persisted per
    (user, content item) via the `scratchpads` table.
  - **Related resources strip** — other library items sharing topics
    (`getRelatedContent`), the first student-facing use of the topic-
    correlation data.
- **Todo → notification cron** — todos got an optional `contentId`; a cron
  in `src/convex/crons.ts` scans for due-today todos and creates in-app
  notifications via the existing notifications pattern.
- **Music system** — expanded to 7 synthesized tracks in 3 categories
  (Focus: Deep Focus, Binaural; Calm: Rain, Breeze, Night; Deep Work:
  White Noise, Brown Noise), all Web-Audio-synthesized, still off by
  default, persists across routes. Category chip in the player.
- **Branding** — branded preloader (real load-completion based, not a
  timer), new `public/logo.svg` favicon (dark + blue N/book mark) and
  updated manifest.

### Keys to add in the Keys / API keys tab (from this phase)

| Key | Where from | Purpose |
| --- | --- | --- |
| `TELEGRAM_BOT_TOKEN` | @BotFather (see STOP-AND-ASK) | Broadcast to Telegram channels |
| `GEMINI_API_KEY` | Google AI Studio (free tier) | Reader AI companion (preferred provider) |
| `GEMINI_MODEL` | optional | default `gemini-2.0-flash` |
| `YOUTUBE_API_KEY` | Google Cloud Console → YouTube Data API v3 | Topic video search |

Admin System tab auto-detects each key and shows live test results.
