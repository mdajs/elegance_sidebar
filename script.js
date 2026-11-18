/* ♛ ELEGANCE CHESS CLUB SIDEBAR — SCRIPT
 * ─────────────────────────────────────────────────────────────────────
 * Pulls live data from Chess.com's public PubAPI (no API key required).
 * All sections use localStorage caching + serial enrichment requests
 * to stay within Chess.com's rate-limit guidelines.
 *
 * POTM & GOTW are computed live from member game archives:
 *   - POTM  → member with the most Elo/rating gained this month
 *   - GOTW  → best game of the current week scored by: accuracy > upset > length
 * ─────────────────────────────────────────────────────────────────────
 */

'use strict';

// ═══════════════════════════════════════════════════════════════════
//  CURRENT MONTH & WEEK CONSTANTS
// ═══════════════════════════════════════════════════════════════════
const _NOW        = new Date();
const YEAR        = _NOW.getFullYear();
const MONTH_NUM   = String(_NOW.getMonth() + 1).padStart(2, '0');
const MONTH_KEY   = `${YEAR}-${MONTH_NUM}`;
const MONTH_LABEL = _NOW.toLocaleString('en-US', { month: 'long', year: 'numeric' });

// Week boundaries (Monday 00:00 → Sunday 23:59)
const _dayOfWeek   = _NOW.getDay(); // 0=Sun … 6=Sat
const _mondayDiff  = _dayOfWeek === 0 ? 6 : _dayOfWeek - 1;
const WEEK_START   = new Date(YEAR, _NOW.getMonth(), _NOW.getDate() - _mondayDiff);
WEEK_START.setHours(0, 0, 0, 0);
const WEEK_START_TS = Math.floor(WEEK_START.getTime() / 1000);
const WEEK_END_TS   = WEEK_START_TS + 7 * 86400;
const WEEK_KEY      = `${YEAR}-W${String(Math.ceil(((_NOW - new Date(YEAR, 0, 1)) / 86400000 + new Date(YEAR, 0, 1).getDay()) / 7)).padStart(2, '0')}`;
const WEEK_LABEL    = `Week of ${WEEK_START.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;

// ═══════════════════════════════════════════════════════════════════
//  CONFIG
// ═══════════════════════════════════════════════════════════════════
const CONFIG = {
  CLUB_ID:            'club-d823d67a',
  CLUB_NAME_OVERRIDE: '夢 • <i>Yume</i>',
  API_BASE:           'https://api.chess.com/pub',
  PROXY_URL:          'https://api.allorigins.win/raw?url=',
  useProxy:           false,

  TTL: {
    CLUB:      60 * 1000,          //  1 min
    MEMBERS:   20 * 1000,          // 20 sec (real-time fast refresh for members & joiners)
    MATCHES:   60 * 1000,          //  1 min
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
//  FETCH HELPER  (CORS-proxy auto-fallback + true cache-busting)
// ═══════════════════════════════════════════════════════════════════
async function apiFetch(url, cacheKey = null, ttl = 0, bypassCache = false) {
  if (cacheKey && !bypassCache) {
    const hit = cache.get(cacheKey);
    if (hit !== null) return hit;
  }

  const attempt = async (targetUrl) => {
    const res = await fetch(targetUrl, { headers: { Accept: 'application/json' }, cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status} — ${targetUrl}`);
    return res.json();
  };

  let reqUrl = url;
  if (bypassCache) {
    reqUrl += (reqUrl.includes('?') ? '&' : '?') + '_t=' + Date.now();
  }

  let data;
  if (CONFIG.useProxy) {
    data = await attempt(CONFIG.PROXY_URL + encodeURIComponent(reqUrl));
  } else {
    try {
      data = await attempt(reqUrl);
    } catch (err) {
      if (err instanceof TypeError || (err.message && err.message.includes('Failed to fetch'))) {
        console.info('[Elegance] CORS detected — switching to proxy.');
        CONFIG.useProxy = true;
        data = await attempt(CONFIG.PROXY_URL + encodeURIComponent(reqUrl));
      } else {
        throw err;
      }
    }
  }

  if (cacheKey && ttl) cache.set(cacheKey, data, ttl);
  return data;
}

// Shared in-memory cache for live member data to avoid duplicate fetches across widgets
let _membersDataCache = null;
let _membersDataTime = 0;

/**
 * Shared fetcher for club members: allows member counter, new joiners & pulse
 * to share fresh member data in real time without redundant API calls.
 */
