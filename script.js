/* ♛ ELEGANCE CHESS CLUB SIDEBAR — SCRIPT
 * ─────────────────────────────────────────────────────────────────────
 * Pulls live data from Chess.com's public PubAPI (no API key required).
 * All sections use localStorage caching + serial enrichment requests
 * to stay within Chess.com's rate-limit guidelines.
 * ─────────────────────────────────────────────────────────────────────
 */

'use strict';

// ═══════════════════════════════════════════════════════════════════
//  CONFIG
// ═══════════════════════════════════════════════════════════════════
const CONFIG = {
  CLUB_ID:   'elegance',
  API_BASE:  'https://api.chess.com/pub',
  // Proxy is prepended as a fallback on CORS errors
  PROXY_URL: 'https://corsproxy.io/?',
  useProxy:  false,

  // Cache TTLs (milliseconds)
  TTL: {
    CLUB:    12 * 60 * 60 * 1000, // 12 h
    MEMBERS: 12 * 60 * 60 * 1000, // 12 h
    MATCHES:  1 * 60 * 60 * 1000, //  1 h
    PLAYER:   6 * 60 * 60 * 1000, //  6 h
    STATS:    6 * 60 * 60 * 1000, //  6 h
    PUZZLE:  24 * 60 * 60 * 1000, // 24 h
  },

  // Enrichment limits (per-load)
  MAX_JOINERS:       5,   // new joiners shown
  MAX_ENRICH:        5,   // max avatar calls per load
  ENRICH_DELAY_MS: 180,   // ms between enrichment calls
  MAX_VOTE:          3,   // max vote chess entries shown
  MAX_FINISHED:      3,   // max finished matches shown
  MAX_EVENTS:        6,   // max upcoming events shown
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
      // Storage quota exceeded — silently skip caching
    }
  },
};

