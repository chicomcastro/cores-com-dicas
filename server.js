const express = require('express');
const http = require('http');
const path = require('path');
const os = require('os');
const QRCode = require('qrcode');
const { Server } = require('socket.io');
const colors = require('./public/js/colors');

const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || null;
const app = express();
const server = http.createServer(app);
const io = new Server(server);

const BUILD = Date.now().toString(36);
const fs = require('fs');

/* ---------- FIRESTORE (optional) ---------- */
let db = null;
const FIRESTORE_PROJECT = process.env.FIRESTORE_PROJECT || null;
if (FIRESTORE_PROJECT) {
  try {
    const { Firestore } = require('@google-cloud/firestore');
    db = new Firestore({ projectId: FIRESTORE_PROJECT });
    console.log(`Firestore enabled (project: ${FIRESTORE_PROJECT})`);
  } catch (e) {
    console.warn('Firestore not available:', e.message);
  }
}

const ROOMS_COLLECTION = 'rooms';
const debounceTimers = new Map();
function persistRoom(code) {
  if (!db) return;
  if (debounceTimers.has(code)) clearTimeout(debounceTimers.get(code));
  debounceTimers.set(code, setTimeout(async () => {
    debounceTimers.delete(code);
    const room = rooms.get(code);
    if (!room) {
      try { await db.collection(ROOMS_COLLECTION).doc(code).delete(); } catch (e) {}
      return;
    }
    try {
      const snap = { ...room.state, _lastActivity: Date.now() };
      delete snap.socketId; // strip transient socket refs
      const players = (snap.players || []).map(p => ({ ...p, socketId: null }));
      await db.collection(ROOMS_COLLECTION).doc(code).set({ ...snap, players }, { merge: false });
    } catch (e) {
      console.warn(`Firestore write failed for room ${code}:`, e.message);
    }
  }, 500));
}

async function loadRoomsFromFirestore() {
  if (!db) return;
  try {
    const snapshot = await db.collection(ROOMS_COLLECTION).get();
    const cutoff = Date.now() - 4 * 60 * 60 * 1000;
    for (const doc of snapshot.docs) {
      const data = doc.data();
      if (data._lastActivity && data._lastActivity < cutoff) {
        await doc.ref.delete();
        continue;
      }
      const code = doc.id;
      delete data._lastActivity;
      const state = data;
      if (state.players) state.players.forEach(p => { p.socketId = null; });
      rooms.set(code, {
        state,
        socketBindings: new Map(),
        board: colors.generateBoard(state.gridCols || 30, state.gridRows || 18),
        cellById: null,
      });
      const room = rooms.get(code);
      room.cellById = new Map(room.board.map(c => [c.id, c]));
      console.log(`Restored room ${code} (${state.status}, ${(state.players || []).length} players)`);
    }
  } catch (e) {
    console.warn('Failed to load rooms from Firestore:', e.message);
  }
}

/* ---------- HTML SERVING ---------- */
function serveHtml(file) {
  const raw = fs.readFileSync(path.join(__dirname, 'public', file), 'utf8');
  const html = raw.replace(/__BUILD__/g, BUILD);
  return (_req, res) => { res.type('html').send(html); };
}

app.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
app.get('/', (_req, res) => res.redirect('/board'));
app.get('/board', serveHtml('board.html'));
app.get('/player', serveHtml('player.html'));
app.use(express.static(path.join(__dirname, 'public')));

/* ---------- ROOM CODE GENERATION ---------- */
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function generateCode(len = 4) {
  let code;
  do {
    code = '';
    for (let i = 0; i < len; i++) code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  } while (rooms.has(code));
  return code;
}

/* ---------- GRID ---------- */
const GRID_PRESETS = [
  { cols: 15, rows: 9 },
  { cols: 20, rows: 12 },
  { cols: 30, rows: 18 },
];