async function getClubMembers(bypassCache = false) {
  if (!bypassCache && _membersDataCache && Date.now() - _membersDataTime < CONFIG.TTL.MEMBERS) {
    return _membersDataCache;
  }
  // Debounce successive network requests within 2 seconds
  if (bypassCache && _membersDataCache && Date.now() - _membersDataTime < 2000) {
    return _membersDataCache;
  }

  const data = await apiFetch(
    `${CONFIG.API_BASE}/club/${CONFIG.CLUB_ID}/members`,
    'club:members',
    CONFIG.TTL.MEMBERS,
    bypassCache
  );
  _membersDataCache = data;
  _membersDataTime = Date.now();
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
  const matches = [...pgn.matchAll(/(?:^|\s)(\d+)\.(?!\.)/g)];
  if (!matches.length) return 0;
  let maxMove = 0;
  for (const m of matches) {
    const num = parseInt(m[1], 10);
    if (num > maxMove) maxMove = num;
  }
  return maxMove;
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
//  MONTHLY DATA ENGINE  (shared by POTM + GOTW)
// ═══════════════════════════════════════════════════════════════════

/** Single promise shared between POTM and GOTW — computed once per session */
let _monthlyDataPromise = null;

function getMonthlyData() {
  if (!_monthlyDataPromise) _monthlyDataPromise = computeMonthlyData();
  return _monthlyDataPromise;
}

/**
 * Fetch game archives for all active members, compute:
 *   - POTM: member with the most Elo/rating gained this month
 *           (compares first game rating of the month vs current rating)
 *   - GOTW: best-scored game from this week (Monday→Sunday)
 *
 * POTM is cached for the entire month. GOTW is cached for the week.
 */
async function computeMonthlyData() {
  // Return cached monthly result if available (v4 = new Elo-gain + GOTW formula)
  const cacheKey = `monthly:v4:${MONTH_KEY}:${WEEK_KEY}`;
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

  // ── 2. Fetch profiles, stats, and archives (serial, rate-limit safe) ──────────────
  const activeProfiles = [];
  const memberStats = []; 

  for (const member of candidates) {
    // A. Profile
    await sleep(CONFIG.ENRICH_DELAY_MS);
    let player = null, stats = null;
    try {
      player = await apiFetch(`${CONFIG.API_BASE}/player/${member.username}`, `player:${member.username}`, CONFIG.TTL.PLAYER);
    } catch { continue; } // skip if error

    // B. Stats
    await sleep(CONFIG.ENRICH_DELAY_MS);
    try {
      stats = await apiFetch(`${CONFIG.API_BASE}/player/${member.username}/stats`, `stats:${member.username}`, CONFIG.TTL.STATS);
    } catch { /* silent */ }

    let rating = 0, format = 'Rapid';
    if (stats) {
      const rapid  = stats.chess_rapid?.last?.rating  || 0;
      const blitz  = stats.chess_blitz?.last?.rating  || 0;
      const bullet = stats.chess_bullet?.last?.rating || 0;
      if (rapid >= blitz && rapid >= bullet) { rating = rapid; format = 'Rapid'; }
      else if (blitz >= bullet)             { rating = blitz; format = 'Blitz'; }
      else                                  { rating = bullet; format = 'Bullet'; }
    }

    activeProfiles.push({
      username: player.username,
      avatar: player.avatar || null,
      title: player.title || null,
      country: player.country || null,
      url: player.url,
      rating,
      format
    });

    // C. Archives
    await sleep(CONFIG.ENRICH_DELAY_MS);
    try {
      const archiveData = await apiFetch(
        `${CONFIG.API_BASE}/player/${member.username}/games/${YEAR}/${MONTH_NUM}`,
        `archives:${member.username}:${MONTH_KEY}`,
        CONFIG.TTL.ARCHIVES
      );

      const allGames = archiveData.games || [];
      const games = allGames.filter((g) => g.rated && (g.time_class === 'rapid' || g.time_class === 'blitz'));

      if (games.length >= CONFIG.MIN_GAMES) {
        // Find earliest and latest rating for this member in the month
        // to calculate Elo gain
        let earliestRating = null;
        let latestRating = null;
        let earliestTime = Infinity;
        let latestTime = -Infinity;

        for (const game of games) {
          const isWhite = game.white?.username?.toLowerCase() === member.username.toLowerCase();
          const myRating = Number(isWhite ? game.white?.rating : game.black?.rating) || 0;
          const gameTime = game.end_time || 0;

          if (myRating > 0 && gameTime < earliestTime) {
            earliestTime = gameTime;
            earliestRating = myRating;
          }
          if (myRating > 0 && gameTime >= latestTime) {
            latestTime = gameTime;
            latestRating = myRating;
          }
        }

        const eloGain = (latestRating != null && earliestRating != null)
          ? latestRating - earliestRating
          : 0;

        let wins = 0, losses = 0, draws = 0;
        for (const game of games) {
          const isWhite = game.white?.username?.toLowerCase() === member.username.toLowerCase();
          const r = classifyResult(isWhite ? game.white?.result : game.black?.result);
          if (r === 'win')       wins++;
          else if (r === 'loss') losses++;
          else                   draws++;
        }

        memberStats.push({
          username: member.username,
          wins, losses, draws,
          totalGames: wins + losses + draws,
          games,
          eloGain,
          currentRating: latestRating || rating,
          format
        });
      }
    } catch { /* silent */ }
  }

  // ── 3. Compute POTM (most Elo gained this month) ──────────────────
  let potm = null;

  if (memberStats.length > 0) {
    const ranked = [...memberStats].sort((a, b) => {
      // Primary: most Elo gained
      if (b.eloGain !== a.eloGain) return b.eloGain - a.eloGain;
      // Tiebreaker: more games played
      return b.totalGames - a.totalGames;
    });

    const winner = ranked[0];
    const winnerProfile = activeProfiles.find(p => p.username.toLowerCase() === winner.username.toLowerCase()) || {};

    potm = {
      username:      winner.username,
      wins:          winner.wins,
      losses:        winner.losses,
      draws:         winner.draws,
      totalGames:    winner.totalGames,
      eloGain:       winner.eloGain,
      currentRating: winner.currentRating,
      rating:        winnerProfile.rating,
      format:        winner.format || winnerProfile.format,
      avatar:        winnerProfile.avatar,
      month:         WEEK_LABEL,
    };
  }

  // ── 4. Compute GOTW (Game of the Week) ─────────────────────────────
  let gotw  = null;
  let bestScore = -Infinity;

  for (const { username, games } of memberStats) {
    for (const game of games) {
      // Only consider games from the current week
      const gameTime = game.end_time || 0;
      if (gameTime < WEEK_START_TS || gameTime >= WEEK_END_TS) continue;

      const isWhite = game.white?.username?.toLowerCase() === username.toLowerCase();
      const resultCode = isWhite ? game.white?.result : game.black?.result;

      // Only consider wins for GOTW
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
      if (myAccuracy != null) score += myAccuracy * 4.0; // 0–400 (accuracy is king)
      score += Math.max(0, ratingDiff) * 0.5;             // smaller upset bonus
      score += Math.min(moveCount, 60) * 0.5;             // length bonus

      if (score > bestScore) {
        bestScore = score;
        const winner = isWhite ? game.white?.username : game.black?.username;
        const fen    = extractFen(game.pgn);

        gotw = {
          white:     game.white?.username  || '?',
          black:     game.black?.username  || '?',
          whiteRating: game.white?.rating  || null,
          blackRating: game.black?.rating  || null,
          result:    gameResultString(game),
          url:       game.url || 'https://www.chess.com/games',
          fen,
          week:      WEEK_LABEL,
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

  const result = { potm, gotw, activeProfiles };
  cache.set(cacheKey, result, CONFIG.TTL.MONTHLY);
  return result;
}

// ═══════════════════════════════════════════════════════════════════
//  ETERNAL TORCH & EXISTENCE TIMER LOGIC
// ═══════════════════════════════════════════════════════════════════
let _torchTimerInterval = null;

function initClubTorchTimer(createdSec) {
  if (!createdSec || !document.getElementById('torch-widget')) return;

  const createdMs = createdSec * 1000;
  const createdDate = new Date(createdMs);

  const sinceTagEl = document.getElementById('torch-since-tag');
  if (sinceTagEl) {
    const monthYear = createdDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    sinceTagEl.textContent = `Burning continuously since ${monthYear}`;
  }

  const updateTimer = () => {
    const now = new Date();
    let years = now.getFullYear() - createdDate.getFullYear();
    let anniversary = new Date(createdMs);
    anniversary.setFullYear(now.getFullYear());

    if (now < anniversary) {
      years--;
      anniversary.setFullYear(now.getFullYear() - 1);
    }

    const MS_PER_SEC  = 1000;
    const MS_PER_MIN  = 60 * MS_PER_SEC;
    const MS_PER_HOUR = 60 * MS_PER_MIN;
    const MS_PER_DAY  = 24 * MS_PER_HOUR;

    let remainingMs = Math.max(0, now - anniversary);
    const days  = Math.floor(remainingMs / MS_PER_DAY);
    remainingMs %= MS_PER_DAY;

    const hours = Math.floor(remainingMs / MS_PER_HOUR);
    remainingMs %= MS_PER_HOUR;

    const mins  = Math.floor(remainingMs / MS_PER_MIN);
    remainingMs %= MS_PER_MIN;

    const secs  = Math.floor(remainingMs / MS_PER_SEC);

    const yrsEl   = document.getElementById('timer-years');
    const daysEl  = document.getElementById('timer-days');
    const hoursEl = document.getElementById('timer-hours');
    const minsEl  = document.getElementById('timer-mins');
    const secsEl  = document.getElementById('timer-secs');

    if (yrsEl)   yrsEl.textContent   = String(years);
    if (daysEl)  daysEl.textContent  = String(days).padStart(3, '0');
    if (hoursEl) hoursEl.textContent = String(hours).padStart(2, '0');
    if (minsEl)  minsEl.textContent  = String(mins).padStart(2, '0');
    if (secsEl)  secsEl.textContent  = String(secs).padStart(2, '0');
  };

  updateTimer();
  if (_torchTimerInterval) clearInterval(_torchTimerInterval);
  _torchTimerInterval = setInterval(updateTimer, 1000);
}

// ═══════════════════════════════════════════════════════════════════
//  DISCORD SANCTUARY WIDGET
// ═══════════════════════════════════════════════════════════════════
function initDiscordWidget() {
  const copyBtn  = document.getElementById('discord-copy-btn');
  const copyText = document.getElementById('discord-copy-text');
  const inviteUrl = 'https://discord.gg/Kp3zM3pUBa';

  if (!copyBtn) return;

  copyBtn.addEventListener('click', async () => {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(inviteUrl);
      } else {
        const input = document.createElement('input');
        input.value = inviteUrl;
        document.body.appendChild(input);
        input.select();
        document.execCommand('copy');
        document.body.removeChild(input);
      }

      copyBtn.classList.add('copied');
      if (copyText) copyText.textContent = 'Copied!';

      setTimeout(() => {
        copyBtn.classList.remove('copied');
        if (copyText) copyText.textContent = 'Copy Link';
      }, 2000);
    } catch (err) {
      console.warn('[Elegance] Could not copy Discord invite link:', err);
    }
  });
}

// ═══════════════════════════════════════════════════════════════════
//  SECTION 1 — CLUB HEADER
// ═══════════════════════════════════════════════════════════════════
let _currentMemberCount = null;

function updateHeaderMemberCount(count) {
  if (count == null) return;
  const subLink = document.querySelector('#club-sub .member-sub-link');
  if (subLink) {
    subLink.textContent = `${Number(count).toLocaleString()} Dreamers`;
  }
}

async function loadHeader(bypassCache = false) {
  const iconEl     = document.getElementById('club-icon');
  const fallbackEl = document.getElementById('club-icon-fallback');
  const nameEl     = document.getElementById('club-name');
  const subEl      = document.getElementById('club-sub');
  const descEl     = document.getElementById('club-desc');
  const linkEl     = document.getElementById('club-link');

  if (CONFIG.CLUB_NAME_OVERRIDE) {
    nameEl.innerHTML = CONFIG.CLUB_NAME_OVERRIDE;
  }

  let data = null;
  try {
    data = await apiFetch(
      `${CONFIG.API_BASE}/club/${CONFIG.CLUB_ID}`,
      'club:profile',
      CONFIG.TTL.CLUB,
      bypassCache
    );
  } catch (err) {
    console.warn(`[Elegance] Could not fetch profile for '${CONFIG.CLUB_ID}':`, err.message);
  }

  if (data && data.icon) {
    iconEl.src    = data.icon;
    iconEl.onload = () => { iconEl.classList.add('loaded'); fallbackEl.classList.add('hidden'); };
  }

  if (!CONFIG.CLUB_NAME_OVERRIDE) {
    nameEl.textContent = (data && data.name) || '夢 • Yume';
  }

  const rawCount = (_currentMemberCount != null)
    ? _currentMemberCount
    : (data && data.members_count != null ? data.members_count : null);
  const count = (rawCount != null) ? Number(rawCount).toLocaleString() : '–';
  const year  = (data && data.created) ? extractYear(data.created) : '2024';
  subEl.innerHTML = `
    <a href="#section-members" class="gold member-sub-link" title="Jump to Club Member Counter">${escHtml(count !== '–' ? count + ' Dreamers' : 'Club')}</a>
    <span class="sep">·</span>
    Est. ${escHtml(String(year))}
  `;

  const createdTs = (data && data.created) ? data.created : Math.floor(new Date('2024-01-01').getTime() / 1000);
  initClubTorchTimer(createdTs);

  if (data && data.description && data.description.trim()) {
    const tmp = document.createElement('div');
    tmp.innerHTML = data.description;
    let descText = tmp.textContent || tmp.innerText || '';
    // Replace 'Elegance' with actual club name '夢 • Yume'
    descText = descText.replace(/\bElegance\b/gi, '夢 • Yume');
    descEl.textContent = descText;
  } else if (!descEl.textContent.trim()) {
    descEl.textContent = '夢 • Yume is a chess community built for players who value precision, improvement, and the beauty of the game.';
  }

  if (data && data.url) {
    linkEl.href = data.url;
  } else {
    linkEl.href = `https://www.chess.com/club/${CONFIG.CLUB_ID}`;
  }
}

// ═══════════════════════════════════════════════════════════════════
//  SECTION 1.5 — CLUB MEMBER COUNTER
// ═══════════════════════════════════════════════════════════════════

/**
 * Smooth cubic ease-out number counter animation from start to target
 */
function animateCountUp(element, startVal = 0, targetVal, duration = 1000) {
  if (!element || targetVal == null || isNaN(targetVal)) return;
  const start = isNaN(startVal) ? 0 : Number(startVal);
  const target = Number(targetVal);
  if (start === target) {
    element.textContent = target.toLocaleString();
    return;
  }
  const startTime = performance.now();

  function step(now) {
    const elapsed = now - startTime;
    const progress = Math.min(elapsed / duration, 1);
    // Cubic ease-out
    const ease = 1 - Math.pow(1 - progress, 3);
    const val = Math.round(start + (target - start) * ease);
    element.textContent = val.toLocaleString();
    if (progress < 1) {
      requestAnimationFrame(step);
    } else {
      element.textContent = target.toLocaleString();
    }
  }

  requestAnimationFrame(step);
}

/**
 * Dynamically computes next community milestone tier
 */
function calculateNextMilestone(count) {
  if (!count || count < 50) return 50;
  if (count < 100) return 100;
  if (count < 250) return 250;
  if (count < 500) return 500;
  if (count < 1000) return 1000;
  if (count < 2500) return Math.ceil((count + 1) / 500) * 500;
  return Math.ceil((count + 1) / 1000) * 1000;
}

/**
 * Fetches club members & profile to compute and render live member counter stats
 */
async function loadMemberCounter(isAutoRefresh = false, bypassCache = false) {
  const cardEl      = document.getElementById('member-counter-card');
  const totalEl     = document.getElementById('member-total-count');
  const activeEl    = document.getElementById('member-active-count');
  const weeklyEl    = document.getElementById('member-weekly-count');
  const activityEl  = document.getElementById('member-activity-rate');
  const adminsEl    = document.getElementById('member-admins-count');
  const targetTxtEl = document.getElementById('milestone-target-text');
  const progressPct = document.getElementById('member-progress-pct');
  const neededEl    = document.getElementById('member-needed-count');
  const barEl       = document.getElementById('member-progress-bar');
  const tagEl       = document.getElementById('member-counter-tag');

  if (!totalEl) return;

  // Make card interactive (links to club on Chess.com)
  if (cardEl && !cardEl._hasClickAttached) {
    cardEl._hasClickAttached = true;
    cardEl.style.cursor = 'pointer';
    cardEl.setAttribute('title', 'View 夢 • Yume Roster on Chess.com');
    cardEl.addEventListener('click', (e) => {
      // Avoid redirect if user clicks an internal anchor or button
      if (e.target.closest('a') || e.target.closest('button')) return;
      window.open(`https://www.chess.com/club/${CONFIG.CLUB_ID}`, '_blank', 'noopener,noreferrer');
    });
  }

  try {
    // Parallel fetch real-time club members and club profile
    const [membersData, profile] = await Promise.all([
      getClubMembers(bypassCache).catch(() => null),
      apiFetch(`${CONFIG.API_BASE}/club/${CONFIG.CLUB_ID}`, 'club:profile', CONFIG.TTL.CLUB, bypassCache).catch(() => null),
    ]);

    const weeklyMembers  = (membersData && membersData.weekly)  || [];
    const monthlyMembers = (membersData && membersData.monthly) || [];
    const allTimeMembers = (membersData && membersData.all_time) || [];
    const adminList      = (profile && Array.isArray(profile.admin)) ? profile.admin : [];

    // Deduplicate unique members across all three activity tiers to get real-time roster count
    const uniqueUsernames = new Set();
    [...weeklyMembers, ...monthlyMembers, ...allTimeMembers].forEach((m) => {
      if (m && m.username) uniqueUsernames.add(m.username.toLowerCase());
    });
    const liveRosterCount = uniqueUsernames.size;

    // The /members endpoint is updated immediately when members join or leave.
    // The profile.members_count is cached by Chess.com up to 12-24 hours.
    // Prioritize the live roster count as the real-time source of truth.
    let totalCount;
    if (liveRosterCount > 0) {
      if (!profile || profile.members_count == null || liveRosterCount >= Number(profile.members_count) || (Number(profile.members_count) - liveRosterCount <= 10)) {
        totalCount = liveRosterCount;
      } else {
        totalCount = Number(profile.members_count);
      }
    } else {
      totalCount = (profile && profile.members_count != null) ? Number(profile.members_count) : 43;
    }

    const prevCount = _currentMemberCount;
    _currentMemberCount = totalCount;

    const weeklyCount = weeklyMembers.length;
    const monthlyCount = monthlyMembers.length;
    const adminsCount = adminList.length;

    const activityRatio = totalCount > 0 ? Math.round((weeklyCount / totalCount) * 100) : 0;
    const nextMilestone = calculateNextMilestone(totalCount);
    const progressPercent = Math.min(100, Math.max(0, Math.round((totalCount / nextMilestone) * 100)));
    const needed = Math.max(0, nextMilestone - totalCount);

    // Keep header member counter in sync with real-time value
    updateHeaderMemberCount(totalCount);

    // Animate hero counter number
    const isInitialRender = (prevCount === null || totalEl.textContent === '--');
    if (isInitialRender) {
      animateCountUp(totalEl, 0, totalCount, 1200);
    } else if (prevCount !== totalCount) {
      // Real-time update detected: animate from previous count and trigger highlight pulse
      animateCountUp(totalEl, prevCount, totalCount, 600);
      totalEl.classList.remove('count-updated-pulse');
      void totalEl.offsetWidth;
      totalEl.classList.add('count-updated-pulse');
      setTimeout(() => totalEl.classList.remove('count-updated-pulse'), 1500);
    } else {
      totalEl.textContent = totalCount.toLocaleString();
    }

    if (activeEl)    activeEl.textContent = weeklyCount.toLocaleString();
    if (weeklyEl)    weeklyEl.textContent = weeklyCount.toLocaleString();
    if (activityEl)  activityEl.textContent = `${activityRatio}%`;
    if (adminsEl)    adminsEl.textContent = adminsCount.toLocaleString();

    if (targetTxtEl) targetTxtEl.textContent = `${nextMilestone.toLocaleString()} Dreamers`;
    if (progressPct) progressPct.textContent = `${progressPercent}% Achieved`;
    if (neededEl) {
      neededEl.textContent = needed > 0 ? `${needed} to next rank` : 'Milestone Unlocked! ♛';
    }

    // Smooth width animation on progress bar
    if (barEl) {
      setTimeout(() => {
        barEl.style.width = `${progressPercent}%`;
      }, 80);
    }

    if (tagEl) {
      tagEl.textContent = `${totalCount} Dreamers`;
    }

  } catch (err) {
    console.warn('[Elegance] Could not load member counter:', err.message);
    if (totalEl && totalEl.textContent === '--') {
      totalEl.textContent = '43';
    }
  }
}

// ═══════════════════════════════════════════════════════════════════
//  SECTION 2 — NEW TO THE CLUB
// ═══════════════════════════════════════════════════════════════════
async function loadJoiners(isAutoRefresh = false, bypassCache = false) {
  const list = document.getElementById('joiners-list');
  if (!isAutoRefresh && (!list.children.length || list.querySelector('.empty-state'))) {
    list.innerHTML = skeletonMemberList(CONFIG.MAX_JOINERS);
  }

  try {
    const membersData = await getClubMembers(bypassCache);

    const seen = new Set();
    const combined = [
      ...(membersData.weekly || []),
      ...(membersData.monthly || []),
      ...(membersData.all_time || [])
    ].filter(({ username }) => {
      if (!username) return false;
      const lower = username.toLowerCase();
      if (seen.has(lower)) return false;
      seen.add(lower);
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
      const cleanUser = member.username.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();
      const li = document.createElement('li');
      li.className = 'member-item';
      li.style.animationDelay = `${i * 0.08}s`;
      li.id = `member-row-${cleanUser}`;
      li.innerHTML = `
        <div class="member-avatar-placeholder" id="member-ph-${cleanUser}">
          ${escHtml(member.username.charAt(0).toUpperCase())}
        </div>
        <div class="member-info">
          <div class="member-name" id="member-name-${cleanUser}">${escHtml(member.username)}</div>
          <div class="member-time">
            ${member.joined ? relativeTime(member.joined) : 'Recently joined'}
          </div>
        </div>
      `;
      list.appendChild(li);
    });

    for (let i = 0; i < Math.min(recent.length, CONFIG.MAX_ENRICH); i++) {
      await sleep(CONFIG.ENRICH_DELAY_MS);
      await enrichMemberRow(recent[i].username);
    }
  } catch (err) {
    list.innerHTML = `<li class="empty-state">No recent joiners available.</li>`;
  }
}

async function enrichMemberRow(username) {
  try {
    const player = await apiFetch(
      `${CONFIG.API_BASE}/player/${username}`,
      `player:${username}`,
      CONFIG.TTL.PLAYER
    );

    const cleanUser = username.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();
    const ph     = document.getElementById(`member-ph-${cleanUser}`);
    const nameEl = document.getElementById(`member-name-${cleanUser}`);
    const row    = document.getElementById(`member-row-${cleanUser}`);
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
        let span = row.querySelector('.member-country');
        if (!span) {
          span = document.createElement('span');
          span.className = 'member-country';
          row.appendChild(span);
        }
        span.textContent = flag;
        span.title       = code;
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
      card.innerHTML = `<div class="empty-state" style="width:100%">No games recorded for ${WEEK_LABEL} yet.</div>`;
      return;
    }
    renderPotmCard(card, potm);
  } catch (e) {
    console.error('[Elegance] POTW failed:', e);
    card.innerHTML = `<div class="empty-state" style="width:100%">Player of the Week could not be computed.</div>`;
  }
}

function renderPotmCard(card, potm) {
  const avatarHtml = potm.avatar
    ? `<img class="potm-avatar" src="${escHtml(potm.avatar)}" alt="${escHtml(potm.username)}"
            onerror="this.outerHTML='<div class=\\'potm-avatar-placeholder\\'>♛</div>'">`
    : `<div class="potm-avatar-placeholder">♛</div>`;

  const ratingStr = potm.currentRating
    ? `${escHtml(potm.format)} ${Number(potm.currentRating).toLocaleString()}`
    : (potm.rating ? `${escHtml(potm.format)} ${Number(potm.rating).toLocaleString()}` : '');

  // Elo gain display
  const eloGain = potm.eloGain || 0;
  const eloSign = eloGain >= 0 ? '+' : '';
  const eloClass = eloGain > 0 ? 'elo-positive' : eloGain < 0 ? 'elo-negative' : 'elo-neutral';
  const eloArrow = eloGain > 0 ? '▲' : eloGain < 0 ? '▼' : '–';

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
      <div class="potm-elo-gain ${eloClass}">
        <span class="elo-arrow">${eloArrow}</span>
        <span class="elo-value">${eloSign}${eloGain}</span>
        <span class="elo-label">Elo this week</span>
      </div>
      <div class="potm-rating" style="margin-top:4px">${wld}</div>
      <div class="potm-month">${escHtml(potm.month)}</div>
    </div>
  `;
}

// ═══════════════════════════════════════════════════════════════════
//  SECTION 4 — GAME OF THE WEEK  (live-computed)
// ═══════════════════════════════════════════════════════════════════
async function loadGameOfWeek() {
  const card = document.getElementById('gotm-card');

  card.innerHTML = `<div class="skeleton-block skeleton" style="height:220px;border-radius:8px"></div>`;

  try {
    const { gotw } = await getMonthlyData();
    if (!gotw) {
      card.innerHTML = `<div class="empty-state">No games found for ${WEEK_LABEL} yet.</div>`;
      return;
    }
    renderGotwCard(card, gotw);
  } catch (e) {
    console.error('[Elegance] GOTW failed:', e);
    card.innerHTML = `<div class="empty-state">Game of the Week could not be computed.</div>`;
  }
}

function renderGotwCard(card, gotw) {
  const resultDisplay =
    gotw.result === '1-0' ? '1–0' :
    gotw.result === '0-1' ? '0–1' : '½–½';

  const whiteRatingStr = gotw.whiteRating ? `<span class="gotm-player-rating">${gotw.whiteRating}</span>` : '';
  const blackRatingStr = gotw.blackRating ? `<span class="gotm-player-rating">${gotw.blackRating}</span>` : '';

  card.innerHTML = `
    <div class="gotm-matchup">
      <div class="gotm-player">
        <div class="gotm-player-name" title="${escHtml(gotw.white)}">${escHtml(gotw.white)}</div>
        ${whiteRatingStr}
        <div class="gotm-player-color">White</div>
      </div>
      <div class="gotm-vs">${resultDisplay}</div>
      <div class="gotm-player">
        <div class="gotm-player-name" title="${escHtml(gotw.black)}">${escHtml(gotw.black)}</div>
        ${blackRatingStr}
        <div class="gotm-player-color">Black</div>
      </div>
    </div>
    <div class="gotm-board-wrap">
      <div id="gotm-board"></div>
    </div>
    <p class="gotm-blurb">"${gotw.blurb}"</p>
    <a class="gotm-replay-btn"
       href="${escHtml(gotw.url)}"
       target="_blank"
       rel="noopener noreferrer"
       id="gotm-replay-link">
      ▶ &nbsp;Replay on Chess.com
    </a>
  `;

  renderChessBoard(gotw.fen, '', 'gotm-board');
}

// ═══════════════════════════════════════════════════════════════════
//  REAL-TIME MEMBER PROFILES (for Pulse, Roster, HoF)
// ═══════════════════════════════════════════════════════════════════
let _activeProfilesCache = null;
let _activeProfilesTime = 0;

async function getActiveProfiles(bypassCache = false) {
  if (!bypassCache && _activeProfilesCache && Date.now() - _activeProfilesTime < CONFIG.TTL.MEMBERS) {
    return _activeProfilesCache;
  }
  // Debounce multiple concurrent calls in the same refresh tick
  if (bypassCache && _activeProfilesCache && Date.now() - _activeProfilesTime < 5000) {
    return _activeProfilesCache;
  }

  const membersData = await apiFetch(
    `${CONFIG.API_BASE}/club/${CONFIG.CLUB_ID}/members`,
    'club:members',
    CONFIG.TTL.MEMBERS,
    bypassCache
  );
  
  const combined = [
    ...(membersData.weekly || []),
    ...(membersData.monthly || []),
    ...(membersData.all_time || [])
  ];
  
  const seen = new Set();
  const unique = [];
  for (const m of combined) {
    if (!m.username) continue;
    const lower = m.username.toLowerCase();
    if (!seen.has(lower)) {
      seen.add(lower);
      unique.push(m.username);
    }
  }
  
  // Scan all unique club members (up to 100) across all activity lists
  const candidates = unique.slice(0, 100);
  const profiles = [];
  const BATCH_SIZE = 4;

  for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
    const batch = candidates.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.all(batch.map(async (username) => {
      try {
        const [player, stats] = await Promise.all([
          apiFetch(`${CONFIG.API_BASE}/player/${username}`, `player:${username}`, CONFIG.TTL.PLAYER, bypassCache).catch(() => null),
          apiFetch(`${CONFIG.API_BASE}/player/${username}/stats`, `stats:${username}`, CONFIG.TTL.STATS, bypassCache).catch(() => null),
        ]);

        if (!player && !stats) return null;

        let rating = 0;
        let bestFormat = 'Rapid';
        if (stats) {
          const formats = [
            { name: 'Rapid',  val: stats.chess_rapid?.last?.rating  || 0 },
            { name: 'Blitz',  val: stats.chess_blitz?.last?.rating  || 0 },
            { name: 'Bullet', val: stats.chess_bullet?.last?.rating || 0 },
            { name: 'Daily',  val: stats.chess_daily?.last?.rating  || 0 },
          ];
          formats.sort((a, b) => b.val - a.val);
          rating = formats[0].val;
          bestFormat = formats[0].name;
        }

        return {
          username: (player && player.username) || username,
          avatar: (player && player.avatar) || null,
          title: (player && player.title) || null,
          url: (player && player.url) || `https://www.chess.com/member/${username}`,
          rating,
          format: bestFormat
        };
      } catch {
        return null;
      }
    }));

    for (const p of batchResults) {
      if (p) profiles.push(p);
    }

    if (i + BATCH_SIZE < candidates.length) {
      await sleep(60);
    }
  }
  
  _activeProfilesCache = profiles;
  _activeProfilesTime = Date.now();
  return profiles;
}

