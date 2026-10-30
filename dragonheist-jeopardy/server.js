// Dragon Heist Jeopardy — tiny real-time game server.
// Players join on their phones at "/", the host runs the board at "/host".
const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'changeme';
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const STATE_FILE = path.join(DATA_DIR, 'state.json');
const Q = JSON.parse(fs.readFileSync(path.join(__dirname, 'questions.json'), 'utf8'));

if (ADMIN_PASSWORD === 'changeme') {
  console.warn('[jeopardy] ADMIN_PASSWORD is not set, so the host password is "changeme". Set ADMIN_PASSWORD in your Railway variables.');
}

const ROWS = Q.categories[0].clues.length;
const MAX_VALUE = Math.max(...Q.categories.flatMap(c => c.clues.map(x => x.value)));

// ---------- state ----------
function pickDailyDouble(used) {
  // Any unused tile outside the top (cheapest) row.
  const options = [];
  Q.categories.forEach((cat, c) => cat.clues.forEach((_, r) => {
    if ((ROWS === 1 || r > 0) && !(used && used[c][r])) options.push({ c, r });
  }));
  return options.length ? options[Math.floor(Math.random() * options.length)] : null;
}
const freshFinal = () => ({ phase: 'off', wagers: {}, responses: {}, judged: {} });
function freshState(players = {}) {
  const used = Q.categories.map(cat => cat.clues.map(() => false));
  return { players, used, dailyDouble: pickDailyDouble(used), current: null, final: freshFinal() };
}
function loadState() {
  try {
    const s = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    const shapeOk = Array.isArray(s.used) && s.used.length === Q.categories.length &&
      s.used.every((col, i) => Array.isArray(col) && col.length === Q.categories[i].clues.length);
    if (shapeOk && s.players && s.final) return s;
  } catch { /* no saved game yet */ }
  return freshState();
}
let state = loadState();

let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(STATE_FILE, JSON.stringify(state));
    } catch (e) { console.error('[jeopardy] could not save state:', e.message); }
  }, 250);
}

// ---------- helpers ----------
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const toInt = v => { const n = Math.round(Number(v)); return Number.isFinite(n) ? n : null; };
const cleanId = v => (typeof v === 'string' && /^[\w-]{6,64}$/.test(v) ? v : null);
const cleanText = (v, max) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const sign = v => (v === 'correct' ? 1 : v === 'wrong' ? -1 : 0);
const clueAt = (c, r) => Q.categories[c] && Q.categories[c].clues[r];

// ---------- views (what each screen is allowed to see) ----------
function onlineIds() {
  const s = new Set();
  wss.clients.forEach(ws => { if (ws.readyState === 1 && ws.playerId) s.add(ws.playerId); });
  return s;
}
function baseView(isHost) {
  const online = onlineIds();
  // While the host judges Final Jeopardy, everyone else keeps seeing pre-final scores until the reveal.
  const f = state.final;
  const shownScore = (id, p) => (!isHost && f.phase === 'judging')
    ? p.score - sign(f.judged[id]) * (f.wagers[id] || 0)
    : p.score;
  return {
    title: Q.title,
    categories: Q.categories.map(c => c.name),
    values: Q.categories.map(c => c.clues.map(x => x.value)),
    maxValue: MAX_VALUE,
    used: state.used,
    players: Object.entries(state.players)
      .map(([id, p], seat) => ({ id, seat, name: p.name, score: shownScore(id, p), online: online.has(id) }))
      .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name)),
  };
}
function currentView(isHost) {
  const cur = state.current;
  if (!cur) return null;
  const q = clueAt(cur.c, cur.r);
  return {
    c: cur.c, r: cur.r, value: cur.value, category: Q.categories[cur.c].name,
    isDD: cur.isDD, ddPlayer: cur.ddPlayer, ddWager: cur.ddWager,
    phase: cur.phase,
    clue: cur.phase === 'clue' || isHost ? q.clue : null,
    answer: cur.answerShown || isHost ? q.answer : null,
    answerShown: cur.answerShown,
    buzzOpen: cur.buzzOpen, queue: cur.queue, locked: cur.locked,
    results: cur.results,
  };
}
function finalView(isHost, pid) {
  const f = state.final;
  const on = f.phase !== 'off';
  const clueOut = ['clue', 'judging', 'reveal'].includes(f.phase);
  const out = {
    phase: f.phase,
    category: on ? Q.final.category : null,
    clue: clueOut || (isHost && on) ? Q.final.clue : null,
    answer: f.phase === 'reveal' || (isHost && on) ? Q.final.answer : null,
    wagered: Object.keys(f.wagers),
    responded: Object.keys(f.responses),
  };
  if (isHost || f.phase === 'reveal') Object.assign(out, { wagers: f.wagers, responses: f.responses, judged: f.judged });
  if (pid) out.mine = { wager: f.wagers[pid] ?? null, response: f.responses[pid] ?? null };
  return out;
}

