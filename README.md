# Elegance Chess Club Sidebar

A live, elegant sidebar widget for the [Elegance Chess Club](https://www.chess.com/club/elegance) on Chess.com.

Pulls real-time data from Chess.com's public PubAPI — no API key required.

## Features

- **Club Header** — live club icon, name, member count, and description
- **New to the Club** — top 5 recent joiners with avatars, titles & country flags
- **Player of the Month** — admin-curated or auto-computed from weekly active members
- **This Month's Finest Game** — FEN/PGN board viewer (custom SVG renderer, zero dependencies)
- **Vote Chess** — live in-progress & registered vote chess matches
- **Daily Matches** — in-progress / registered / recent finished with W/L/D badges
- **Upcoming Events** — Chess.com registered matches + manually maintained off-site events
- **Daily Puzzle** — Chess.com's daily puzzle image with a "Solve" link

## Tech Stack

- **Pure HTML / CSS / JS** — no framework, no build step
- **Chess.com PubAPI** — keyless, read-only, public endpoints
- **localStorage caching** — 12h for club/members, 1h for matches, 24h for puzzle
- **CORS auto-fallback** — switches to corsproxy.io if direct fetch is blocked
- **Custom SVG board** — renders FEN positions with Unicode chess glyphs (no chessboard.js/jQuery)

## Running Locally

Serve the folder with any static file server:

```bash
npx serve .
# or
python -m http.server 5500
```

Then open `http://localhost:5500`.

## Updating Monthly Content

| File | What to edit |
|---|---|
| `data/player-of-month.json` | `username`, `rating`, `format`, `gain`, `month`, `avatar_url` |
| `data/game-of-month.json` | `white`, `black`, `result`, `fen`, `url`, `blurb` |
| `data/events.json` | Add entries: `title`, `subtitle`, `start_time` (Unix), `url` |

## API Endpoints Used

```
GET https://api.chess.com/pub/club/elegance
GET https://api.chess.com/pub/club/elegance/members
GET https://api.chess.com/pub/club/elegance/matches
GET https://api.chess.com/pub/player/{username}
GET https://api.chess.com/pub/player/{username}/stats
GET https://api.chess.com/pub/puzzle
```

## Embedding

Works as an iframe embed or OBS Browser Source:

```html
<iframe src="https://your-host/elegance-sidebar/" width="360" style="border:none; height:100vh;"></iframe>
```

---

*Design: deep ink black · ivory · muted gold · Playfair Display + Inter*