// ═══════════════════════════════════════════════════════════════════
//  THE ELITE ROSTER (Top 3)
// ═══════════════════════════════════════════════════════════════════
async function loadEliteRoster(bypassCache = false) {
  const list = document.getElementById('elite-list');
  try {
    const activeProfiles = await getActiveProfiles(bypassCache);
    const sorted = [...activeProfiles]
      .filter(p => p.rating > 0)
      .sort((a, b) => b.rating - a.rating)
      .slice(0, 3);

    if (!sorted.length) {
      list.innerHTML = `<li class="empty-state">No ratings found yet.</li>`;
      return;
    }

    list.innerHTML = '';
    sorted.forEach((p, i) => {
      const li = document.createElement('li');
      li.className = 'elite-item';
      li.setAttribute('data-rank', i + 1);
      li.style.animationDelay = `${i * 0.08}s`;

      const avatarHtml = p.avatar
        ? `<img class="elite-avatar" src="${escHtml(p.avatar)}" alt="${escHtml(p.username)}">`
        : `<div class="member-avatar-placeholder" style="width:32px;height:32px;font-size:12px;border:1px solid var(--gold-dim)">${escHtml(p.username.charAt(0).toUpperCase())}</div>`;
      
      const titleStr = p.title ? `<span class="member-title" style="margin-right:4px">${escHtml(p.title)}</span>` : '';

      li.innerHTML = `
        <div class="elite-rank">#${i + 1}</div>
        ${avatarHtml}
        <div class="elite-info">
          <div class="elite-name">${titleStr}${escHtml(p.username)}</div>
          <div class="elite-format">${escHtml(p.format || 'Best')}</div>
        </div>
        <div class="elite-rating">${Number(p.rating).toLocaleString()}</div>
      `;
      list.appendChild(li);
    });
  } catch {
    list.innerHTML = `<li class="empty-state">Elite roster unavailable.</li>`;
  }
}

