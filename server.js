const express = require('express');
const http = require('http');
const path = require('path');
const os = require('os');
const QRCode = require('qrcode');
const { Server } = require('socket.io');
const colors = require('./public/js/colors');

const PORT = process.env.PORT || 3000;
const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (_req, res) => res.redirect('/board'));
app.get('/board', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'board.html')));
app.get('/player', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'player.html')));

const board = colors.generateBoard();
const cellById = new Map(board.map(c => [c.id, c]));
function getCell(col, row) {
  return cellById.get(`C${col}-R${row}`) || null;
}

function getLocalIp() {
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const iface of ifaces || []) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return 'localhost';
}
const LOCAL_IP = getLocalIp();
const PLAYER_URL = `http://${LOCAL_IP}:${PORT}/player`;

app.get('/qr', async (_req, res) => {
  try {
    const qr = await QRCode.toDataURL(PLAYER_URL, { margin: 1, width: 320 });
    res.json({ url: PLAYER_URL, ip: LOCAL_IP, qr });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PLAYER_COLORS = [
  '#e63946', '#1d3557', '#2a9d8f', '#f4a261', '#7209b7',
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
    lastClueGiver: null,
    roundScores: null,
    revealCell: null,
    finalScores: null
  };
}

let state = freshState();
const socketBindings = new Map();

function findPlayer(name) {
  return state.players.find(p => p.name === name);
}

function publicState() {
  const reveal = state.phase === 'reveal' || state.phase === 'end';
  const connectedNames = new Set([...socketBindings.values()]);
  return {
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
    boardCols: colors.COLS,
    boardRows: colors.ROWS
  };
}

function broadcast() {
  io.emit('game_state', publicState());
  sendSecretToActive();
}

function sendSecretToActive() {
  const active = state.players[state.activeIdx];
  if (!active) return;
  if (state.phase !== 'clue1' && state.phase !== 'markers1' && state.phase !== 'clue2' && state.phase !== 'markers2') {
    return;
  }
  if (!active.socketId) return;
  const cell = cellById.get(state.secretCellId);
  if (!cell) return;
  io.to(active.socketId).emit('your_secret', {
    col: cell.col,
    row: cell.row,
    id: cell.id,
    hsl: colors.cellHsl(cell)
  });
}

function startTurn() {
  const cell = board[Math.floor(Math.random() * board.length)];
  state.secretCellId = cell.id;
  state.clue1 = null;
  state.clue2 = null;
  state.markers = {};
  state.pendingMarkers = [];
  state.roundScores = null;
  state.revealCell = null;
  state.phase = 'clue1';
  state.currentRound = Math.floor(state.turnsTaken / Math.max(1, state.players.length)) + 1;
  broadcast();
}

function startGame(playerNames) {
  const cleaned = (playerNames || [])
    .map(n => (typeof n === 'string' ? n.trim() : ''))
    .filter(Boolean);
  const unique = [...new Set(cleaned)];
  if (unique.length < 3 || unique.length > 10) {
    return { ok: false, reason: 'Número de jogadores deve ser entre 3 e 10.' };
  }
  const shuffled = [...unique].sort(() => Math.random() - 0.5);

  const previousBindings = new Map();
  for (const p of state.players) {
    if (p.socketId) previousBindings.set(p.name, p.socketId);
  }
  for (const [sid, name] of socketBindings.entries()) {
    if (!previousBindings.has(name)) previousBindings.set(name, sid);
  }

  state = freshState();
  state.status = 'playing';
  state.lobbyPlayers = shuffled;
  state.players = shuffled.map((name, i) => ({
    name,
    color: PLAYER_COLORS[i % PLAYER_COLORS.length],
    score: 0,
    socketId: previousBindings.get(name) || null
  }));
  state.rounds = unique.length >= 7 ? 1 : 2;
  state.totalTurns = state.rounds * state.players.length;
  state.activeIdx = 0;
  state.turnsTaken = 0;
  startTurn();
  return { ok: true };
}

function submitClue(socket, payload) {
  const active = state.players[state.activeIdx];
  if (!active) return socket.emit('clue_rejected', { reason: 'Jogo não está ativo.' });
  if (active.socketId !== socket.id) return socket.emit('clue_rejected', { reason: 'Apenas o jogador da vez pode enviar a dica.' });
  const round = payload && payload.round;
  const raw = (payload && typeof payload.clue === 'string') ? payload.clue.trim() : '';
  if (!raw) return socket.emit('clue_rejected', { reason: 'Digite uma dica.' });
  const words = raw.split(/\s+/);

  if (state.phase === 'clue1' && round === 1) {
    if (words.length !== 1) return socket.emit('clue_rejected', { reason: 'Use exatamente 1 palavra.' });
    if (isClueBlocked(raw)) return socket.emit('clue_rejected', { reason: 'Nomes de cores não são permitidos.' });
    state.clue1 = raw;
    state.phase = 'markers1';
    state.pendingMarkers = state.players.filter((_, i) => i !== state.activeIdx).map(p => p.name);
    broadcast();
    return;
  }
  if (state.phase === 'clue2' && round === 2) {
    if (words.length < 1 || words.length > 2) return socket.emit('clue_rejected', { reason: 'Use até 2 palavras.' });
    if (isClueBlocked(raw)) return socket.emit('clue_rejected', { reason: 'Nomes de cores não são permitidos.' });
    state.clue2 = raw;
    state.phase = 'markers2';
    state.pendingMarkers = state.players.filter((_, i) => i !== state.activeIdx).map(p => p.name);
    broadcast();
    return;
  }
  socket.emit('clue_rejected', { reason: 'Não é momento de enviar dica.' });
}

function placeMarker(payload) {
  if (state.phase !== 'markers1' && state.phase !== 'markers2') return;
  const { playerName, col, row, markerIndex } = payload || {};
  if (!playerName || typeof col !== 'number' || typeof row !== 'number') return;
  if (!getCell(col, row)) return;
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
      doReveal();
      return;
    }
  }
  broadcast();
}