/* ---------- NETWORK ---------- */
function getLocalIp() {
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const iface of ifaces || []) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return 'localhost';
}
const LOCAL_IP = getLocalIp();

function getBaseUrl(req) {
  if (BASE_URL) return BASE_URL;
  return `http://${LOCAL_IP}:${PORT}`;
}

app.get('/qr', async (req, res) => {
  try {
    const roomCode = req.query.room || '';
    const base = getBaseUrl(req);
    const url = roomCode ? `${base}/player?room=${roomCode}` : `${base}/player`;
    const qr = await QRCode.toDataURL(url, { margin: 1, width: 320 });
    res.json({ url, ip: LOCAL_IP, qr });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ---------- GAME CONSTANTS ---------- */
const PLAYER_COLORS = [
  '#e63946', '#4a90d9', '#2a9d8f', '#f4a261', '#7209b7',
  '#06aed5', '#80b918', '#ff006e', '#3a86ff', '#fb8500'
];

function normalizeWord(w) {
  return (w || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z]/g, '');
}

const BLOCKED_CLUE_WORDS = new Set([
  'vermelho', 'vermelha', 'azul', 'azulado', 'azulada', 'verde', 'verdoso', 'verdosa',
  'amarelo', 'amarela', 'amarelado', 'laranja', 'alaranjado', 'roxo', 'roxa',
  'rosa', 'rosado', 'rosada', 'marrom', 'cinza', 'cinzento', 'cinzenta',
  'branco', 'branca', 'preto', 'preta', 'violeta', 'indigo', 'ciano', 'magenta',
  'turquesa', 'salmao', 'lilas', 'creme', 'dourado', 'dourada', 'prateado', 'prateada',
  'bege', 'bordo', 'bordeaux', 'oliva', 'caqui', 'fucsia', 'carmim', 'escarlate',
  'red', 'blue', 'green', 'yellow', 'orange', 'purple', 'pink', 'brown',
  'gray', 'grey', 'white', 'black', 'cyan', 'magenta', 'violet', 'tan',
  'olive', 'teal', 'navy', 'maroon', 'gold', 'silver', 'beige'
].map(normalizeWord));

function isClueBlocked(text) {
  return text.split(/\s+/).some(w => BLOCKED_CLUE_WORDS.has(normalizeWord(w)));
}

/* ---------- ROOM STATE ---------- */
const rooms = new Map();

function freshState() {
  return {
    status: 'lobby',
    lobbyPlayers: [],
    players: [],
    rounds: 1,
    currentRound: 1,
    activeIdx: 0,
    turnsTaken: 0,
    totalTurns: 0,
    phase: 'lobby',
    secretCellId: null,
    clue1: null,
    clue2: null,
    markers: {},
    pendingMarkers: [],
    gridCols: 30,
    gridRows: 18,
    password: null,
    lastClueGiver: null,
    roundScores: null,
    revealCell: null,
    finalScores: null
  };
}

function createRoom(opts = {}) {
  const code = generateCode();
  const state = freshState();
  if (opts.password) state.password = String(opts.password).trim().slice(0, 20);
  if (typeof opts.gridSize === 'number' && GRID_PRESETS[opts.gridSize]) {
    state.gridCols = GRID_PRESETS[opts.gridSize].cols;
    state.gridRows = GRID_PRESETS[opts.gridSize].rows;
  }
  const board = colors.generateBoard(state.gridCols, state.gridRows);
  rooms.set(code, {
    state,
    socketBindings: new Map(),
    board,
    cellById: new Map(board.map(c => [c.id, c])),
    _createdAt: Date.now(),
  });
  return code;
}

function getRoom(code) {
  return rooms.get((code || '').toUpperCase()) || null;
}

function socketRoom(socket) {
  return socket._roomCode || null;
}

function getRoomForSocket(socket) {
  const code = socketRoom(socket);
  return code ? getRoom(code) : null;
}

/* ---------- ROOM CLEANUP ---------- */
const ROOM_TTL = 60 * 60 * 1000;
setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (room._createdAt && now - room._createdAt > ROOM_TTL) {
      io.to(code).emit('room_expired');
      rooms.delete(code);
      if (db) {
        db.collection(ROOMS_COLLECTION).doc(code).delete().catch(() => {});
      }
      console.log(`[Room] Expired room ${code} (>1h)`);
    }
  }
}, 5 * 60 * 1000);