// ═══════════════════════════════════════════════════════════════════
//  HALL OF FAME (Titled Members)
// ═══════════════════════════════════════════════════════════════════
async function loadHallOfFame(bypassCache = false) {
  const grid = document.getElementById('hof-grid');
  try {
    const activeProfiles = await getActiveProfiles(bypassCache);
    const titled = activeProfiles.filter(p => p.title).sort((a, b) => b.rating - a.rating);

    if (!titled.length) {
      grid.innerHTML = `<div class="empty-state" style="width:100%">No titled members active this month.</div>`;
      return;
    }

    grid.innerHTML = '';
    titled.forEach((p, i) => {
      const a = document.createElement('a');
      a.className = 'hof-item';
      a.href = p.url || '#';
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.style.animation = `fadeSlideUp var(--t-base) var(--ease) ${i * 0.06}s both`;
      
      const avatarHtml = p.avatar
        ? `<img class="hof-avatar" src="${escHtml(p.avatar)}" alt="${escHtml(p.username)}">`
        : `<div class="member-avatar-placeholder" style="width:24px;height:24px;font-size:10px;border:none">♛</div>`;
      
      a.innerHTML = `
        ${avatarHtml}
        <span class="hof-title">${escHtml(p.title)}</span>
        <span class="hof-name">${escHtml(p.username)}</span>
      `;
      grid.appendChild(a);
    });
  } catch {
    grid.innerHTML = `<div class="empty-state" style="width:100%">Hall of Fame unavailable.</div>`;
  }
}

