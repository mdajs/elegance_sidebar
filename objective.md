# ♛ Elegance Chess Club — Custom Sidebar Spec

**Club:** [chess.com/club/elegance](https://www.chess.com/club/elegance)
**Purpose:** A widget/sidebar (for a club website, Discord embed page, OBS overlay, or a personal fan-site) that pulls **live data from Chess.com's public PubAPI** and displays it in a design language that matches the "Elegance" identity.

---

## 1. Brand Direction — "Elegance"

Since the club is named *Elegance*, the sidebar should feel refined, not gamer-loud. Think **luxury boutique**, not esports dashboard.

| Element | Direction |
|---|---|
| **Palette** | Deep ink black `#0E0F12`, ivory/cream `#F5F1E8`, muted gold accent `#C9A959`, and a soft burgundy `#5E1B1B` for highlights (wins/alerts). Avoid Chess.com's own green (#7FA650) as a primary brand color — use it only for small "live/online" indicators so it doesn't clash. |
| **Typography** | A serif display face for headings (e.g. *Playfair Display*, *Cormorant Garamond*) paired with a clean grotesk for body text (e.g. *Inter*, *Manrope*). Serif = elegance, grotesk = readability at small sidebar widths. |
| **Iconography** | Thin-line chess piece glyphs (♛ ♞ ♜) as section markers instead of generic dashboard icons. A queen (♛) as the club's signature mark, echoing "Elegance." |
| **Texture/Motif** | Subtle marble or velvet-gradient background behind the header; a thin gold hairline rule (1px) separating sections instead of heavy card borders/shadows. |
| **Motion** | Minimal — a slow fade/slide on data refresh, no bouncy animations. Elegance = restraint. |
| **Tone of copy** | "New to the Club" instead of "New Members!!", "This Month's Finest Game" instead of "🔥 GOTM 🔥". |

---

## 2. What the Chess.com PubAPI Can Actually Give You

The PubAPI (`https://api.chess.com/pub/`) is **read-only, keyless, and public** — perfect for a client-side widget. Base club endpoint uses the URL-ID `elegance`:

| Data you want | Endpoint | Notes |
|---|---|---|
| Club profile (name, icon, member count, description, admins, avg. rating, created date) | `GET /pub/club/elegance` | Refreshes ≤ every 12h |
| Members list (weekly/monthly/all-time active + join timestamps) | `GET /pub/club/elegance/members` | Grouped by activity, not a flat roster |
| Club team matches (daily + live, registered/in-progress/finished) | `GET /pub/club/elegance/matches` | This is your **Vote Chess / Daily Matches / Upcoming Matches** data source |
| A specific match's boards & scores | `GET /pub/match/{id}` and `/pub/match/live/{id}` | Drill-down from the matches list |
| Individual member profile (avatar, title, country, followers) | `GET /pub/player/{username}` | Needed to render avatars in "New Joiners" |
| Individual member stats (ratings per format) | `GET /pub/player/{username}/stats` | Needed for "Player of the Month" leaderboard |
| A member's recent finished games | `GET /pub/player/{username}/games/{yyyy}/{mm}` | Needed for "Game of the Month" candidates |
| Site-wide leaderboards (not club-scoped) | `GET /pub/leaderboards` | Optional "how our members rank globally" |
| Daily puzzle | `GET /pub/puzzle` | Nice-to-have widget filler |

**Important honesty check — two of your requested features don't exist as ready-made endpoints:**

- **"Player of the Month"** — Chess.com has no such club endpoint. You have to *compute* it yourself: pull the roster from `/members`, fetch `/stats` for each member, and rank by rating gain, win count, or activity over the last 30 days. It'll need to run server-side/cached since it's N+1 API calls.
- **"Game of the Month"** — Also not a native endpoint. You'd fetch each member's monthly archive (`/games/{yyyy}/{mm}`) and apply your own "best game" heuristic (e.g. longest game, biggest upset by rating difference, highest accuracy if present, or a manually curated pick by a club admin). Realistically, most clubs **hand-pick** this one and just store the PGN/URL in your own small database rather than computing it — much cheaper than iterating every member's archive.
- **Vote Chess** is *not* a separate endpoint either — it's bundled inside `/pub/club/elegance/matches` as a slower-paced daily team match. You'll need to identify vote-chess matches by name/format convention (they usually say "Vote Chess" in the match name) since the API doesn't tag the match type explicitly.

Everything else (new joiners, daily matches, upcoming events/matches) maps directly to real endpoints.

---

## 3. Sidebar Layout (top → bottom)

```
┌───────────────────────────────┐
│   ♛  ELEGANCE                 │  ← club icon + name (from /club/elegance)
│   1,204 members · est. 2019   │  ← members_count + created (formatted)
├───────────────────────────────┤
│  ✦ NEW TO THE CLUB            │
│   ○ avatar  username  "3d ago"│  ← from /members (weekly list) + /player/{u}
│   ○ avatar  username  "5d ago"│
├───────────────────────────────┤
│  ✦ PLAYER OF THE MONTH        │
│   [avatar]  Username           │  ← curated/computed, cache monthly
│   Rapid 1842 (+96 this month)  │
├───────────────────────────────┤
│  ✦ GAME OF THE MONTH          │
│   White vs Black · Result      │  ← curated PGN, embed with chess.js/board viewer
│   [▶ view board]                │
├───────────────────────────────┤
│  ✦ VOTE CHESS                 │
│   vs Rival Club · Move 24      │  ← filtered from /club/elegance/matches
│   Club to move · ends in 2d    │
├───────────────────────────────┤
│  ✦ DAILY MATCHES              │
│   ● In progress (2)            │  ← /club/elegance/matches → in_progress
│   ○ Registered (1)             │  ← → registered
├───────────────────────────────┤
│  ✦ UPCOMING EVENTS            │
│   Fri — Live Team Match vs X   │  ← registered matches w/ start_time,
│   Sun — Weekend Vote Chess     │    OR manually-entered from club calendar
├───────────────────────────────┤
│  ♞ Daily Puzzle                │  ← /pub/puzzle (optional footer widget)
└───────────────────────────────┘
```

---

## 4. Section-by-Section Build Notes

### Header — Club Identity
- `GET https://api.chess.com/pub/club/elegance`
- Render: `icon` (200×200), `name`, `members_count`, `created` (Unix → "Est. 2019"), `description` (truncate to 1–2 lines), link out to `url`.

### New Joiners
- `GET https://api.chess.com/pub/club/elegance/members` → use the `weekly` array (most recently active/joined-adjacent), sort by `joined` timestamp descending, take top 5.
- For each username, optionally call `GET /pub/player/{username}` to get `avatar`, `title`, `country` for a richer card.
- Cap enrichment calls (e.g. 5–10 per load) to respect serial rate limits — don't fire them in parallel; the API is unlimited only for **serial** requests.

### Player of the Month
- Batch job (run once, cache for 30 days), not live-computed on page load:
  1. Pull roster from `/members` (all_time list).
  2. For each username, fetch `/stats`.
  3. Rank by whichever metric fits the club's culture: rating gain this month, most games played, or highest `last.rating` in a chosen format.
  4. Store the winner + snapshot rating in your own backend/JSON file; sidebar just reads that cached record.

### Game of the Month
- Recommended: a lightweight **admin-curated** field (club officer pastes a game URL/PGN once a month into a small CMS/Google Sheet/JSON file) rather than programmatic detection — far more reliable and true to "elegance" (you can pick a genuinely brilliant or artistic game).
- Render with a static board diagram (final position FEN) or an embedded PGN viewer (e.g. `chessboard.js` + `chess.js`), with a "▶ Replay" link to the real chess.com game URL.

### Vote Chess
- `GET /pub/club/elegance/matches`
- Filter `in_progress` + `registered` arrays where `name` contains "Vote" (case-insensitive) or `time_class === "daily"` with your club's known vote-chess match naming convention.
- Show opponent club name/icon (fetch `opponent` club URL if you want their crest too), and `start_time`.

### Daily Matches
- Same `/matches` endpoint, `time_class === "daily"` entries not caught by the Vote Chess filter.
- Bucket by `registered` / `in_progress` / `finished` (show only most recent 2–3 finished with W/L/D badge from `result`).

### Upcoming Events
- Primary source: `registered` matches from `/matches` (has `start_time` for auto-start matches; some are manual-start and won't have one yet — label those "Date TBA").
- If the club also runs OTB meetups, tournaments not on chess.com, or socials, that data has **no PubAPI source** — add a small manually-maintained JSON/CMS feed for those and merge it into the same "Upcoming" list client-side.

### Daily Puzzle (optional filler widget)
- `GET /pub/puzzle` — image + link, refreshes daily. Good use of empty sidebar space, on-brand ("a moment of quiet calculation").

---

## 5. Technical Implementation Notes

- **No API key needed** — pure `fetch()` calls work from the browser, but note Chess.com does **not send permissive CORS headers on every endpoint historically**; if you hit CORS issues, proxy the calls through a tiny serverless function (Cloudflare Worker / Vercel Edge Function) that fetches server-side and caches the JSON.
- **Respect cache windows:** club profile & members refresh at most every 12 hours server-side — don't poll more than hourly; cache aggressively client-side (`localStorage` + timestamp, or your proxy's own cache headers).
- **Serial, not parallel, requests** — especially when enriching multiple usernames with avatars; batch with a small delay (e.g. 150–250ms) to avoid `429 Too Many Requests`.
- **Attribution/branding:** Chess.com's API terms ask you not to reuse their piece designs, board colors, or move-glyphs as if they were your own product assets — fine for a data widget, but keep your board/piece rendering visually distinct from Chess.com's native board skin (this also reinforces your own "Elegance" look rather than looking like a Chess.com clone).
- **Suggested stack:** static HTML/CSS/JS widget (works as an iframe-able embed anywhere) or a small React component if it's going into an existing site. A tiny backend/cron (even a GitHub Action running daily) is enough to maintain the "Player of the Month" and "Game of the Month" cached JSON files.

---

## 6. Suggested File/Data Structure

```
elegance-sidebar/
├── index.html
├── styles.css              (ivory/ink/gold palette, serif+grotesk type)
├── script.js                (fetch + render logic, client-side cache)
├── data/
│   ├── player-of-month.json    (admin/cron-updated)
│   ├── game-of-month.json      (admin-curated PGN + blurb)
│   └── events.json              (manually maintained upcoming events not on chess.com)
```

---

## 7. Quick-Reference: Live Endpoints for This Club

- Profile: `https://api.chess.com/pub/club/elegance`
- Members: `https://api.chess.com/pub/club/elegance/members`
- Matches: `https://api.chess.com/pub/club/elegance/matches`
- Daily puzzle: `https://api.chess.com/pub/puzzle`

I can also build this out as a real working HTML/CSS/JS sidebar (or a React component) that calls these endpoints live and matches the elegant styling above — just say the word.