// ═══════════════════════════════════════════════════════════════════
//  FETCH HELPER  (CORS-proxy auto-fallback)
// ═══════════════════════════════════════════════════════════════════
async function apiFetch(url, cacheKey = null, ttl = 0) {
  // Return cached copy if fresh
  if (cacheKey) {
    const hit = cache.get(cacheKey);
    if (hit !== null) return hit;
  }

  const attempt = async (targetUrl) => {
    const res = await fetch(targetUrl, {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} — ${targetUrl}`);
    return res.json();
  };

  let data;
  const directUrl = url;
  const proxyUrl  = CONFIG.PROXY_URL + encodeURIComponent(url);

  if (CONFIG.useProxy) {
    data = await attempt(proxyUrl);
  } else {
    try {
      data = await attempt(directUrl);
    } catch (err) {
      // Network / CORS error → switch to proxy for this session
      if (err instanceof TypeError || (err.message && err.message.includes('Failed to fetch'))) {
        console.info('[Elegance] CORS detected — switching to proxy for this session.');
        CONFIG.useProxy = true;
        data = await attempt(proxyUrl);
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
  if (diff < 60)               return 'just now';
  if (diff < 3600)             return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400)            return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 30)       return `${Math.floor(diff / 86400)}d ago`;
  if (diff < 86400 * 365)      return `${Math.floor(diff / (86400 * 30))}mo ago`;
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

/** Convert ISO-3166-1 alpha-2 country code to emoji flag */
function countryCodeToFlag(code) {
  if (!code || code.length !== 2) return '';
  try {
    return String.fromCodePoint(
      ...Array.from(code.toUpperCase()).map((c) => 0x1F1E6 + c.charCodeAt(0) - 65)
    );
  } catch {
    return '';
  }
}

/** Extract opponent club slug/name from a match object */
function getOpponentName(match) {
  // The match "name" field is usually something like "Elegance vs Rival Club"
  if (match.name) {
    const vsMatch = match.name.match(/vs\.?\s+(.+)/i);
    if (vsMatch) return vsMatch[1].trim();
    return match.name;
  }
  // Fallback: parse the opponent URL slug
  if (match.opponent) {
    const slug = String(match.opponent).split('/').filter(Boolean).pop() || '';
    return slug.replace(/-/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase());
  }
  return 'Unknown Club';
}

/** Build a skeleton members list for loading state */
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

  // Club icon
  if (data.icon) {
    iconEl.src = data.icon;
    iconEl.onload = () => {
      iconEl.classList.add('loaded');
      fallbackEl.classList.add('hidden');
    };
    iconEl.onerror = () => { /* keep fallback visible */ };
  }

  // Club name
  nameEl.textContent = data.name || 'Elegance';

  // Members + established year
  const count = data.members_count != null ? Number(data.members_count).toLocaleString() : '–';
  const year  = data.created ? extractYear(data.created) : '';
  subEl.innerHTML = `
    <span class="gold">${escHtml(count)}</span>
    <span class="sep">·</span>
    Est. ${escHtml(String(year))}
  `;

  // Description — strip HTML tags returned by the API
  if (data.description && data.description.trim()) {
    const tmp = document.createElement('div');
    tmp.innerHTML = data.description;
    descEl.textContent = tmp.textContent || tmp.innerText || '';
  }

  // Link
  if (data.url) linkEl.href = data.url;
}

// ═══════════════════════════════════════════════════════════════════
//  SECTION 2 — NEW TO THE CLUB (New Joiners)
// ═══════════════════════════════════════════════════════════════════
async function loadJoiners() {
  const list = document.getElementById('joiners-list');
  list.innerHTML = skeletonMemberList(CONFIG.MAX_JOINERS);

  const membersData = await apiFetch(
    `${CONFIG.API_BASE}/club/${CONFIG.CLUB_ID}/members`,
    'club:members',
    CONFIG.TTL.MEMBERS
  );

  // Merge weekly + monthly, deduplicate by username
  const seen = new Set();
  const combined = [...(membersData.weekly || []), ...(membersData.monthly || [])]
    .filter(({ username }) => {
      if (seen.has(username)) return false;
      seen.add(username);
      return true;
    });

  // Sort by join timestamp descending, take top N
  const recent = combined
    .sort((a, b) => (b.joined || 0) - (a.joined || 0))
    .slice(0, CONFIG.MAX_JOINERS);

  if (recent.length === 0) {
    list.innerHTML = `<li class="empty-state">No recent joiners found.</li>`;
    return;
  }

  // Render placeholder rows immediately
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

  // Enrich serially (avatar + title + flag)
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

    // Replace placeholder with avatar img or initial letter
    if (player.avatar) {
      const img = document.createElement('img');
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

    // Add title badge
    if (player.title) {
      nameEl.innerHTML = `
        <span class="member-title">${escHtml(player.title)}</span>${escHtml(username)}
      `;
    }

    // Add country flag
    if (player.country) {
      const countryCode = player.country.split('/').pop().toUpperCase();
      const flag = countryCodeToFlag(countryCode);
      if (flag) {
        const flagSpan = document.createElement('span');
        flagSpan.className = 'member-country';
        flagSpan.textContent = flag;
        flagSpan.title = countryCode;
        row.appendChild(flagSpan);
      }
    }
  } catch {
    // Silent — member still renders with initial letter
  }
}

// ═══════════════════════════════════════════════════════════════════
//  SECTION 3 — PLAYER OF THE MONTH
// ═══════════════════════════════════════════════════════════════════
async function loadPlayerOfMonth() {
  const card = document.getElementById('potm-card');

  try {
    const resp = await fetch('data/player-of-month.json');
    if (!resp.ok) throw new Error('no file');
    const potm = await resp.json();

    if (potm && potm.username) {
      renderPOTM(card, potm);
      return;
    }
  } catch { /* file missing or empty → compute live */ }

  // Live fallback: rank top weekly members by best rating
  await computeLivePOTM(card);
}

function renderPOTM(card, potm) {
  let avatarHtml;
  if (potm.avatar_url) {
    avatarHtml = `<img class="potm-avatar" src="${escHtml(potm.avatar_url)}" alt="${escHtml(potm.username)}"
                       onerror="this.outerHTML='<div class=\\'potm-avatar-placeholder\\'>♛</div>'">`;
  } else {
    avatarHtml = `<div class="potm-avatar-placeholder">♛</div>`;
  }

  let gainHtml = '';
  if (potm.gain != null) {
    if (potm.gain > 0) {
      gainHtml = `<span class="potm-gain-pos"> (+${potm.gain})</span>`;
    } else if (potm.gain < 0) {
      gainHtml = `<span class="potm-gain-neg"> (${potm.gain})</span>`;
    }
  }

  card.innerHTML = `
    ${avatarHtml}
    <div class="potm-info">
      <div class="potm-name">${escHtml(potm.username)}</div>
      <div class="potm-rating">
        ${escHtml(potm.format || 'Rapid')} ${potm.rating != null ? Number(potm.rating).toLocaleString() : '–'}${gainHtml}
      </div>
      ${potm.month ? `<div class="potm-month">${escHtml(potm.month)}</div>` : ''}
    </div>
  `;
}

async function computeLivePOTM(card) {
  // Show computing state
  card.innerHTML = `
    <div class="potm-avatar-placeholder skeleton" style="border:none; color:transparent; flex-shrink:0"></div>
    <div class="potm-info" style="flex:1">
      <div class="skeleton-block skeleton" style="height:14px; width:55%; border-radius:3px; margin-bottom:8px"></div>
      <div class="skeleton-block skeleton" style="height:11px; width:38%; border-radius:3px"></div>
    </div>
  `;

  try {
    const membersData = await apiFetch(
      `${CONFIG.API_BASE}/club/${CONFIG.CLUB_ID}/members`,
      'club:members',
      CONFIG.TTL.MEMBERS
    );

    const candidates = (membersData.weekly || []).slice(0, 10);
    let best = null;
    let bestRating = -1;

    // Rank by highest rapid (fallback blitz, then bullet)
    for (const member of candidates) {
      await sleep(CONFIG.ENRICH_DELAY_MS);
      try {
        const stats = await apiFetch(
          `${CONFIG.API_BASE}/player/${member.username}/stats`,
          `stats:${member.username}`,
          CONFIG.TTL.STATS
        );

        const rapid  = stats?.chess_rapid?.last?.rating  || 0;
        const blitz  = stats?.chess_blitz?.last?.rating  || 0;
        const bullet = stats?.chess_bullet?.last?.rating || 0;
        const top    = Math.max(rapid, blitz, bullet);
        const format = top === rapid ? 'Rapid' : top === blitz ? 'Blitz' : 'Bullet';

        if (top > bestRating) {
          bestRating = top;
          best = { username: member.username, rating: top, format };
        }
      } catch { /* skip member */ }
    }

    if (!best) {
      card.innerHTML = `<div class="empty-state" style="width:100%">Player of the Month — coming soon.</div>`;
      return;
    }

    // Fetch avatar
    let avatarHtml = `<div class="potm-avatar-placeholder">♛</div>`;
    try {
      await sleep(CONFIG.ENRICH_DELAY_MS);
      const player = await apiFetch(
        `${CONFIG.API_BASE}/player/${best.username}`,
        `player:${best.username}`,
        CONFIG.TTL.PLAYER
      );
      if (player.avatar) {
        avatarHtml = `<img class="potm-avatar" src="${escHtml(player.avatar)}" alt="${escHtml(best.username)}">`;
      }
    } catch { /* silent */ }

    const now     = new Date();
    const monthNm = now.toLocaleString('en-US', { month: 'long', year: 'numeric' });

    card.innerHTML = `
      ${avatarHtml}
      <div class="potm-info">
        <div class="potm-name">${escHtml(best.username)}</div>
        <div class="potm-rating">${escHtml(best.format)} ${Number(best.rating).toLocaleString()}</div>
        <div class="potm-month">${escHtml(monthNm)}</div>
      </div>
    `;
  } catch {
    card.innerHTML = `<div class="empty-state" style="width:100%">Player of the Month — coming soon.</div>`;
  }
}

// ═══════════════════════════════════════════════════════════════════
//  SECTION 4 — GAME OF THE MONTH
// ═══════════════════════════════════════════════════════════════════
async function loadGameOfMonth() {
  const card = document.getElementById('gotm-card');

  try {
    const resp = await fetch('data/game-of-month.json');
    if (!resp.ok) throw new Error('no file');
    const gotm = await resp.json();

    if (!gotm || !gotm.white) {
      card.innerHTML = `<div class="empty-state">This month's finest game — coming soon.</div>`;
      return;
    }

    const resultDisplay =
      gotm.result === '1-0' ? '1–0' :
      gotm.result === '0-1' ? '0–1' : '½–½';

    card.innerHTML = `
      <div class="gotm-matchup">
        <div class="gotm-player">
          <div class="gotm-player-name" title="${escHtml(gotm.white)}">${escHtml(gotm.white)}</div>
          <div class="gotm-player-color">White</div>
        </div>
        <div class="gotm-vs">${resultDisplay}</div>
        <div class="gotm-player">
          <div class="gotm-player-name" title="${escHtml(gotm.black)}">${escHtml(gotm.black)}</div>
          <div class="gotm-player-color">Black</div>
        </div>
      </div>
      <div class="gotm-board-wrap">
        <div id="gotm-board"></div>
      </div>
      ${gotm.blurb ? `<p class="gotm-blurb">"${escHtml(gotm.blurb)}"</p>` : ''}
      <a class="gotm-replay-btn"
         href="${escHtml(gotm.url || 'https://www.chess.com/games')}"
         target="_blank"
         rel="noopener noreferrer"
         id="gotm-replay-link">
        ▶ &nbsp;Replay on Chess.com
      </a>
    `;

    renderChessBoard(gotm.fen, gotm.pgn);

  } catch {
    card.innerHTML = `<div class="empty-state">This month's finest game — coming soon.</div>`;
  }
}