// ═══════════════════════════════════════════════════════════════════
//  ACTIVE CLUB PULSE
// ═══════════════════════════════════════════════════════════════════
async function loadActivePulse(bypassCache = false) {
  const pulseNode = document.getElementById('club-pulse');
  const textNode  = document.getElementById('pulse-text');
  if (!pulseNode || !textNode) return;
  try {
    const membersData = await getClubMembers(bypassCache);
    const weekly = (membersData && membersData.weekly) || [];
    const top5 = weekly.slice(0, 5);
    
    let isLive = false;
    for (const p of top5) {
      if (!p || !p.username) continue;
      await sleep(CONFIG.ENRICH_DELAY_MS);
      try {
        const res = await apiFetch(`${CONFIG.API_BASE}/player/${p.username}/is-online`);
        if (res && res.online) {
          isLive = true;
          break;
        }
      } catch { /* skip error */ }
    }
    
    if (isLive) {
      pulseNode.classList.add('is-live');
      textNode.textContent = 'Members Playing';
    } else {
      pulseNode.classList.remove('is-live');
      textNode.textContent = 'Active Today';
    }
  } catch {
    textNode.textContent = 'Active Today';
  }
}

// ── SVG CHESS BOARD RENDERER (no external deps) ─────────────────
const PIECE_GLYPHS = {
  K:'♔', Q:'♕', R:'♖', B:'♗', N:'♘', P:'♙',
  k:'♚', q:'♛', r:'♜', b:'♝', n:'♞', p:'♟',
};

