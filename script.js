/* ♛ ELEGANCE CHESS CLUB SIDEBAR — SCRIPT
 * ─────────────────────────────────────────────────────────────────────
 * Pulls live data from Chess.com's public PubAPI (no API key required).
 * All sections use localStorage caching + serial enrichment requests
 * to stay within Chess.com's rate-limit guidelines.
 *
 * POTM & GOTM are computed live from member game archives:
 *   - POTM  → highest (wins×3 + draws) across rated rapid/blitz games
 *   - GOTM  → best game scored by: accuracy > upset margin > game length
 * ─────────────────────────────────────────────────────────────────────
 */

'use strict';

// ═══════════════════════════════════════════════════════════════════
//  CURRENT MONTH CONSTANTS
// ═══════════════════════════════════════════════════════════════════
const _NOW        = new Date();
const YEAR        = _NOW.getFullYear();
const MONTH_NUM   = String(_NOW.getMonth() + 1).padStart(2, '0');
const MONTH_KEY   = `${YEAR}-${MONTH_NUM}`;
const MONTH_LABEL = _NOW.toLocaleString('en-US', { month: 'long', year: 'numeric' });

// ═══════════════════════════════════════════════════════════════════
//  CONFIG
// ═══════════════════════════════════════════════════════════════════
const CONFIG = {
  CLUB_ID:   'elegance',
  API_BASE:  'https://api.chess.com/pub',
  PROXY_URL: 'https://corsproxy.io/?',
  useProxy:  false,

  TTL: {
    CLUB:     12 * 60 * 60 * 1000, // 12 h
    MEMBERS:  12 * 60 * 60 * 1000, // 12 h
    MATCHES:   1 * 60 * 60 * 1000, //  1 h
    PLAYER:    6 * 60 * 60 * 1000, //  6 h
    STATS:     6 * 60 * 60 * 1000, //  6 h
    PUZZLE:   24 * 60 * 60 * 1000, // 24 h
    ARCHIVES:  2 * 60 * 60 * 1000, //  2 h  (game archives for current month)
    MONTHLY:   6 * 60 * 60 * 1000, //  6 h  (computed POTM+GOTM result)
  },

  MAX_JOINERS:       5,
  MAX_ENRICH:        5,
  ENRICH_DELAY_MS: 180,
  MAX_VOTE:          3,
  MAX_FINISHED:      3,
  MAX_EVENTS:        6,
  MAX_CANDIDATES:   15,  // members to scan for POTM/GOTM
  MIN_GAMES:         1,  // minimum games to qualify for POTM
};

// ═══════════════════════════════════════════════════════════════════
//  LOCAL STORAGE CACHE
// ═══════════════════════════════════════════════════════════════════
const cache = {
  _prefix: 'elegance:',

  get(key) {
    try {
      const raw = localStorage.getItem(this._prefix + key);
      if (!raw) return null;
      const { data, expires } = JSON.parse(raw);
      if (Date.now() > expires) {
        localStorage.removeItem(this._prefix + key);
        return null;
      }
      return data;
    } catch {
      return null;
    }
  },

  set(key, data, ttl) {
    try {
      localStorage.setItem(
        this._prefix + key,
        JSON.stringify({ data, expires: Date.now() + ttl })
      );
    } catch {
      // Storage quota exceeded — skip caching silently
    }
  },
};