function send(ws, obj) { if (ws.readyState === 1) ws.send(JSON.stringify(obj)); }
function broadcast() {
  const views = { host: baseView(true), other: baseView(false) };
  wss.clients.forEach(ws => {
    if (ws.readyState !== 1 || !ws.role) return;
    const isHost = ws.role === 'host';
    const base = isHost ? views.host : views.other;
    const msg = { type: 'state', ...base, current: currentView(isHost), final: finalView(isHost, isHost ? null : ws.playerId) };
    if (isHost) { msg.dailyDouble = state.dailyDouble; msg.questions = Q; }
    else {
      const p = state.players[ws.playerId];
      const mine = base.players.find(x => x.id === ws.playerId);
      msg.you = p ? { id: ws.playerId, name: p.name, score: mine ? mine.score : p.score } : null;
    }
    send(ws, msg);
  });
}
const changed = () => { save(); broadcast(); };

// ---------- player actions ----------
function handlePlayer(ws, m) {
  const id = ws.playerId;
  const p = state.players[id];
  const cur = state.current;
  const f = state.final;

  switch (m.type) {
    case 'join': {
      const name = cleanText(m.name, 24);
      if (!name) return send(ws, { type: 'error', message: 'Enter a name to join.' });
      if (p) p.name = name; else state.players[id] = { name, score: 0 };
      return changed();
    }
    case 'buzz': {
      if (!p || !cur || cur.isDD || cur.phase !== 'clue' || !cur.buzzOpen || cur.answerShown) return;
      if (cur.queue.includes(id) || cur.locked.includes(id)) return;
      cur.queue.push(id);
      return changed();
    }
    case 'ddWager': {
      if (!p || !cur || !cur.isDD || cur.phase !== 'dd' || cur.ddPlayer !== id) return;
      const n = toInt(m.amount); if (n === null) return;
      cur.ddWager = clamp(n, 0, Math.max(p.score, MAX_VALUE));
      return changed();
    }
    case 'finalWager': {
      if (!p || f.phase !== 'wager') return;
      const n = toInt(m.amount); if (n === null) return;
      f.wagers[id] = clamp(n, 0, Math.max(p.score, 0));
      return changed();
    }
    case 'finalResponse': {
      if (!p || f.phase !== 'clue') return;
      f.responses[id] = cleanText(m.text, 200);
      return changed();
    }
  }
}