/* ---------- GAME LOGIC ---------- */
function publicState(room, code) {
  const state = room.state;
  const reveal = state.phase === 'reveal' || state.phase === 'end';
  const connectedNames = new Set([...room.socketBindings.values()]);
  return {
    roomCode: code,
    status: state.status,
    phase: state.phase,
    lobbyPlayers: state.lobbyPlayers,
    lobbyConnected: state.lobbyPlayers.reduce((acc, n) => {
      acc[n] = connectedNames.has(n);
      return acc;
    }, {}),
    players: state.players.map(p => ({
      name: p.name,
      color: p.color,
      score: p.score,
      connected: !!p.socketId
    })),
    rounds: state.rounds,
    currentRound: state.currentRound,
    activeIdx: state.activeIdx,
    activeName: state.players[state.activeIdx]?.name || null,
    turnsTaken: state.turnsTaken,
    totalTurns: state.totalTurns,
    clue1: state.clue1,
    clue2: state.clue2,
    markers: state.markers,
    pendingMarkers: state.pendingMarkers,
    lastClueGiver: state.lastClueGiver,
    roundScores: state.roundScores,
    revealCell: reveal ? state.revealCell : null,
    finalScores: state.finalScores,
    boardCols: state.gridCols,
    boardRows: state.gridRows,
    hasPassword: !!state.password
  };
}

function broadcast(room, code) {
  const ps = publicState(room, code);
  io.to(`room:${code}`).emit('game_state', ps);
  sendSecretToActive(room, code);
  room._lastActivity = Date.now();
  persistRoom(code);
}

function sendSecretToActive(room) {
  const state = room.state;
  const active = state.players[state.activeIdx];
  if (!active) return;
  if (!['clue1', 'markers1', 'clue2', 'markers2'].includes(state.phase)) return;
  if (!active.socketId) return;
  const cell = room.cellById.get(state.secretCellId);
  if (!cell) return;
  io.to(active.socketId).emit('your_secret', {
    col: cell.col, row: cell.row,
    id: cell.id, hsl: colors.cellHsl(cell)
  });
}

function startTurn(room, code) {
  const state = room.state;
  const cell = room.board[Math.floor(Math.random() * room.board.length)];
  state.secretCellId = cell.id;
  state.clue1 = null;
  state.clue2 = null;
  state.markers = {};
  state.pendingMarkers = [];
  state.roundScores = null;
  state.revealCell = null;
  state.phase = 'clue1';
  state.currentRound = Math.floor(state.turnsTaken / Math.max(1, state.players.length)) + 1;
  broadcast(room, code);
}