// ── SVG CHESS BOARD RENDERER (no external deps) ─────────────────
// Maps FEN piece codes to Unicode chess glyphs
const PIECE_GLYPHS = {
  K:'♔', Q:'♕', R:'♖', B:'♗', N:'♘', P:'♙',
  k:'♚', q:'♛', r:'♜', b:'♝', n:'♞', p:'♟',
};

function renderChessBoard(fen, pgn) {
  const container = document.getElementById('gotm-board');
  if (!container) return;

  let position = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR';

  if (fen && fen.trim()) {
    // FEN has multiple parts — we only need the first (piece placement)
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

  // Parse FEN piece placement into an 8×8 grid
  const rows = position.split('/');
  const grid = rows.map(row => {
    const cells = [];
    for (const ch of row) {
      if (/\d/.test(ch)) {
        for (let i = 0; i < parseInt(ch); i++) cells.push('');
      } else {
        cells.push(ch);
      }
    }
    return cells;
  });

  // Colours matching the Elegance design system
  const LIGHT_SQ = '#E4D9BF';
  const DARK_SQ  = '#2C2417';
  const WHITE_PC = '#F5F1E8';
  const BLACK_PC = '#1A1208';
  const SQ_SIZE  = 36; // each square in px
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

      // Square background
      const rect = document.createElementNS(svgNS, 'rect');
      rect.setAttribute('x', x);
      rect.setAttribute('y', y);
      rect.setAttribute('width',  SQ_SIZE);
      rect.setAttribute('height', SQ_SIZE);
      rect.setAttribute('fill', isLight ? LIGHT_SQ : DARK_SQ);
      svg.appendChild(rect);

      // Piece
      const piece = grid[r]?.[f] || '';
      if (piece) {
        const glyph = PIECE_GLYPHS[piece];
        const isWhite = piece === piece.toUpperCase();
        if (glyph) {
          const text = document.createElementNS(svgNS, 'text');
          text.setAttribute('x',   x + SQ_SIZE / 2);
          text.setAttribute('y',   y + SQ_SIZE / 2 + 1);
          text.setAttribute('text-anchor',   'middle');
          text.setAttribute('dominant-baseline', 'central');
          text.setAttribute('font-size',     SQ_SIZE * 0.72);
          text.setAttribute('fill', isWhite ? WHITE_PC : BLACK_PC);
          // Stroke gives pieces contrast on any square colour
          text.setAttribute('stroke', isWhite ? '#6B5D3A' : '#C9A959');
          text.setAttribute('stroke-width', '0.4');
          text.setAttribute('paint-order', 'stroke');
          text.textContent = glyph;
          svg.appendChild(text);
        }
      }
    }
  }

  // Thin gold border around the board
  const border = document.createElementNS(svgNS, 'rect');
  border.setAttribute('x', '0.5');
  border.setAttribute('y', '0.5');
  border.setAttribute('width',  BOARD - 1);
  border.setAttribute('height', BOARD - 1);
  border.setAttribute('fill',   'none');
  border.setAttribute('stroke', '#C9A959');
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

  // Classify Vote Chess by name containing "vote" (case-insensitive)
  const isVote = (m) => /vote/i.test(m.name || '');

  const voteActive  = [...inProgress.filter(isVote), ...registered.filter(isVote)];
  const dailyInProg = inProgress.filter((m) => !isVote(m));
  const dailyReg    = registered.filter((m) => !isVote(m));
  const dailyFin    = finished.filter((m)   => !isVote(m)).slice(0, CONFIG.MAX_FINISHED);

  renderVoteChess(voteActive);
  renderDailyMatches(dailyInProg, dailyReg, dailyFin);

  // Upcoming events merges registered matches + manual events.json
  await renderUpcomingEvents(registered);
}