// ---------- host actions ----------
function handleHost(ws, m) {
  const cur = state.current;
  const f = state.final;
  const player = pid => state.players[pid];

  switch (m.type) {
    case 'openClue': {
      const c = toInt(m.c), r = toInt(m.r);
      if (cur || f.phase !== 'off' || !clueAt(c, r) || state.used[c][r]) return;
      const dd = state.dailyDouble;
      const isDD = !!dd && dd.c === c && dd.r === r;
      state.current = {
        c, r, value: clueAt(c, r).value, isDD,
        ddPlayer: null, ddWager: null,
        phase: isDD ? 'dd' : 'clue',
        answerShown: false, buzzOpen: false, queue: [], locked: [], results: {},
      };
      return changed();
    }
    case 'ddSetPlayer': {
      if (!cur || !cur.isDD || cur.phase !== 'dd') return;
      if (m.playerId && !player(m.playerId)) return;
      cur.ddPlayer = m.playerId || null; cur.ddWager = null;
      return changed();
    }
    case 'ddSetWager': {
      if (!cur || !cur.isDD || cur.phase !== 'dd' || !player(cur.ddPlayer)) return;
      const n = toInt(m.amount); if (n === null) return;
      cur.ddWager = clamp(n, 0, Math.max(player(cur.ddPlayer).score, MAX_VALUE));
      return changed();
    }
    case 'ddShowClue': {
      if (!cur || cur.phase !== 'dd' || !cur.ddPlayer || cur.ddWager === null) return;
      cur.phase = 'clue';
      return changed();
    }
    case 'openBuzzers': if (cur && !cur.isDD && cur.phase === 'clue' && !cur.answerShown) { cur.buzzOpen = true; changed(); } return;
    case 'closeBuzzers': if (cur) { cur.buzzOpen = false; changed(); } return;
    case 'resetBuzzers': if (cur) { cur.queue = []; cur.locked = []; changed(); } return;
    case 'judge': {
      if (!cur || cur.phase !== 'clue') return;
      const pid = m.playerId; const p = player(pid);
      if (!p || cur.results[pid]) return;
      if (cur.isDD) {
        if (pid !== cur.ddPlayer) return;
        p.score += (m.correct ? 1 : -1) * cur.ddWager;
        cur.results[pid] = m.correct ? 'correct' : 'wrong';
        cur.answerShown = true;
        return changed();
      }
      if (!cur.queue.includes(pid)) return;
      cur.results[pid] = m.correct ? 'correct' : 'wrong';
      if (m.correct) {
        p.score += cur.value;
        cur.buzzOpen = false; cur.answerShown = true; cur.queue = [];
      } else {
        p.score -= cur.value;
        cur.queue = cur.queue.filter(x => x !== pid);
        cur.locked.push(pid);
      }
      return changed();
    }
    case 'revealAnswer': if (cur && cur.phase === 'clue') { cur.answerShown = true; cur.buzzOpen = false; changed(); } return;
    case 'closeClue': {
      if (!cur) return;
      if (m.markUsed) state.used[cur.c][cur.r] = true;
      state.current = null;
      return changed();
    }
    case 'adjustScore': {
      const p = player(m.playerId); const d = toInt(m.delta);
      if (p && d !== null) { p.score += d; changed(); }
      return;
    }
    case 'setScore': {
      const p = player(m.playerId); const n = toInt(m.score);
      if (p && n !== null) { p.score = n; changed(); }
      return;
    }
    case 'removePlayer': {
      if (!player(m.playerId)) return;
      delete state.players[m.playerId];
      if (cur) {
        cur.queue = cur.queue.filter(x => x !== m.playerId);
        if (cur.ddPlayer === m.playerId && cur.phase === 'dd') { cur.ddPlayer = null; cur.ddWager = null; }
      }
      return changed();
    }
    case 'unuseTile': {
      const c = toInt(m.c), r = toInt(m.r);
      if (!cur && clueAt(c, r)) { state.used[c][r] = false; changed(); }
      return;
    }
    case 'rerollDailyDouble': if (!cur) { state.dailyDouble = pickDailyDouble(state.used); changed(); } return;

    // Final Jeopardy
    case 'finalStart': if (!cur && f.phase === 'off') { state.final = freshFinal(); state.final.phase = 'wager'; changed(); } return;
    case 'finalShowClue': if (f.phase === 'wager') { f.phase = 'clue'; changed(); } return;
    case 'finalLock': if (f.phase === 'clue') { f.phase = 'judging'; changed(); } return;
    case 'finalJudge': {
      if (!['judging', 'reveal'].includes(f.phase)) return;
      const p = player(m.playerId); if (!p) return;
      const prev = f.judged[m.playerId];
      const next = m.correct ? 'correct' : 'wrong';
      if (prev === next) return;
      p.score += (sign(next) - sign(prev)) * (f.wagers[m.playerId] || 0);
      f.judged[m.playerId] = next;
      return changed();
    }
    case 'finalReveal': if (f.phase === 'judging') { f.phase = 'reveal'; changed(); } return;
    case 'finalEnd': if (f.phase !== 'off') { f.phase = 'off'; changed(); } return;

    case 'resetGame': {
      const players = {};
      for (const [id, p] of Object.entries(state.players)) players[id] = { name: p.name, score: 0 };
      state = freshState(m.keepPlayers === false ? {} : players);
      return changed();
    }
  }
}

// ---------- server ----------
const app = express();
app.use(express.static(path.join(__dirname, 'public')));
app.get('/host', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'host.html')));
app.get('/overlay', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'overlay.html')));
app.get('/board', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'board.html')));
app.get('/health', (_req, res) => res.send('ok'));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

wss.on('connection', ws => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', raw => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (!m || typeof m.type !== 'string') return;
    try {
      if (m.type === 'hello') {
        if (m.role === 'host') {
          if (m.password !== ADMIN_PASSWORD) return send(ws, { type: 'error', code: 'bad_password', message: 'That password doesn’t match ADMIN_PASSWORD.' });
          ws.role = 'host';
        } else if (m.role === 'overlay') {
          ws.role = 'overlay'; // read-only stream view, sees what players see
        } else {
          const id = cleanId(m.id);
          if (!id) return;
          ws.role = 'player'; ws.playerId = id;
        }
        send(ws, { type: 'welcome', role: ws.role });
        return broadcast();
      }
      if (ws.role === 'player') handlePlayer(ws, m);
      else if (ws.role === 'host') handleHost(ws, m);
    } catch (e) { console.error('[jeopardy] error handling', m.type, e); }
  });
  ws.on('close', () => broadcast());
});

// Keep connections alive through proxies, and drop dead phones.
setInterval(() => {
  wss.clients.forEach(ws => {
    if (!ws.isAlive) return ws.terminate();
    ws.isAlive = false; ws.ping();
  });
}, 25000);

server.listen(PORT, () => console.log(`[jeopardy] running on port ${PORT}. Players: /  Host: /host`));