function startGame(room, code, playerNames, cols, rows) {
  const state = room.state;
  const cleaned = (playerNames || [])
    .map(n => (typeof n === 'string' ? n.trim() : ''))
    .filter(Boolean);
  const unique = [...new Set(cleaned)];
  if (unique.length < 2 || unique.length > 10) {
    return { ok: false, reason: 'Número de jogadores deve ser entre 2 e 10.' };
  }
  const shuffled = [...unique].sort(() => Math.random() - 0.5);

  const previousBindings = new Map();
  for (const p of state.players) {
    if (p.socketId) previousBindings.set(p.name, p.socketId);
  }
  for (const [sid, name] of room.socketBindings.entries()) {
    if (!previousBindings.has(name)) previousBindings.set(name, sid);
  }

  const preset = GRID_PRESETS.find(p => p.cols === cols && p.rows === rows) || GRID_PRESETS[2];
  room.board = colors.generateBoard(preset.cols, preset.rows);
  room.cellById = new Map(room.board.map(c => [c.id, c]));

  const newState = freshState();
  newState.gridCols = preset.cols;
  newState.gridRows = preset.rows;
  newState.status = 'playing';
  newState.lobbyPlayers = shuffled;
  newState.players = shuffled.map((name, i) => ({
    name,
    color: PLAYER_COLORS[i % PLAYER_COLORS.length],
    score: 0,
    socketId: previousBindings.get(name) || null
  }));
  newState.rounds = unique.length >= 7 ? 1 : 2;
  newState.totalTurns = newState.rounds * newState.players.length;
  newState.activeIdx = 0;
  newState.turnsTaken = 0;
  room.state = newState;
  startTurn(room, code);
  return { ok: true };
}

function submitClue(room, code, socket, payload) {
  const state = room.state;
  const active = state.players[state.activeIdx];
  if (!active) return socket.emit('clue_rejected', { reason: 'Jogo não está ativo.' });
  if (active.socketId !== socket.id) return socket.emit('clue_rejected', { reason: 'Apenas o jogador da vez pode enviar a dica.' });
  const round = payload && payload.round;
  const skip = !!(payload && payload.skip);
  const raw = (payload && typeof payload.clue === 'string') ? payload.clue.trim() : '';

  if (state.phase === 'clue1' && round === 1) {
    if (skip) {
      state.clue1 = null;
      state.phase = 'markers1';
      state.pendingMarkers = state.players.filter((_, i) => i !== state.activeIdx).map(p => p.name);
      broadcast(room, code);
      return;
    }
    if (!raw) return socket.emit('clue_rejected', { reason: 'Digite uma dica.' });
    const words = raw.split(/\s+/);
    if (words.length !== 1) return socket.emit('clue_rejected', { reason: 'Use exatamente 1 palavra.' });
    if (isClueBlocked(raw)) return socket.emit('clue_rejected', { reason: 'Nomes de cores não são permitidos.' });
    state.clue1 = raw;
    state.phase = 'markers1';
    state.pendingMarkers = state.players.filter((_, i) => i !== state.activeIdx).map(p => p.name);
    broadcast(room, code);
    return;
  }
  if (state.phase === 'clue2' && round === 2) {
    if (skip) {
      state.clue2 = null;
      state.phase = 'markers2';
      state.pendingMarkers = state.players.filter((_, i) => i !== state.activeIdx).map(p => p.name);
      broadcast(room, code);
      return;
    }
    if (!raw) return socket.emit('clue_rejected', { reason: 'Digite uma dica.' });
    const words = raw.split(/\s+/);
    if (words.length < 1 || words.length > 2) return socket.emit('clue_rejected', { reason: 'Use até 2 palavras.' });
    if (isClueBlocked(raw)) return socket.emit('clue_rejected', { reason: 'Nomes de cores não são permitidos.' });
    state.clue2 = raw;
    state.phase = 'markers2';
    state.pendingMarkers = state.players.filter((_, i) => i !== state.activeIdx).map(p => p.name);
    broadcast(room, code);
    return;
  }
  socket.emit('clue_rejected', { reason: 'Não é momento de enviar dica.' });
}

function placeMarker(room, code, payload) {
  const state = room.state;
  if (state.phase !== 'markers1' && state.phase !== 'markers2') return;
  const { playerName, col, row, markerIndex } = payload || {};
  if (!playerName || typeof col !== 'number' || typeof row !== 'number') return;
  if (!room.cellById.get(`C${col}-R${row}`)) return;
  const activeName = state.players[state.activeIdx]?.name;
  if (playerName === activeName) return;
  if (!state.players.find(p => p.name === playerName)) return;
  if (!state.pendingMarkers.includes(playerName)) return;

  let mi = markerIndex;
  if (state.phase === 'markers1') mi = 1;
  if (state.phase === 'markers2') {
    if (mi !== 1 && mi !== 2) mi = 2;
  }

  if (!state.markers[playerName]) state.markers[playerName] = {};
  state.markers[playerName][mi] = { col, row };
  state.pendingMarkers = state.pendingMarkers.filter(n => n !== playerName);

  if (state.pendingMarkers.length === 0) {
    if (state.phase === 'markers1') {
      state.phase = 'clue2';
    } else {
      doReveal(room, code);
      return;
    }
  }
  broadcast(room, code);
}