function doReveal() {
  const secret = cellById.get(state.secretCellId);
  if (!secret) return;
  const sc = secret.col, sr = secret.row;
  const giverName = state.players[state.activeIdx]?.name;
  const roundScores = {};
  let giverPoints = 0;

  for (const p of state.players) {
    let pts = 0;
    const mks = state.markers[p.name] || {};
    for (const idx of [1, 2]) {
      const m = mks[idx];
      if (!m) continue;
      const d = Math.max(Math.abs(m.col - sc), Math.abs(m.row - sr));
      if (d === 0) pts += 3;
      else if (d <= 1) pts += 2;
      else if (d <= 2) pts += 1;
      if (d <= 1 && p.name !== giverName) {
        giverPoints += 1;
      }
    }
    roundScores[p.name] = pts;
  }
  giverPoints = Math.min(9, giverPoints);
  if (giverName) {
    roundScores[giverName] = (roundScores[giverName] || 0) + giverPoints;
  }
  for (const p of state.players) {
    p.score += roundScores[p.name] || 0;
  }
  state.roundScores = roundScores;
  state.lastClueGiver = giverName;
  state.revealCell = { col: secret.col, row: secret.row, id: secret.id, hsl: colors.cellHsl(secret) };
  state.phase = 'reveal';
  io.emit('reveal', { secretCell: state.revealCell, scores: roundScores, totals: state.players.map(p => ({ name: p.name, score: p.score })) });
  broadcast();
}

function nextTurn() {
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
    io.emit('game_over', { finalScores: state.finalScores });
    broadcast();
    return;
  }
  state.activeIdx = state.turnsTaken % state.players.length;
  startTurn();
}

function resetGame() {
  const previousNames = state.lobbyPlayers && state.lobbyPlayers.length
    ? state.lobbyPlayers
    : state.players.map(p => p.name);
  state = freshState();
  state.lobbyPlayers = previousNames;
  broadcast();
}

io.on('connection', (socket) => {
  socket.emit('game_state', publicState());

  socket.on('hello_board', () => {
    socket.join('board');
    socket.emit('game_state', publicState());
  });

  socket.on('lobby_update', (payload) => {
    if (state.status !== 'lobby') return;
    const names = (payload && Array.isArray(payload.players)) ? payload.players : [];
    const cleaned = names
      .map(n => (typeof n === 'string' ? n.trim() : ''))
      .filter(Boolean)
      .slice(0, 10);
    state.lobbyPlayers = [...new Set(cleaned)];
    broadcast();
  });

  socket.on('join', (payload) => {
    const name = payload && typeof payload.playerName === 'string' ? payload.playerName.trim() : '';
    if (!name) return socket.emit('join_rejected', { reason: 'Nome inválido.' });

    if (state.status === 'lobby') {
      if (!state.lobbyPlayers.includes(name)) {
        return socket.emit('join_rejected', { reason: 'Nome não está na lista do tablet.' });
      }
      socketBindings.set(socket.id, name);
      socket.emit('join_accepted', { playerName: name });
      broadcast();
      return;
    }

    const player = state.players.find(p => p.name === name);
    if (!player) return socket.emit('join_rejected', { reason: 'Jogador não está na partida.' });
    player.socketId = socket.id;
    socketBindings.set(socket.id, name);
    socket.emit('join_accepted', { playerName: name, color: player.color });
    sendSecretToActive();
    broadcast();
  });

  socket.on('start_game', (payload) => {
    if (state.status !== 'lobby') return;
    const names = payload && Array.isArray(payload.players) ? payload.players : state.lobbyPlayers;
    const result = startGame(names);
    if (!result.ok) {
      socket.emit('start_rejected', { reason: result.reason });
    }
  });

  socket.on('submit_clue', (payload) => submitClue(socket, payload));

  socket.on('place_marker', (payload) => placeMarker(payload));

  socket.on('confirm_markers', () => {
    if (state.phase === 'markers1' && state.pendingMarkers.length === 0) {
      state.phase = 'clue2';
      broadcast();
    } else if (state.phase === 'markers2' && state.pendingMarkers.length === 0) {
      doReveal();
    }
  });

  socket.on('next_round', () => nextTurn());

  socket.on('reset_game', () => resetGame());

  socket.on('disconnect', () => {
    const name = socketBindings.get(socket.id);
    socketBindings.delete(socket.id);
    if (!name) return;
    const player = state.players.find(p => p.name === name);
    if (player && player.socketId === socket.id) {
      player.socketId = null;
    }
    broadcast();
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('-----------------------------------------');
  console.log(' Cores com Dicas');
  console.log(`  Tabuleiro:  http://${LOCAL_IP}:${PORT}/board`);
  console.log(`  Jogador:    ${PLAYER_URL}`);
  console.log('-----------------------------------------');
});