// ═══════════════════════════════════════════════════════════════════
//  FETCH HELPER  (CORS-proxy auto-fallback)
// ═══════════════════════════════════════════════════════════════════
async function apiFetch(url, cacheKey = null, ttl = 0) {
  if (cacheKey) {
    const hit = cache.get(cacheKey);
    if (hit !== null) return hit;
  }

  const attempt = async (targetUrl) => {
    const res = await fetch(targetUrl, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status} — ${targetUrl}`);
    return res.json();
  };

  let data;
  if (CONFIG.useProxy) {
    data = await attempt(CONFIG.PROXY_URL + encodeURIComponent(url));
  } else {
    try {
      data = await attempt(url);
    } catch (err) {
      if (err instanceof TypeError || (err.message && err.message.includes('Failed to fetch'))) {
        console.info('[Elegance] CORS detected — switching to proxy.');
        CONFIG.useProxy = true;
        data = await attempt(CONFIG.PROXY_URL + encodeURIComponent(url));
      } else {
        throw err;
      }
    }
  }

  if (cacheKey && ttl) cache.set(cacheKey, data, ttl);
  return data;
}

// ═══════════════════════════════════════════════════════════════════
//  UTILITIES
// ═══════════════════════════════════════════════════════════════════
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function escHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function relativeTime(unixSec) {
  const diff = Math.floor(Date.now() / 1000 - unixSec);
  if (diff < 60)             return 'just now';
  if (diff < 3600)           return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400)          return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 30)     return `${Math.floor(diff / 86400)}d ago`;
  if (diff < 86400 * 365)    return `${Math.floor(diff / (86400 * 30))}mo ago`;
  return `${Math.floor(diff / (86400 * 365))}y ago`;
}

function formatDateParts(unixSec) {
  const d = new Date(unixSec * 1000);
  const DAY_NAMES   = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return {
    dayName:  DAY_NAMES[d.getDay()],
    dayNum:   d.getDate(),
    monthStr: MONTH_NAMES[d.getMonth()],
    timeStr:  d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
    year:     d.getFullYear(),
  };
}

function extractYear(unixSec) {
  return new Date(unixSec * 1000).getFullYear();
}

function countryCodeToFlag(code) {
  if (!code || code.length !== 2) return '';
  try {
    return String.fromCodePoint(
      ...Array.from(code.toUpperCase()).map((c) => 0x1F1E6 + c.charCodeAt(0) - 65)
    );
  } catch { return ''; }
}

function getOpponentName(match) {
  if (match.name) {
    const m = match.name.match(/vs\.?\s+(.+)/i);
    if (m) return m[1].trim();
    return match.name;
  }
  if (match.opponent) {
    const slug = String(match.opponent).split('/').filter(Boolean).pop() || '';
    return slug.replace(/-/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase());
  }
  return 'Unknown Club';
}

function skeletonMemberList(count) {
  return Array.from({ length: count }, (_, i) => `
    <li class="member-item" style="animation-delay:${i * 0.08}s; pointer-events:none">
      <div class="member-avatar-placeholder skeleton" style="border:none; color:transparent"></div>
      <div class="member-info">
        <div class="skeleton-block skeleton" style="height:13px; width:${55 + (i % 3) * 15}%; margin-bottom:6px; border-radius:3px"></div>
        <div class="skeleton-block skeleton" style="height:11px; width:32%; border-radius:3px"></div>
      </div>
    </li>
  `).join('');
}

// ═══════════════════════════════════════════════════════════════════
//  CHESS GAME HELPERS
// ═══════════════════════════════════════════════════════════════════

/** Extract piece-placement FEN from a Chess.com PGN string */
function extractFen(pgn) {
  if (!pgn || typeof Chess === 'undefined') return '';
  try {
    const chess = new Chess();
    chess.load_pgn(pgn.trim());
    return chess.fen().split(' ')[0];
  } catch { return ''; }
}

/** Count half-moves from a PGN move-number scan */
function estimateMoveCount(pgn) {
  if (!pgn) return 0;
  const matches = pgn.match(/\d+\./g);
  return matches ? matches.length : 0;
}

/**
 * Determine result for a game's white/black from Chess.com result codes.
 * Returns: 'win' | 'loss' | 'draw'
 */
const LOSS_RESULTS = new Set([
  'checkmated','timeout','resigned','lose','abandoned','bughousepartnerlose',
]);
const DRAW_RESULTS = new Set([
  'agreed','repetition','stalemate','insufficient','50move',
  'timevsinsufficient','insufficient material',
]);

function classifyResult(resultCode) {
  if (!resultCode) return 'draw';
  if (resultCode === 'win') return 'win';
  if (LOSS_RESULTS.has(resultCode)) return 'loss';
  return 'draw';
}

/** Get the standardised game result string (1-0 / 0-1 / 1/2-1/2) */
function gameResultString(game) {
  const wr = classifyResult(game.white?.result);
  if (wr === 'win') return '1-0';
  const br = classifyResult(game.black?.result);
  if (br === 'win') return '0-1';
  return '1/2-1/2';
}

/**
 * Auto-generate a short, elegant blurb for the Game of the Month.
 * Picks the most interesting fact about the game.
 */
function buildGotmBlurb({ winner, myAccuracy, ratingDiff, moveCount }) {
  if (myAccuracy != null && myAccuracy >= 90) {
    return `A near-perfect game — ${escHtml(winner)} played with ${myAccuracy.toFixed(1)}% accuracy.`;
  }
  if (ratingDiff >= 150) {
    return `A bold upset — ${escHtml(winner)} defeated an opponent rated ${ratingDiff} points higher.`;
  }
  if (ratingDiff >= 80) {
    return `${escHtml(winner)} punched above their weight, beating a higher-rated opponent in fine style.`;
  }
  if (moveCount >= 50) {
    return `A ${moveCount}-move masterpiece of endgame technique by ${escHtml(winner)}.`;
  }
  if (myAccuracy != null) {
    return `Decided with precision — ${escHtml(winner)} converted a sharp middlegame with ${myAccuracy.toFixed(1)}% accuracy.`;
  }
  return `${escHtml(winner)} delivered an impressive performance in a competitive clash.`;
}

// ═══════════════════════════════════════════════════════════════════
//  MONTHLY DATA ENGINE  (shared by POTM + GOTM)
// ═══════════════════════════════════════════════════════════════════

/** Single promise shared between POTM and GOTM — computed once per session */
let _monthlyDataPromise = null;

function getMonthlyData() {
  if (!_monthlyDataPromise) _monthlyDataPromise = computeMonthlyData();
  return _monthlyDataPromise;
}

/**
 * Fetch game archives for all active members, compute:
 *   - POTM: member with highest score (wins×3 + draws - losses×0.5)
 *   - GOTM: best-scored game across all member archives
 *
 * Results are cached for 6 hours under key `monthly:{MONTH_KEY}`.
 */
async function computeMonthlyData() {
  // Return cached monthly result if available
  const cacheKey = `monthly:${MONTH_KEY}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  // ── 1. Fetch club members ─────────────────────────────────────────
  const membersData = await apiFetch(
    `${CONFIG.API_BASE}/club/${CONFIG.CLUB_ID}/members`,
    'club:members',
    CONFIG.TTL.MEMBERS
  );

  // Use weekly active members as primary candidates
  const weekly  = membersData.weekly  || [];
  const monthly = membersData.monthly || [];
  const seen    = new Set();
  const candidates = [...weekly, ...monthly]
    .filter(({ username }) => {
      if (seen.has(username)) return false;
      seen.add(username);
      return true;
    })
    .slice(0, CONFIG.MAX_CANDIDATES);

  // ── 2. Fetch game archives (serial, rate-limit safe) ──────────────
  const memberStats = []; // { username, wins, losses, draws, games[] }

  for (const member of candidates) {
    await sleep(CONFIG.ENRICH_DELAY_MS);
    try {
      const archiveData = await apiFetch(
        `${CONFIG.API_BASE}/player/${member.username}/games/${YEAR}/${MONTH_NUM}`,
        `archives:${member.username}:${MONTH_KEY}`,
        CONFIG.TTL.ARCHIVES
      );

      const allGames = archiveData.games || [];
      // Filter to rated rapid + blitz only (most meaningful for a leaderboard)
      const games = allGames.filter(
        (g) => g.rated && (g.time_class === 'rapid' || g.time_class === 'blitz')
      );

      let wins = 0, losses = 0, draws = 0;

      for (const game of games) {
        const isWhite = game.white?.username?.toLowerCase() === member.username.toLowerCase();
        const resultCode = isWhite ? game.white?.result : game.black?.result;
        const r = classifyResult(resultCode);
        if (r === 'win')       wins++;
        else if (r === 'loss') losses++;
        else                   draws++;
      }

      const totalGames = wins + losses + draws;
      if (totalGames < CONFIG.MIN_GAMES) continue;

      memberStats.push({ username: member.username, wins, losses, draws, totalGames, games });
    } catch {
      // Member has no archive or API error — skip silently
    }
  }

  // ── 3. Compute POTM ───────────────────────────────────────────────
  let potm = null;

  if (memberStats.length > 0) {
    // Score = wins×3 + draws - losses×0.5, tiebreak by win %
    const ranked = [...memberStats].sort((a, b) => {
      const scoreA = a.wins * 3 + a.draws - a.losses * 0.5;
      const scoreB = b.wins * 3 + b.draws - b.losses * 0.5;
      if (scoreB !== scoreA) return scoreB - scoreA;
      const rateA = a.wins / (a.totalGames || 1);
      const rateB = b.wins / (b.totalGames || 1);
      return rateB - rateA;
    });

    const winner = ranked[0];

    // Fetch winner's profile + stats for rating and avatar
    let avatar  = null;
    let rating  = null;
    let format  = 'Rapid';

    try {
      await sleep(CONFIG.ENRICH_DELAY_MS);
      const player = await apiFetch(
        `${CONFIG.API_BASE}/player/${winner.username}`,
        `player:${winner.username}`,
        CONFIG.TTL.PLAYER
      );
      avatar = player.avatar || null;
    } catch { /* silent */ }

    try {
      await sleep(CONFIG.ENRICH_DELAY_MS);
      const stats = await apiFetch(
        `${CONFIG.API_BASE}/player/${winner.username}/stats`,
        `stats:${winner.username}`,
        CONFIG.TTL.STATS
      );
      const rapid  = stats?.chess_rapid?.last?.rating  || 0;
      const blitz  = stats?.chess_blitz?.last?.rating  || 0;
      const bullet = stats?.chess_bullet?.last?.rating || 0;
      if (rapid >= blitz && rapid >= bullet) { rating = rapid; format = 'Rapid'; }
      else if (blitz >= bullet)             { rating = blitz; format = 'Blitz'; }
      else                                  { rating = bullet; format = 'Bullet'; }
    } catch { /* silent */ }

    potm = {
      username:   winner.username,
      wins:       winner.wins,
      losses:     winner.losses,
      draws:      winner.draws,
      totalGames: winner.totalGames,
      rating,
      format,
      avatar,
      month: MONTH_LABEL,
    };
  }

  // ── 4. Compute GOTM ───────────────────────────────────────────────
  let gotm  = null;
  let bestScore = -Infinity;

  for (const { username, games } of memberStats) {
    for (const game of games) {
      const isWhite = game.white?.username?.toLowerCase() === username.toLowerCase();
      const resultCode = isWhite ? game.white?.result : game.black?.result;

      // Only consider wins for GOTM
      if (classifyResult(resultCode) !== 'win') continue;

      const myRating  = Number(isWhite ? game.white?.rating  : game.black?.rating)  || 0;
      const oppRating = Number(isWhite ? game.black?.rating  : game.white?.rating)  || 0;
      const myAccuracy = game.accuracies
        ? Number(isWhite ? game.accuracies.white : game.accuracies.black)
        : null;

      const ratingDiff = oppRating - myRating; // positive = upset
      const moveCount  = estimateMoveCount(game.pgn);

      // Composite score (higher = more interesting game)
      let score = 0;
      if (myAccuracy != null) score += myAccuracy * 2.0; // 0–200
      score += Math.max(0, ratingDiff) * 0.8;             // upset bonus
      score += Math.min(moveCount, 60) * 0.5;             // length bonus

      if (score > bestScore) {
        bestScore = score;
        const winner = isWhite ? game.white?.username : game.black?.username;
        const fen    = extractFen(game.pgn);

        gotm = {
          white:     game.white?.username  || '?',
          black:     game.black?.username  || '?',
          whiteRating: game.white?.rating  || null,
          blackRating: game.black?.rating  || null,
          result:    gameResultString(game),
          url:       game.url || 'https://www.chess.com/games',
          fen,
          blurb: buildGotmBlurb({
            winner,
            myAccuracy,
            ratingDiff: Math.max(0, ratingDiff),
            moveCount,
          }),
        };
      }
    }
  }

  const result = { potm, gotm, memberStats };
  cache.set(cacheKey, result, CONFIG.TTL.MONTHLY);
  return result;
}

// ═══════════════════════════════════════════════════════════════════
//  SECTION 1 — CLUB HEADER
// ═══════════════════════════════════════════════════════════════════
async function loadHeader() {
  const data = await apiFetch(
    `${CONFIG.API_BASE}/club/${CONFIG.CLUB_ID}`,
    'club:profile',
    CONFIG.TTL.CLUB
  );

  const iconEl     = document.getElementById('club-icon');
  const fallbackEl = document.getElementById('club-icon-fallback');
  const nameEl     = document.getElementById('club-name');
  const subEl      = document.getElementById('club-sub');
  const descEl     = document.getElementById('club-desc');
  const linkEl     = document.getElementById('club-link');

  if (data.icon) {
    iconEl.src    = data.icon;
    iconEl.onload = () => { iconEl.classList.add('loaded'); fallbackEl.classList.add('hidden'); };
  }

  nameEl.textContent = data.name || 'Elegance';

  const count = data.members_count != null ? Number(data.members_count).toLocaleString() : '–';
  const year  = data.created ? extractYear(data.created) : '';
  subEl.innerHTML = `
    <span class="gold">${escHtml(count)}</span>
    <span class="sep">·</span>
    Est. ${escHtml(String(year))}
  `;

  if (data.description && data.description.trim()) {
    const tmp = document.createElement('div');
    tmp.innerHTML = data.description;
    descEl.textContent = tmp.textContent || tmp.innerText || '';
  }

  if (data.url) linkEl.href = data.url;
}

// ═══════════════════════════════════════════════════════════════════
//  SECTION 2 — NEW TO THE CLUB
// ═══════════════════════════════════════════════════════════════════
async function loadJoiners() {
  const list = document.getElementById('joiners-list');
  list.innerHTML = skeletonMemberList(CONFIG.MAX_JOINERS);

  const membersData = await apiFetch(
    `${CONFIG.API_BASE}/club/${CONFIG.CLUB_ID}/members`,
    'club:members',
    CONFIG.TTL.MEMBERS
  );

  const seen = new Set();
  const combined = [...(membersData.weekly || []), ...(membersData.monthly || [])]
    .filter(({ username }) => {
      if (seen.has(username)) return false;
      seen.add(username);
      return true;
    });

  const recent = combined
    .sort((a, b) => (b.joined || 0) - (a.joined || 0))
    .slice(0, CONFIG.MAX_JOINERS);

  if (recent.length === 0) {
    list.innerHTML = `<li class="empty-state">No recent joiners found.</li>`;
    return;
  }

  list.innerHTML = '';
  recent.forEach((member, i) => {
    const li = document.createElement('li');
    li.className = 'member-item';
    li.style.animationDelay = `${i * 0.08}s`;
    li.id = `member-row-${i}`;
    li.innerHTML = `
      <div class="member-avatar-placeholder" id="member-ph-${i}">
        ${escHtml(member.username.charAt(0).toUpperCase())}
      </div>
      <div class="member-info">
        <div class="member-name" id="member-name-${i}">${escHtml(member.username)}</div>
        <div class="member-time">
          ${member.joined ? relativeTime(member.joined) : 'Recently joined'}
        </div>
      </div>
    `;
    list.appendChild(li);
  });

  for (let i = 0; i < Math.min(recent.length, CONFIG.MAX_ENRICH); i++) {
    await sleep(CONFIG.ENRICH_DELAY_MS);
    await enrichMemberRow(recent[i].username, i);
  }
}

async function enrichMemberRow(username, idx) {
  try {
    const player = await apiFetch(
      `${CONFIG.API_BASE}/player/${username}`,
      `player:${username}`,
      CONFIG.TTL.PLAYER
    );

    const ph     = document.getElementById(`member-ph-${idx}`);
    const nameEl = document.getElementById(`member-name-${idx}`);
    const row    = document.getElementById(`member-row-${idx}`);
    if (!ph || !nameEl || !row) return;

    if (player.avatar) {
      const img     = document.createElement('img');
      img.className = 'member-avatar';
      img.src       = player.avatar;
      img.alt       = username;
      img.onerror   = () => {
        const repl = document.createElement('div');
        repl.className   = 'member-avatar-placeholder';
        repl.textContent = username.charAt(0).toUpperCase();
        img.replaceWith(repl);
      };
      ph.replaceWith(img);
    } else {
      ph.textContent = username.charAt(0).toUpperCase();
    }

    if (player.title) {
      nameEl.innerHTML = `<span class="member-title">${escHtml(player.title)}</span>${escHtml(username)}`;
    }

    if (player.country) {
      const code = player.country.split('/').pop().toUpperCase();
      const flag = countryCodeToFlag(code);
      if (flag) {
        const span = document.createElement('span');
        span.className   = 'member-country';
        span.textContent = flag;
        span.title       = code;
        row.appendChild(span);
      }
    }
  } catch { /* silent */ }
}

// ═══════════════════════════════════════════════════════════════════
//  SECTION 3 — PLAYER OF THE MONTH  (live-computed)
// ═══════════════════════════════════════════════════════════════════
async function loadPlayerOfMonth() {
  const card = document.getElementById('potm-card');

  // Show computing state
  card.innerHTML = `
    <div class="potm-loading">
      <div class="potm-avatar-placeholder skeleton" style="border:none;color:transparent;flex-shrink:0"></div>
      <div class="potm-info" style="flex:1">
        <div class="skeleton-block skeleton" style="height:14px;width:55%;border-radius:3px;margin-bottom:8px"></div>
        <div class="skeleton-block skeleton" style="height:11px;width:38%;border-radius:3px;margin-bottom:6px"></div>
        <div class="skeleton-block skeleton" style="height:10px;width:28%;border-radius:3px"></div>
      </div>
    </div>
  `;

  try {
    const { potm } = await getMonthlyData();
    if (!potm) {
      card.innerHTML = `<div class="empty-state" style="width:100%">No games recorded for ${MONTH_LABEL} yet.</div>`;
      return;
    }
    renderPotmCard(card, potm);
  } catch (e) {
    console.error('[Elegance] POTM failed:', e);
    card.innerHTML = `<div class="empty-state" style="width:100%">Player of the Month could not be computed.</div>`;
  }
}

function renderPotmCard(card, potm) {
  const avatarHtml = potm.avatar
    ? `<img class="potm-avatar" src="${escHtml(potm.avatar)}" alt="${escHtml(potm.username)}"
            onerror="this.outerHTML='<div class=\\'potm-avatar-placeholder\\'>♛</div>'">`
    : `<div class="potm-avatar-placeholder">♛</div>`;

  const ratingStr = potm.rating ? `${escHtml(potm.format)} ${Number(potm.rating).toLocaleString()}` : '';

  const wld = `
    <span class="potm-wld">
      <span class="wld-w" title="Wins">${potm.wins}W</span>
      <span class="wld-sep">/</span>
      <span class="wld-l" title="Losses">${potm.losses}L</span>
      <span class="wld-sep">/</span>
      <span class="wld-d" title="Draws">${potm.draws}D</span>
      <span class="wld-games"> · ${potm.totalGames} games</span>
    </span>
  `;

  card.innerHTML = `
    ${avatarHtml}
    <div class="potm-info">
      <div class="potm-name">${escHtml(potm.username)}</div>
      ${ratingStr ? `<div class="potm-rating">${ratingStr}</div>` : ''}
      <div class="potm-rating" style="margin-top:4px">${wld}</div>
      <div class="potm-month">${escHtml(potm.month)}</div>
    </div>
  `;
}

// ═══════════════════════════════════════════════════════════════════
//  SECTION 4 — GAME OF THE MONTH  (live-computed)
// ═══════════════════════════════════════════════════════════════════
async function loadGameOfMonth() {
  const card = document.getElementById('gotm-card');

  card.innerHTML = `<div class="skeleton-block skeleton" style="height:220px;border-radius:8px"></div>`;

  try {
    const { gotm } = await getMonthlyData();
    if (!gotm) {
      card.innerHTML = `<div class="empty-state">No games found for ${MONTH_LABEL} yet.</div>`;
      return;
    }
    renderGotmCard(card, gotm);
  } catch (e) {
    console.error('[Elegance] GOTM failed:', e);
    card.innerHTML = `<div class="empty-state">Game of the Month could not be computed.</div>`;
  }
}

function renderGotmCard(card, gotm) {
  const resultDisplay =
    gotm.result === '1-0' ? '1–0' :
    gotm.result === '0-1' ? '0–1' : '½–½';

  const whiteRatingStr = gotm.whiteRating ? `<span class="gotm-player-rating">${gotm.whiteRating}</span>` : '';
  const blackRatingStr = gotm.blackRating ? `<span class="gotm-player-rating">${gotm.blackRating}</span>` : '';

  card.innerHTML = `
    <div class="gotm-matchup">
      <div class="gotm-player">
        <div class="gotm-player-name" title="${escHtml(gotm.white)}">${escHtml(gotm.white)}</div>
        ${whiteRatingStr}
        <div class="gotm-player-color">White</div>
      </div>
      <div class="gotm-vs">${resultDisplay}</div>
      <div class="gotm-player">
        <div class="gotm-player-name" title="${escHtml(gotm.black)}">${escHtml(gotm.black)}</div>
        ${blackRatingStr}
        <div class="gotm-player-color">Black</div>
      </div>
    </div>
    <div class="gotm-board-wrap">
      <div id="gotm-board"></div>
    </div>
    <p class="gotm-blurb">"${gotm.blurb}"</p>
    <a class="gotm-replay-btn"
       href="${escHtml(gotm.url)}"
       target="_blank"
       rel="noopener noreferrer"
       id="gotm-replay-link">
      ▶ &nbsp;Replay on Chess.com
    </a>
  `;

  renderChessBoard(gotm.fen, '');
}

// ── SVG CHESS BOARD RENDERER (no external deps) ─────────────────
const PIECE_GLYPHS = {
  K:'♔', Q:'♕', R:'♖', B:'♗', N:'♘', P:'♙',
  k:'♚', q:'♛', r:'♜', b:'♝', n:'♞', p:'♟',
};

function renderChessBoard(fen, pgn) {
  const container = document.getElementById('gotm-board');
  if (!container) return;

  let position = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR';

  if (fen && fen.trim()) {
    position = fen.trim().split(' ')[0];
  } else if (pgn && pgn.trim() && typeof Chess !== 'undefined') {
    try {
      const chess = new Chess();
      chess.load_pgn(pgn.trim());
      position = chess.fen().split(' ')[0];
    } catch (e) {
      console.warn('[Elegance] PGN parse failed:', e);
    }
  }

  const rows   = position.split('/');
  const grid   = rows.map(row => {
    const cells = [];
    for (const ch of row) {
      if (/\d/.test(ch)) for (let i = 0; i < parseInt(ch); i++) cells.push('');
      else cells.push(ch);
    }
    return cells;
  });

  const LIGHT_SQ = '#E4D9BF';
  const DARK_SQ  = '#2C2417';
  const WHITE_PC = '#F5F1E8';
  const BLACK_PC = '#1A1208';
  const SQ_SIZE  = 36;
  const BOARD    = SQ_SIZE * 8;

  const svgNS = 'http://www.w3.org/2000/svg';
  const svg   = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${BOARD} ${BOARD}`);
  svg.setAttribute('width',  '100%');
  svg.setAttribute('height', '100%');
  svg.style.display = 'block';

  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const isLight = (r + f) % 2 === 0;
      const x = f * SQ_SIZE;
      const y = r * SQ_SIZE;

      const rect = document.createElementNS(svgNS, 'rect');
      rect.setAttribute('x', x);
      rect.setAttribute('y', y);
      rect.setAttribute('width',  SQ_SIZE);
      rect.setAttribute('height', SQ_SIZE);
      rect.setAttribute('fill', isLight ? LIGHT_SQ : DARK_SQ);
      svg.appendChild(rect);

      const piece = grid[r]?.[f] || '';
      if (piece) {
        const glyph   = PIECE_GLYPHS[piece];
        const isWhite = piece === piece.toUpperCase();
        if (glyph) {
          const text = document.createElementNS(svgNS, 'text');
          text.setAttribute('x',   x + SQ_SIZE / 2);
          text.setAttribute('y',   y + SQ_SIZE / 2 + 1);
          text.setAttribute('text-anchor',        'middle');
          text.setAttribute('dominant-baseline',  'central');
          text.setAttribute('font-size',          SQ_SIZE * 0.72);
          text.setAttribute('fill',   isWhite ? WHITE_PC : BLACK_PC);
          text.setAttribute('stroke', isWhite ? '#6B5D3A' : '#C9A959');
          text.setAttribute('stroke-width', '0.4');
          text.setAttribute('paint-order', 'stroke');
          text.textContent = glyph;
          svg.appendChild(text);
        }
      }
    }
  }

  const border = document.createElementNS(svgNS, 'rect');
  border.setAttribute('x',       '0.5');
  border.setAttribute('y',       '0.5');
  border.setAttribute('width',   BOARD - 1);
  border.setAttribute('height',  BOARD - 1);
  border.setAttribute('fill',    'none');
  border.setAttribute('stroke',  '#C9A959');
  border.setAttribute('stroke-width', '1');
  svg.appendChild(border);

  container.innerHTML = '';
  container.appendChild(svg);
}

// ═══════════════════════════════════════════════════════════════════
//  SECTIONS 5 + 6 + 7 — MATCHES (Vote + Daily + Upcoming)
// ═══════════════════════════════════════════════════════════════════
async function loadMatches() {
  const data = await apiFetch(
    `${CONFIG.API_BASE}/club/${CONFIG.CLUB_ID}/matches`,
    'club:matches',
    CONFIG.TTL.MATCHES
  );

  const inProgress = data.in_progress || [];
  const registered = data.registered  || [];
  const finished   = data.finished    || [];

  const isVote     = (m) => /vote/i.test(m.name || '');
  const voteActive = [...inProgress.filter(isVote), ...registered.filter(isVote)];
  const dailyInProg = inProgress.filter((m) => !isVote(m));
  const dailyReg    = registered.filter((m) => !isVote(m));
  const dailyFin    = finished.filter((m)   => !isVote(m)).slice(0, CONFIG.MAX_FINISHED);

  renderVoteChess(voteActive);
  renderDailyMatches(dailyInProg, dailyReg, dailyFin);
  await renderUpcomingEvents(registered);
}

function renderVoteChess(matches) {
  const container = document.getElementById('vote-list');
  if (!matches.length) {
    container.innerHTML = `<div class="empty-state">No active Vote Chess matches.</div>`;
    return;
  }

  container.innerHTML = '';
  matches.slice(0, CONFIG.MAX_VOTE).forEach((m, i) => {
    const isLive  = /\/in-progress\//i.test(m['@id'] || '');
    const oppName = getOpponentName(m);
    const card    = document.createElement('div');
    card.className = 'match-card';
    card.style.animationDelay = `${i * 0.08}s`;

    let timePart = '';
    if (m.start_time) {
      const d = formatDateParts(m.start_time);
      timePart = `<span class="match-time">${d.dayName} ${d.dayNum} ${d.monthStr}</span>`;
    }

    card.innerHTML = `
      <div class="match-opponent">vs ${escHtml(oppName)}</div>
      <div class="match-meta">
        <span class="badge ${isLive ? 'badge--live' : 'badge--registered'}">
          ${isLive ? 'In Progress' : 'Registered'}
        </span>
        ${timePart}
      </div>
    `;
    container.appendChild(card);
  });

  if (matches.length > CONFIG.MAX_VOTE) {
    const more = document.createElement('div');
    more.className   = 'empty-state';
    more.style.marginTop = '4px';
    more.textContent = `+${matches.length - CONFIG.MAX_VOTE} more vote chess match${matches.length - CONFIG.MAX_VOTE > 1 ? 'es' : ''}`;
    container.appendChild(more);
  }
}

function renderDailyMatches(inProg, registered, finished) {
  const container = document.getElementById('matches-list');
  if (!inProg.length && !registered.length && !finished.length) {
    container.innerHTML = `<div class="empty-state">No active daily matches.</div>`;
    return;
  }

  container.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex;flex-direction:column;gap:8px';

  if (inProg.length) {
    const row = document.createElement('div');
    row.className = 'match-bucket-row';
    row.innerHTML = `
      <span class="match-bucket-label"><span class="badge badge--live">In Progress</span></span>
      <span class="match-bucket-count">${inProg.length}</span>
    `;
    wrap.appendChild(row);

    inProg.slice(0, 3).forEach((m) => {
      const card = document.createElement('div');
      card.className = 'match-card';
      card.style.cssText = 'margin-top:-4px;border-top:none;border-radius:0 0 10px 10px';
      card.innerHTML = `<div class="match-opponent">vs ${escHtml(getOpponentName(m))}</div>`;
      wrap.appendChild(card);
    });
  }

  if (registered.length) {
    const row = document.createElement('div');
    row.className = 'match-bucket-row';
    row.innerHTML = `
      <span class="match-bucket-label"><span class="badge badge--registered">Registered</span></span>
      <span class="match-bucket-count">${registered.length}</span>
    `;
    wrap.appendChild(row);
  }

  if (finished.length) {
    const hdr = document.createElement('div');
    hdr.style.cssText = 'font-size:10px;text-transform:uppercase;letter-spacing:.12em;color:var(--ivory-faint);padding:4px 2px 2px;font-weight:500';
    hdr.textContent = 'Recent Results';
    wrap.appendChild(hdr);

    finished.forEach((m) => {
      const result     = (m.result || '').toLowerCase();
      const badgeClass = result === 'win' ? 'badge--win' : result === 'loss' ? 'badge--loss' : 'badge--draw';
      const label      = result === 'win' ? 'Win' : result === 'loss' ? 'Loss' : 'Draw';
      const card = document.createElement('div');
      card.className = 'match-card';
      card.innerHTML = `
        <div class="match-opponent">vs ${escHtml(getOpponentName(m))}</div>
        <div class="match-meta">
          <span class="badge ${badgeClass}">${label}</span>
          <span class="match-time">Finished</span>
        </div>
      `;
      wrap.appendChild(card);
    });
  }

  container.appendChild(wrap);
}

async function renderUpcomingEvents(registeredMatches) {
  const list = document.getElementById('events-list');
  list.innerHTML = '';

  const matchEvents = registeredMatches
    .filter((m) => m.start_time || m.name)
    .map((m) => ({
      title:      m.name || `vs ${getOpponentName(m)}`,
      subtitle:   `Team Match · ${(m.time_class || 'daily').replace(/_/g, ' ')}`,
      start_time: m.start_time || null,
      url:        m['@id']     || null,
      source:     'api',
    }));

  const all = matchEvents.sort((a, b) => {
    if (a.start_time && b.start_time) return a.start_time - b.start_time;
    if (a.start_time) return -1;
    if (b.start_time) return  1;
    return 0;
  });

  if (!all.length) {
    list.innerHTML = `<li class="empty-state">No upcoming events.</li>`;
    return;
  }

  all.slice(0, CONFIG.MAX_EVENTS).forEach((evt, i) => {
    const li = document.createElement('li');
    li.className = 'event-item';
    li.style.animationDelay = `${i * 0.07}s`;

    let dateBlock;
    if (evt.start_time) {
      const d = formatDateParts(evt.start_time);
      dateBlock = `
        <div class="event-date">
          <span class="event-day-name">${d.dayName}</span>
          <span class="event-day-num">${d.dayNum}</span>
          <span class="event-month-str">${d.monthStr}</span>
        </div>
      `;
    } else {
      dateBlock = `
        <div class="event-date">
          <span class="event-day-name" style="font-size:8px">Date</span>
          <span class="event-day-num" style="font-size:14px;line-height:1.3">TBA</span>
          <span class="event-month-str"></span>
        </div>
      `;
    }

    li.innerHTML = `
      ${dateBlock}
      <div class="event-info">
        <div class="event-title">${escHtml(evt.title || 'Upcoming Event')}</div>
        ${evt.subtitle   ? `<div class="event-sub">${escHtml(evt.subtitle)}</div>` : ''}
        ${evt.start_time ? `<div class="event-sub">${formatDateParts(evt.start_time).timeStr}</div>` : ''}
      </div>
    `;

    if (evt.url) {
      li.style.cursor = 'pointer';
      li.addEventListener('click', () => window.open(evt.url, '_blank', 'noopener,noreferrer'));
    }

    list.appendChild(li);
  });
}

// ═══════════════════════════════════════════════════════════════════
//  SECTION 8 — DAILY PUZZLE
// ═══════════════════════════════════════════════════════════════════
async function loadPuzzle() {
  const card = document.getElementById('puzzle-card');
  try {
    const puzzle = await apiFetch(
      `${CONFIG.API_BASE}/puzzle`,
      'puzzle:daily',
      CONFIG.TTL.PUZZLE
    );

    card.innerHTML = `
      ${puzzle.image ? `
        <a href="${escHtml(puzzle.url || 'https://www.chess.com/puzzles')}" target="_blank" rel="noopener noreferrer" id="puzzle-img-link">
          <img class="puzzle-image" src="${escHtml(puzzle.image)}" alt="${escHtml(puzzle.title || 'Daily chess puzzle')}" loading="lazy">
        </a>
      ` : ''}
      ${puzzle.title ? `<div class="puzzle-title">${escHtml(puzzle.title)}</div>` : ''}
      <p class="puzzle-sub">Study the position, then solve on Chess.com.</p>
      <a class="puzzle-link"
         href="${escHtml(puzzle.url || 'https://www.chess.com/puzzles')}"
         target="_blank" rel="noopener noreferrer"
         id="puzzle-solve-link">
        ▶ &nbsp;Solve Today's Puzzle
      </a>
    `;
  } catch {
    card.innerHTML = `
      <p class="puzzle-sub" style="font-style:italic;color:var(--ivory-faint)">Today's puzzle could not be loaded.</p>
      <a class="puzzle-link" href="https://www.chess.com/puzzles" target="_blank" rel="noopener noreferrer" id="puzzle-fallback-link">
        ▶ &nbsp;Browse Puzzles
      </a>
    `;
  }
}

// ═══════════════════════════════════════════════════════════════════
//  FOOTER
// ═══════════════════════════════════════════════════════════════════
function updateFooter() {
  const el = document.getElementById('footer-refresh');
  if (!el) return;
  el.textContent = `Refreshed just now`;
  setTimeout(() => {
    if (el) el.textContent = `Refreshed ${relativeTime(Math.floor(Date.now() / 1000))}`;
  }, 60_000);
}

// ═══════════════════════════════════════════════════════════════════
//  INIT
// ═══════════════════════════════════════════════════════════════════
async function init() {
  try {
    await loadHeader();
  } catch (e) {
    console.error('[Elegance] Header failed:', e);
  }

  await Promise.allSettled([
    loadJoiners(),
    loadPlayerOfMonth(),
    loadGameOfMonth(),
    loadMatches(),
    loadPuzzle(),
  ]);

  updateFooter();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