function renderVoteChess(matches) {
  const container = document.getElementById('vote-list');

  if (!matches.length) {
    container.innerHTML = `<div class="empty-state">No active Vote Chess matches.</div>`;
    return;
  }

  container.innerHTML = '';
  const shown = matches.slice(0, CONFIG.MAX_VOTE);

  shown.forEach((m, i) => {
    const isLive  = inProgressUrl(m);
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
    more.className = 'empty-state';
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
  wrap.style.display = 'flex';
  wrap.style.flexDirection = 'column';
  wrap.style.gap = '8px';

  // In-progress bucket
  if (inProg.length) {
    const row = document.createElement('div');
    row.className = 'match-bucket-row';
    row.innerHTML = `
      <span class="match-bucket-label">
        <span class="badge badge--live">In Progress</span>
      </span>
      <span class="match-bucket-count">${inProg.length}</span>
    `;
    wrap.appendChild(row);

    // Show up to 3 opponent names
    inProg.slice(0, 3).forEach((m) => {
      const card = document.createElement('div');
      card.className = 'match-card';
      card.style.marginTop = '-4px';
      card.style.borderTop = 'none';
      card.style.borderRadius = '0 0 10px 10px';
      card.innerHTML = `
        <div class="match-opponent">vs ${escHtml(getOpponentName(m))}</div>
      `;
      wrap.appendChild(card);
    });
  }

  // Registered bucket
  if (registered.length) {
    const row = document.createElement('div');
    row.className = 'match-bucket-row';
    row.innerHTML = `
      <span class="match-bucket-label">
        <span class="badge badge--registered">Registered</span>
      </span>
      <span class="match-bucket-count">${registered.length}</span>
    `;
    wrap.appendChild(row);
  }

  // Recent finished
  if (finished.length) {
    const header = document.createElement('div');
    header.style.cssText = 'font-size:10px;text-transform:uppercase;letter-spacing:.12em;color:var(--ivory-faint);padding:4px 2px 2px;font-weight:500;';
    header.textContent = 'Recent Results';
    wrap.appendChild(header);

    finished.forEach((m) => {
      const result = (m.result || '').toLowerCase();
      const badgeClass = result === 'win'  ? 'badge--win'  :
                         result === 'loss' ? 'badge--loss' : 'badge--draw';
      const label      = result === 'win'  ? 'Win'  :
                         result === 'loss' ? 'Loss' : 'Draw';

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

  // Load manual events
  let manual = [];
  try {
    const resp = await fetch('data/events.json');
    if (resp.ok) manual = await resp.json();
  } catch { /* OK — file optional */ }

  // Convert registered matches to event objects
  const matchEvents = registeredMatches
    .filter((m) => m.start_time || m.name)
    .map((m) => ({
      title:      m.name || `vs ${getOpponentName(m)}`,
      subtitle:   `Team Match · ${(m.time_class || 'daily').replace(/_/g, ' ')}`,
      start_time: m.start_time || null,
      url:        m['@id']     || null,
      source:     'api',
    }));

  // Merge & sort (null start_time goes last)
  const all = [...matchEvents, ...manual].sort((a, b) => {
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

// Detect if match is in-progress based on its @id URL
function inProgressUrl(match) {
  return /\/in-progress\//i.test(match['@id'] || '');
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
          <img class="puzzle-image"
               src="${escHtml(puzzle.image)}"
               alt="${escHtml(puzzle.title || 'Daily chess puzzle')}"
               loading="lazy">
        </a>
      ` : ''}
      ${puzzle.title ? `<div class="puzzle-title">${escHtml(puzzle.title)}</div>` : ''}
      <p class="puzzle-sub">Study the position, then solve on Chess.com.</p>
      <a class="puzzle-link"
         href="${escHtml(puzzle.url || 'https://www.chess.com/puzzles')}"
         target="_blank"
         rel="noopener noreferrer"
         id="puzzle-solve-link">
        ▶ &nbsp;Solve Today's Puzzle
      </a>
    `;
  } catch {
    card.innerHTML = `
      <p class="puzzle-sub" style="font-style:italic; color:var(--ivory-faint)">
        Today's puzzle could not be loaded.
      </p>
      <a class="puzzle-link"
         href="https://www.chess.com/puzzles"
         target="_blank"
         rel="noopener noreferrer"
         id="puzzle-fallback-link">
        ▶ &nbsp;Browse Puzzles
      </a>
    `;
  }
}

// ═══════════════════════════════════════════════════════════════════
//  FOOTER — REFRESH TIMESTAMP
// ═══════════════════════════════════════════════════════════════════
function updateFooter() {
  const el = document.getElementById('footer-refresh');
  if (!el) return;

  const now = Math.floor(Date.now() / 1000);
  el.textContent = `Refreshed ${relativeTime(now)}`;

  // Tick every minute
  setTimeout(updateFooter, 60_000);
}

// ═══════════════════════════════════════════════════════════════════
//  INIT — orchestrate all sections
// ═══════════════════════════════════════════════════════════════════
async function init() {
  // Header loads first (it's above the fold)
  try {
    await loadHeader();
  } catch (e) {
    console.error('[Elegance] Header failed:', e);
  }

  // All other sections run concurrently (each section handles its own errors)
  await Promise.allSettled([
    loadJoiners(),
    loadPlayerOfMonth(),
    loadGameOfMonth(),
    loadMatches(),
    loadPuzzle(),
  ]);

  updateFooter();
}

// Kick off when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