function doReveal(room, code) {
  const state = room.state;
  const secret = room.cellById.get(state.secretCellId);
  if (!secret) return;
  const sc = secret.col, sr = secret.row;
  const cols = state.gridCols;
  const giverName = state.players[state.activeIdx]?.name;
  const roundScores = {};
  let giverPoints = 0;

  for (const p of state.players) {
    let pts = 0;
    const mks = state.markers[p.name] || {};
    for (const idx of [1, 2]) {
      const m = mks[idx];
      if (!m) continue;
      const dCol = Math.min(Math.abs(m.col - sc), cols - Math.abs(m.col - sc));
      const d = Math.max(dCol, Math.abs(m.row - sr));
      if (d === 0) pts += 3;
      else if (d <= 1) pts += 2;
      else if (d <= 2) pts += 1;
      if (d <= 1 && p.name !== giverName) giverPoints += 1;
    }
    roundScores[p.name] = pts;
  }
  giverPoints = Math.min(9, giverPoints);
  if (giverName) roundScores[giverName] = (roundScores[giverName] || 0) + giverPoints;
  for (const p of state.players) p.score += roundScores[p.name] || 0;

  state.roundScores = roundScores;
  state.lastClueGiver = giverName;
  state.revealCell = { col: secret.col, row: secret.row, id: secret.id, hsl: colors.cellHsl(secret) };
  state.phase = 'reveal';
  io.to(`room:${code}`).emit('reveal', {
    secretCell: state.revealCell,
    scores: roundScores,
    totals: state.players.map(p => ({ name: p.name, score: p.score }))
  });
  broadcast(room, code);
}

function nextTurn(room, code) {
  const state = room.state;
  if (state.phase !== 'reveal') return;
  state.turnsTaken += 1;
  if (state.turnsTaken >= state.totalTurns) {
    state.status = 'ended';
    state.phase = 'end';
    state.finalScores = state.players
      .map(p => ({ name: p.name, color: p.color, score: p.score }))
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        if (a.name === state.lastClueGiver) return -1;
        if (b.name === state.lastClueGiver) return 1;
        return 0;
      });
    io.to(`room:${code}`).emit('game_over', { finalScores: state.finalScores });
    broadcast(room, code);
    return;
  }
  state.activeIdx = state.turnsTaken % state.players.length;
  startTurn(room, code);
}

function resetGame(room, code) {
  const state = room.state;
  const previousNames = state.lobbyPlayers && state.lobbyPlayers.length
    ? state.lobbyPlayers
    : state.players.map(p => p.name);
  room.state = freshState();
  room.state.lobbyPlayers = previousNames;
  broadcast(room, code);
}