function renderChessBoard(fen, pgn, targetId = 'gotm-board') {
  const container = document.getElementById(targetId);
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
async function loadMatches(bypassCache = false) {
  try {
    const data = await apiFetch(
      `${CONFIG.API_BASE}/club/${CONFIG.CLUB_ID}/matches`,
      'club:matches',
      CONFIG.TTL.MATCHES,
      bypassCache
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
  } catch (err) {
    renderVoteChess([]);
    renderDailyMatches([], [], []);
    await renderUpcomingEvents([]);
  }
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
//  WEEKLY MASTERCLASS (replaces Daily Puzzle)
// ═══════════════════════════════════════════════════════════════════
const TACTICS = [
  { fen: '1k1r4/pp1b1R2/3q2pp/4p3/2B5/4Q3/PPP2B2/2K5 b - - 0 1', pgn: '', blurb: 'Kasparov vs. Topalov, Wijk aan Zee (1999). An incredible combination ending in a brilliant mating net.', url: 'https://www.chess.com/games/view/977345' },
  { fen: '4r1k1/1p3p1p/p2p2p1/3P4/2PB1P2/1P1n1qP1/P1Q4P/1R4K1 w - - 0 1', pgn: '', blurb: 'Fischer vs. Myagmarsuren (1967). Fischer relentlessly attacks on the kingside.', url: 'https://www.chess.com/games/view/14588' },
  { fen: 'r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/2N2N2/PPPP1PPP/R1BQK2R w KQkq - 0 1', pgn: '', blurb: 'The Italian Game: a fundamental tactical battleground favored by the romantics.', url: 'https://www.chess.com/openings/Italian-Game' },
  { fen: 'r2q1rk1/1pp1bppp/p1npbn2/4p3/B3P3/2PP1N2/PP1N1PPP/R1BQR1K1 w - - 0 1', pgn: '', blurb: 'Ruy Lopez structure. Understanding these positional nuances is key to mastery.', url: 'https://www.chess.com/openings/Ruy-Lopez-Opening' },
  { fen: '8/p3p3/1p1k4/3p4/8/P7/1PP5/1K6 w - - 0 1', pgn: '', blurb: 'A delicate pawn endgame. Precision here separates masters from amateurs.', url: 'https://www.chess.com/lessons/endgame-patterns-you-must-know' },
];

async function loadMasterclass() {
  const blurbNode = document.getElementById('masterclass-blurb');
  const linkNode  = document.getElementById('masterclass-link');
  if (!blurbNode) return;
  
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 1);
  const diff = now - start;
  const oneWeek = 1000 * 60 * 60 * 24 * 7;
  const weekNum = Math.floor(diff / oneWeek);
  
  const tactic = TACTICS[weekNum % TACTICS.length];
  blurbNode.textContent = `"${tactic.blurb}"`;
  
  if (linkNode && tactic.url) {
    linkNode.href = tactic.url;
    linkNode.style.display = 'inline-flex';
  }
  
  renderChessBoard(tactic.fen, tactic.pgn, 'masterclass-board');
}

// ═══════════════════════════════════════════════════════════════════
//  FOOTER & MANUAL SYNC
// ═══════════════════════════════════════════════════════════════════
let _lastRefreshTime = Math.floor(Date.now() / 1000);
let _footerTimer = null;

function updateFooter() {
  _lastRefreshTime = Math.floor(Date.now() / 1000);
  const el = document.getElementById('footer-refresh');
  if (!el) return;
  
  el.style.cursor = 'pointer';
  el.title = 'Click to force refresh live sections';
  el.innerHTML = `↻ Refreshed just now`;
  
  if (_footerTimer) clearInterval(_footerTimer);
  _footerTimer = setInterval(() => {
    if (el) el.innerHTML = `↻ Refreshed ${relativeTime(_lastRefreshTime)}`;
  }, 10_000);
}

async function triggerManualRefresh() {
  const el = document.getElementById('footer-refresh');
  if (el) el.innerHTML = `↻ Syncing live data…`;
  
  // Clear local and memory cache keys to force fresh API payload
  _membersDataCache = null;
  _membersDataTime = 0;
  _activeProfilesCache = null;
  _activeProfilesTime = 0;
  try { 
    localStorage.removeItem('elegance:club:members'); 
    localStorage.removeItem('elegance:club:profile');
    localStorage.removeItem('elegance:club:matches');
  } catch {}
  
  await Promise.allSettled([
    loadHeader(true),
    loadMemberCounter(true, true),
    loadActivePulse(true),
    loadJoiners(true, true),
    loadEliteRoster(true),
    loadHallOfFame(true),
    loadMatches(true),
  ]);
  
  updateFooter();
}

// ═══════════════════════════════════════════════════════════════════
//  EMERALD RADIO CONTROLLER & CUSTOM AUDIO LOADER
//  To add your own audio files:
//  1. Create an 'audio' folder inside e:\elegance_sidebar\ (e.g. e:\elegance_sidebar\audio\)
//  2. Place your mp3 / wav files inside it (e.g. track1.mp3, track2.mp3)
//  3. Update the track list below with your titles, artists, and filenames!
// ═══════════════════════════════════════════════════════════════════
const CUSTOM_TRACKS = [
  {
    title: 'Unstoppable Hope',
    src: 'audio/track1.mp3'
  },
  {
    title: 'Unworthy',
    src: 'audio/track2.mp3'
  },
  {
    title: 'Falling Leaf',
    src: 'audio/track3.mp3'
  },
  {
    title: 'Nostalgia',
    src: 'audio/track4.mp3'
  }
];

class LofiSynthEngine {
  constructor() {
    this.ctx = null;
    this.isPlaying = false;
    this.timer = null;
    this.step = 0;
    this.currentPreset = 0;

    this.presets = [
      {
        name: 'Unstoppable Hope',
        chords: [
          [261.63, 329.63, 392.00, 493.88], // Cmaj7
          [220.00, 261.63, 329.63, 392.00], // Am7
          [174.61, 220.00, 261.63, 329.63], // Fmaj7
          [196.00, 246.94, 293.66, 349.23]  // G7
        ],
        tempo: 2200
      },
      {
        name: 'Unworthy',
        chords: [
          [146.83, 220.00, 261.63, 329.63], // Dm7
          [164.81, 246.94, 293.66, 392.00], // Em7
          [174.61, 261.63, 329.63, 440.00], // Fmaj7
          [146.83, 220.00, 261.63, 329.63]  // Dm7
        ],
        tempo: 2600
      },
      {
        name: 'Falling Leaf',
        chords: [
          [220.00, 277.18, 329.63, 415.30], // Amaj7
          [185.00, 220.00, 277.18, 329.63], // F#m7
          [146.83, 185.00, 220.00, 277.18], // Dmaj7
          [164.81, 207.65, 246.94, 329.63]  // E7
        ],
        tempo: 2000
      },
      {
        name: 'Nostalgia',
        chords: [
          [130.81, 196.00, 261.63, 329.63],
          [146.83, 220.00, 293.66, 349.23],
          [164.81, 246.94, 329.63, 392.00],
          [130.81, 196.00, 261.63, 329.63]
        ],
        tempo: 2800
      }
    ];
  }

  initContext() {
    if (!this.ctx) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AudioContext();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  playChord(freqs) {
    if (!this.ctx || !this.isPlaying) return;

    const now = this.ctx.currentTime;
    const masterGain = this.ctx.createGain();
    masterGain.gain.setValueAtTime(0.001, now);
    masterGain.gain.exponentialRampToValueAtTime(0.18, now + 0.15);
    masterGain.gain.exponentialRampToValueAtTime(0.001, now + 1.9);

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(600, now);
    filter.Q.setValueAtTime(2, now);

    filter.connect(this.ctx.destination);
    masterGain.connect(filter);

    freqs.forEach((freq) => {
      const osc = this.ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now);
      osc.detune.setValueAtTime((Math.random() - 0.5) * 8, now);
      osc.connect(masterGain);
      osc.start(now);
      osc.stop(now + 2.0);
    });

    const bassOsc = this.ctx.createOscillator();
    const bassGain = this.ctx.createGain();
    bassOsc.type = 'triangle';
    bassOsc.frequency.setValueAtTime(freqs[0] / 2, now);
    bassGain.gain.setValueAtTime(0.001, now);
    bassGain.gain.exponentialRampToValueAtTime(0.25, now + 0.1);
    bassGain.gain.exponentialRampToValueAtTime(0.001, now + 1.7);

    bassOsc.connect(bassGain);
    bassGain.connect(filter);
    bassOsc.start(now);
    bassOsc.stop(now + 1.8);
  }

  start() {
    this.initContext();
    this.isPlaying = true;
    this.step = 0;
    this.tick();
  }

  stop() {
    this.isPlaying = false;
    if (this.timer) clearTimeout(this.timer);
  }

  tick() {
    if (!this.isPlaying) return;
    const preset = this.presets[this.currentPreset % this.presets.length];
    const chord = preset.chords[this.step % preset.chords.length];
    this.playChord(chord);
    this.step++;
    this.timer = setTimeout(() => this.tick(), preset.tempo);
  }

  setPreset(idx) {
    this.currentPreset = idx % this.presets.length;
    this.step = 0;
    if (this.isPlaying) {
      if (this.timer) clearTimeout(this.timer);
      this.tick();
    }
  }
}

const lofiEngine = new LofiSynthEngine();

function initEmeraldRadio() {
  const widget = document.getElementById('radio-widget');
  if (!widget) return;

  let isPlaying = false;
  let currentIdx = 0;
  const audio = new Audio();

  const titleEl  = document.getElementById('radio-track-title');
  const artistEl = document.getElementById('radio-artist');
  const playBtn  = document.getElementById('radio-play-btn');
  const prevBtn  = document.getElementById('radio-prev-btn');
  const nextBtn  = document.getElementById('radio-next-btn');
  const eqBars   = document.querySelectorAll('.eq-bar');

  const setEqState = (active) => {
    eqBars.forEach((bar) => {
      bar.style.animationPlayState = active ? 'running' : 'paused';
    });
  };
  setEqState(false);

  const updateTrackUI = () => {
    const track = CUSTOM_TRACKS[currentIdx] || lofiEngine.presets[currentIdx];
    if (titleEl)  titleEl.textContent  = track.title || track.name;
    if (artistEl) {
      if (track.artist) {
        artistEl.textContent = track.artist;
        artistEl.style.display = 'block';
      } else {
        artistEl.style.display = 'none';
      }
    }
  };

  const loadAndPlay = async () => {
    const track = CUSTOM_TRACKS[currentIdx];
    if (track && track.src) {
      audio.src = track.src;
      try {
        await audio.play();
        isPlaying = true;
        if (playBtn) playBtn.textContent = '❚❚';
        setEqState(true);
        return;
      } catch (e) {
        console.info('[Radio] Local audio file not loaded yet or blocked. Playing Web Audio Synth fallback.');
      }
    }
    // Web Audio Synth Fallback
    lofiEngine.setPreset(currentIdx);
    lofiEngine.start();
    isPlaying = true;
    if (playBtn) playBtn.textContent = '❚❚';
    setEqState(true);
  };

  const stopAll = () => {
    audio.pause();
    lofiEngine.stop();
    isPlaying = false;
    if (playBtn) playBtn.textContent = '▶';
    setEqState(false);
  };

  if (playBtn) {
    playBtn.addEventListener('click', () => {
      if (isPlaying) {
        stopAll();
      } else {
        loadAndPlay();
      }
    });
  }

  if (prevBtn) {
    prevBtn.addEventListener('click', () => {
      const wasPlaying = isPlaying;
      stopAll();
      currentIdx = (currentIdx - 1 + CUSTOM_TRACKS.length) % CUSTOM_TRACKS.length;
      updateTrackUI();
      if (wasPlaying) loadAndPlay();
    });
  }

  if (nextBtn) {
    nextBtn.addEventListener('click', () => {
      const wasPlaying = isPlaying;
      stopAll();
      currentIdx = (currentIdx + 1) % CUSTOM_TRACKS.length;
      updateTrackUI();
      if (wasPlaying) loadAndPlay();
    });
  }

  audio.addEventListener('ended', () => {
    stopAll();
    currentIdx = (currentIdx + 1) % CUSTOM_TRACKS.length;
    updateTrackUI();
    loadAndPlay();
  });

  updateTrackUI();
}

// ═══════════════════════════════════════════════════════════════════
//  INIT
// ═══════════════════════════════════════════════════════════════════
async function init() {
  // Clear any existing stale cache keys on startup
  try { 
    localStorage.removeItem('elegance:club:members');
    localStorage.removeItem('elegance:club:profile');
    localStorage.removeItem('elegance:club:matches');
  } catch {}

  const footerEl = document.getElementById('footer-refresh');
  if (footerEl) {
    footerEl.addEventListener('click', () => {
      triggerManualRefresh();
    });
  }

  // Emerald Radio Widget
  initEmeraldRadio();

  // Discord Sanctuary Widget
  initDiscordWidget();

  try {
    await loadHeader(true);
  } catch (e) {
    console.error('[Elegance] Header failed:', e);
  }

  await Promise.allSettled([
    loadMemberCounter(false, true),
    loadActivePulse(false),
    loadJoiners(false, true),
    loadPlayerOfMonth(),
    loadGameOfWeek(),
    loadEliteRoster(),
    loadHallOfFame(),
    loadMatches(),
    loadMasterclass(),
  ]);

  updateFooter();

  // Fast real-time sync for member counter, new joiners & live pulse every 20 seconds
  setInterval(async () => {
    await Promise.allSettled([
      loadMemberCounter(true, true),
      loadJoiners(true, true),
      loadActivePulse(false),
    ]);
  }, 20 * 1000);

  // Periodic refresh for header, roster, hall of fame, and matches every 60 seconds
  setInterval(async () => {
    try { await loadHeader(true); } catch (e) {}
    await Promise.allSettled([
      loadEliteRoster(true),
      loadHallOfFame(true),
      loadMatches(true),
    ]);
    updateFooter();
  }, 60 * 1000);

  // Immediate sync when tab becomes visible again
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      loadMemberCounter(true, true);
      loadJoiners(true, true);
    }
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