/* ---------- SOCKET.IO ---------- */
io.on('connection', (socket) => {

  socket.on('create_room', (payload, callback) => {
    const opts = (typeof payload === 'object' && payload !== null && typeof payload !== 'function') ? payload : {};
    const code = createRoom(opts);
    socket._roomCode = code;
    socket.join(`room:${code}`);
    const room = getRoom(code);
    room._lastActivity = Date.now();
    console.log(`[Room] Created ${code} (total: ${rooms.size})`);
    const cb = typeof callback === 'function' ? callback : (typeof payload === 'function' ? payload : null);
    if (cb) cb({ code });
    socket.emit('game_state', publicState(room, code));
  });

  socket.on('join_room', (payload) => {
    const code = (payload?.code || '').toUpperCase().trim();
    const room = getRoom(code);
    console.log(`[Room] join_room code=${code} found=${!!room} (rooms: ${[...rooms.keys()].join(',')})`);
    if (!room) return socket.emit('join_rejected', { reason: 'Sala não encontrada.' });
    if (room.state.password) {
      const pw = (payload?.password || '').trim();
      if (!pw) return socket.emit('join_rejected', { reason: 'Senha necessária.', needsPassword: true, code });
      if (pw !== room.state.password) return socket.emit('join_rejected', { reason: 'Senha incorreta.', needsPassword: true, code });
    }
    socket._roomCode = code;
    socket.join(`room:${code}`);
    socket.emit('room_joined', { code });
    socket.emit('game_state', publicState(room, code));
  });

  socket.on('hello_board', () => {
    const code = socketRoom(socket);
    if (!code) return;
    socket.join('board');
    const room = getRoom(code);
    if (room) socket.emit('game_state', publicState(room, code));
  });

  socket.on('join', (payload) => {
    const code = socketRoom(socket) || (payload?.room || '').toUpperCase().trim();
    const room = getRoom(code);
    if (!room) return socket.emit('join_rejected', { reason: 'Sala não encontrada.' });

    if (!socket._roomCode) {
      socket._roomCode = code;
      socket.join(`room:${code}`);
    }

    const name = payload && typeof payload.playerName === 'string' ? payload.playerName.trim() : '';
    if (!name) return socket.emit('join_rejected', { reason: 'Nome inválido.' });
    if (name.length > 14) return socket.emit('join_rejected', { reason: 'Nome muito longo (máx. 14 caracteres).' });
    const state = room.state;

    if (state.status === 'lobby') {
      if (state.lobbyPlayers.includes(name)) {
        const alreadyBound = [...room.socketBindings.entries()].find(([, n]) => n === name);
        if (alreadyBound && alreadyBound[0] !== socket.id) {
          room.socketBindings.delete(alreadyBound[0]);
        }
      } else {
        if (state.lobbyPlayers.length >= 10) {
          return socket.emit('join_rejected', { reason: 'Máximo de 10 jogadores atingido.' });
        }
        const oldName = room.socketBindings.get(socket.id);
        if (oldName && oldName !== name) {
          state.lobbyPlayers = state.lobbyPlayers.filter(n => n !== oldName);
        }
        state.lobbyPlayers.push(name);
      }
      room.socketBindings.set(socket.id, name);
      socket.emit('join_accepted', { playerName: name });
      broadcast(room, code);
      return;
    }

    const player = state.players.find(p => p.name === name);
    if (!player) return socket.emit('join_rejected', { reason: 'Jogador não está na partida.' });
    player.socketId = socket.id;
    room.socketBindings.set(socket.id, name);
    socket.emit('join_accepted', { playerName: name, color: player.color });
    sendSecretToActive(room);
    broadcast(room, code);
  });

  socket.on('kick_player', (payload) => {
    const code = socketRoom(socket);
    const room = code && getRoom(code);
    if (!room || room.state.status !== 'lobby') return;
    const name = payload && typeof payload.playerName === 'string' ? payload.playerName.trim() : '';
    if (!name) return;
    room.state.lobbyPlayers = room.state.lobbyPlayers.filter(n => n !== name);
    const boundSocket = [...room.socketBindings.entries()].find(([, n]) => n === name);
    if (boundSocket) {
      room.socketBindings.delete(boundSocket[0]);
      io.to(boundSocket[0]).emit('kicked');
    }
    broadcast(room, code);
  });

  socket.on('update_room_settings', (payload) => {
    const code = socketRoom(socket);
    const room = code && getRoom(code);
    if (!room || room.state.status !== 'lobby') return;
    if (payload && typeof payload.cols === 'number' && typeof payload.rows === 'number') {
      const preset = GRID_PRESETS.find(p => p.cols === payload.cols && p.rows === payload.rows);
      if (preset) {
        room.state.gridCols = preset.cols;
        room.state.gridRows = preset.rows;
        room.board = colors.generateBoard(preset.cols, preset.rows);
        room.cellById = new Map(room.board.map(c => [c.id, c]));
        broadcast(room, code);
      }
    }
  });

  socket.on('start_game', (payload) => {
    const code = socketRoom(socket);
    const room = code && getRoom(code);
    if (!room || room.state.status !== 'lobby') return;
    const names = payload && Array.isArray(payload.players) ? payload.players : room.state.lobbyPlayers;
    const cols = payload && typeof payload.cols === 'number' ? payload.cols : 30;
    const rows = payload && typeof payload.rows === 'number' ? payload.rows : 18;
    const result = startGame(room, code, names, cols, rows);
    if (!result.ok) socket.emit('start_rejected', { reason: result.reason });
  });

  socket.on('submit_clue', (payload) => {
    const code = socketRoom(socket);
    const room = code && getRoom(code);
    if (!room) return;
    submitClue(room, code, socket, payload);
  });

  socket.on('place_marker', (payload) => {
    const code = socketRoom(socket);
    const room = code && getRoom(code);
    if (!room) return;
    placeMarker(room, code, payload);
  });

  socket.on('confirm_markers', () => {
    const code = socketRoom(socket);
    const room = code && getRoom(code);
    if (!room) return;
    const state = room.state;
    if (state.phase === 'markers1' && state.pendingMarkers.length === 0) {
      state.phase = 'clue2';
      broadcast(room, code);
    } else if (state.phase === 'markers2' && state.pendingMarkers.length === 0) {
      doReveal(room, code);
    }
  });

  socket.on('next_round', () => {
    const code = socketRoom(socket);
    const room = code && getRoom(code);
    if (!room) return;
    if (room.state.phase !== 'reveal') return;
    const active = room.state.players[room.state.activeIdx];
    if (!active || active.socketId !== socket.id) return;
    nextTurn(room, code);
  });

  socket.on('change_active_player', (payload) => {
    const code = socketRoom(socket);
    const room = code && getRoom(code);
    if (!room || room.state.status !== 'playing') return;
    if (room.state.phase === 'reveal' || room.state.phase === 'end') return;
    const name = payload && typeof payload.playerName === 'string' ? payload.playerName.trim() : '';
    if (!name) return;
    const idx = room.state.players.findIndex(p => p.name === name);
    if (idx < 0) return;
    room.state.activeIdx = idx;
    startTurn(room, code);
  });

  socket.on('reset_game', () => {
    const code = socketRoom(socket);
    const room = code && getRoom(code);
    if (!room) return;
    resetGame(room, code);
  });

  socket.on('disconnect', () => {
    const code = socketRoom(socket);
    const room = code && getRoom(code);
    if (!room) return;
    const name = room.socketBindings.get(socket.id);
    room.socketBindings.delete(socket.id);
    if (!name) return;
    const player = room.state.players.find(p => p.name === name);
    if (player && player.socketId === socket.id) player.socketId = null;
    broadcast(room, code);
  });
});

/* ---------- START ---------- */
async function start() {
  await loadRoomsFromFirestore();
  server.listen(PORT, '0.0.0.0', () => {
    console.log('-----------------------------------------');
    console.log(' Cores com Dicas');
    if (BASE_URL) {
      console.log(`  URL: ${BASE_URL}`);
    } else {
      console.log(`  Tabuleiro:  http://${LOCAL_IP}:${PORT}/board`);
      console.log(`  Jogador:    http://${LOCAL_IP}:${PORT}/player`);
    }
    console.log(`  Rooms: ${rooms.size} restored`);
    console.log('-----------------------------------------');
  });
}

start();
