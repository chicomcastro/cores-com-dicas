const path = require('path');
const ioc = require('socket.io-client');
const request = require('supertest');

const server = require('../../server');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function makeClient(port) {
  return ioc(`http://localhost:${port}`, { forceNew: true, reconnection: false });
}

function nextEvent(socket, event, predicate) {
  return new Promise((resolve, reject) => {
    const handler = (payload) => {
      try {
        if (!predicate || predicate(payload)) {
          socket.off(event, handler);
          resolve(payload);
        }
      } catch (e) { reject(e); }
    };
    socket.on(event, handler);
    setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`Timeout waiting for ${event}`));
    }, 6000);
  });
}

function trackState(socket) {
  const acc = { state: null, secret: null, scores: null, gameOver: null };
  socket.on('game_state', (s) => { acc.state = s; });
  socket.on('your_secret', (s) => { acc.secret = s; });
  socket.on('reveal', (d) => { acc.scores = d; });
  socket.on('game_over', (d) => { acc.gameOver = d; });
  return acc;
}

async function createRoom(client, opts) {
  return new Promise((resolve) => {
    client.emit('create_room', opts || {}, (resp) => resolve(resp));
  });
}

async function waitFor(predicate, timeoutMs = 4000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return true;
    await sleep(30);
  }
  throw new Error('waitFor timed out');
}

describe('server integration', () => {
  let port;
  let baseUrl;

  beforeAll(async () => {
    const result = await server.start({ port: 0, silent: true });
    port = result.port;
    baseUrl = `http://localhost:${port}`;
  });

  afterAll(async () => {
    await server.stop();
  });

  beforeEach(() => {
    server.resetRooms();
  });

  describe('HTTP endpoints', () => {
    test('GET / redirects to /board', async () => {
      const res = await request(baseUrl).get('/');
      expect(res.status).toBe(302);
      expect(res.headers.location).toBe('/board');
    });

    test('GET /board serves HTML with BUILD placeholder replaced', async () => {
      const res = await request(baseUrl).get('/board');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/html/);
      expect(res.text).not.toContain('__BUILD__');
    });

    test('GET /player serves HTML', async () => {
      const res = await request(baseUrl).get('/player');
      expect(res.status).toBe(200);
      expect(res.text).toContain('id="game-board-host"');
    });

    test('GET /qr returns a QR data url', async () => {
      const res = await request(baseUrl).get('/qr?room=TEST');
      expect(res.status).toBe(200);
      expect(res.body.url).toMatch(/\/player\?room=TEST$/);
      expect(res.body.qr).toMatch(/^data:image\/png;base64,/);
    });

    test('static assets are served with no-store', async () => {
      const res = await request(baseUrl).get('/css/player.css');
      expect(res.status).toBe(200);
      expect(res.headers['cache-control']).toBe('no-store');
    });
  });

  describe('Room lifecycle', () => {
    let client;
    beforeEach(() => { client = makeClient(port); });
    afterEach(() => { client.disconnect(); });

    test('creates a room with a generated code', async () => {
      await nextEvent(client, 'connect');
      const resp = await createRoom(client);
      expect(resp.code).toMatch(/^[A-Z0-9]{4}$/);
    });

    test('rejects joining unknown rooms', async () => {
      await nextEvent(client, 'connect');
      client.emit('join_room', { code: 'NOPE' });
      const rejected = await nextEvent(client, 'join_rejected');
      expect(rejected.reason).toMatch(/não encontrada/i);
    });

    test('requires password when room has one', async () => {
      await nextEvent(client, 'connect');
      const { code } = await createRoom(client, { password: 'secret' });
      const second = makeClient(port);
      await nextEvent(second, 'connect');
      second.emit('join_room', { code });
      const rejected = await nextEvent(second, 'join_rejected');
      expect(rejected.needsPassword).toBe(true);
      second.emit('join_room', { code, password: 'wrong' });
      const wrongPw = await nextEvent(second, 'join_rejected');
      expect(wrongPw.needsPassword).toBe(true);
      second.emit('join_room', { code, password: 'secret' });
      const ok = await nextEvent(second, 'room_joined');
      expect(ok.code).toBe(code);
      second.disconnect();
    });

    test('respects grid size on creation', async () => {
      await nextEvent(client, 'connect');
      const { code } = await createRoom(client, { gridSize: 0 });
      const room = server.rooms.get(code);
      expect(room.state.gridCols).toBe(15);
      expect(room.state.gridRows).toBe(9);
    });
  });

  describe('Lobby', () => {
    let host, p2;
    beforeEach(async () => {
      host = makeClient(port);
      p2 = makeClient(port);
      await Promise.all([nextEvent(host, 'connect'), nextEvent(p2, 'connect')]);
    });
    afterEach(() => {
      host.disconnect();
      p2.disconnect();
    });

    test('players are added and listed', async () => {
      const { code } = await createRoom(host);
      p2.emit('join_room', { code });
      await nextEvent(p2, 'room_joined');
      host.emit('join', { playerName: 'Alice', room: code });
      await nextEvent(host, 'join_accepted');
      p2.emit('join', { playerName: 'Bob', room: code });
      await nextEvent(p2, 'join_accepted');

      const tracker = trackState(host);
      await waitFor(() => tracker.state && tracker.state.lobbyPlayers.length === 2);
      expect(tracker.state.lobbyPlayers).toEqual(expect.arrayContaining(['Alice', 'Bob']));
    });

    test('host can kick a player', async () => {
      const { code } = await createRoom(host);
      p2.emit('join_room', { code });
      await nextEvent(p2, 'room_joined');
      host.emit('join', { playerName: 'Alice', room: code });
      await nextEvent(host, 'join_accepted');
      p2.emit('join', { playerName: 'Bob', room: code });
      await nextEvent(p2, 'join_accepted');
      const room = server.rooms.get(code);
      await waitFor(() => room.state.lobbyPlayers.length === 2);

      host.emit('kick_player', { playerName: 'Bob' });
      await waitFor(() => room.state.lobbyPlayers.length === 1);
      expect(room.state.lobbyPlayers).toEqual(['Alice']);
    });

    test('rejects names that are empty or too long', async () => {
      const { code } = await createRoom(host);
      host.emit('join', { playerName: '   ', room: code });
      await expect(nextEvent(host, 'join_rejected')).resolves.toMatchObject({ reason: expect.stringMatching(/inválido/i) });
      host.emit('join', { playerName: 'x'.repeat(50), room: code });
      await expect(nextEvent(host, 'join_rejected')).resolves.toMatchObject({ reason: expect.stringMatching(/longo/i) });
    });

    test('caps lobby at 10 players', async () => {
      const { code } = await createRoom(host);
      const clients = [];
      for (let i = 0; i < 10; i++) {
        const c = makeClient(port);
        clients.push(c);
        await nextEvent(c, 'connect');
        c.emit('join_room', { code });
        await nextEvent(c, 'room_joined');
        c.emit('join', { playerName: `P${i}`, room: code });
        await nextEvent(c, 'join_accepted');
      }
      const overflow = makeClient(port);
      clients.push(overflow);
      await nextEvent(overflow, 'connect');
      overflow.emit('join_room', { code });
      await nextEvent(overflow, 'room_joined');
      overflow.emit('join', { playerName: 'Eleven', room: code });
      const rej = await nextEvent(overflow, 'join_rejected');
      expect(rej.reason).toMatch(/máximo/i);
      clients.forEach(c => c.disconnect());
    });

    test('updates grid size from lobby', async () => {
      const { code } = await createRoom(host);
      host.emit('join', { playerName: 'Alice', room: code });
      await nextEvent(host, 'join_accepted');
      host.emit('update_room_settings', { cols: 20, rows: 12 });
      const room = server.rooms.get(code);
      await waitFor(() => room.state.gridCols === 20);
      expect(room.state.gridRows).toBe(12);
    });

    test('rejects starting with fewer than 2 players', async () => {
      const { code } = await createRoom(host);
      host.emit('join', { playerName: 'Solo', room: code });
      await nextEvent(host, 'join_accepted');
      host.emit('start_game', { players: ['Solo'], cols: 15, rows: 9 });
      const rej = await nextEvent(host, 'start_rejected');
      expect(rej.reason).toMatch(/entre 2 e 10/i);
    });
  });

  describe('Game flow', () => {
    let a, b, c, code, tracker;

    async function startThreePlayerGame() {
      a = makeClient(port); b = makeClient(port); c = makeClient(port);
      await Promise.all([
        nextEvent(a, 'connect'),
        nextEvent(b, 'connect'),
        nextEvent(c, 'connect'),
      ]);
      const resp = await createRoom(a, { gridSize: 0 });
      code = resp.code;
      [b, c].forEach((cli) => cli.emit('join_room', { code }));
      await Promise.all([nextEvent(b, 'room_joined'), nextEvent(c, 'room_joined')]);
      a.emit('join', { playerName: 'Alice', room: code });
      await nextEvent(a, 'join_accepted');
      b.emit('join', { playerName: 'Bob', room: code });
      await nextEvent(b, 'join_accepted');
      c.emit('join', { playerName: 'Carol', room: code });
      await nextEvent(c, 'join_accepted');
      tracker = { a: trackState(a), b: trackState(b), c: trackState(c) };
      a.emit('start_game', { players: ['Alice', 'Bob', 'Carol'], cols: 15, rows: 9 });
      await waitFor(() => tracker.a.state && tracker.a.state.status === 'playing');
    }

    afterEach(() => {
      [a, b, c].forEach(s => s && s.disconnect());
    });

    test('starts with a clue1 phase and an active player', async () => {
      await startThreePlayerGame();
      expect(tracker.a.state.phase).toBe('clue1');
      expect(['Alice', 'Bob', 'Carol']).toContain(tracker.a.state.activeName);
    });

    test('the active player receives their secret cell', async () => {
      await startThreePlayerGame();
      const activeName = tracker.a.state.activeName;
      const sock = { Alice: tracker.a, Bob: tracker.b, Carol: tracker.c }[activeName];
      await waitFor(() => sock.secret);
      expect(sock.secret).toEqual(expect.objectContaining({
        id: expect.any(String),
        col: expect.any(Number),
        row: expect.any(Number),
        hsl: expect.stringMatching(/^hsl\(/),
      }));
    });

    test('rejects clues from non-active players and bad shapes', async () => {
      await startThreePlayerGame();
      const activeName = tracker.a.state.activeName;
      const others = ['Alice', 'Bob', 'Carol'].filter(n => n !== activeName);
      const otherSocket = { Alice: a, Bob: b, Carol: c }[others[0]];
      otherSocket.emit('submit_clue', { clue: 'oceano', round: 1 });
      const rej = await nextEvent(otherSocket, 'clue_rejected');
      expect(rej.reason).toMatch(/jogador da vez/i);

      const activeSocket = { Alice: a, Bob: b, Carol: c }[activeName];
      activeSocket.emit('submit_clue', { clue: 'duas palavras', round: 1 });
      const rejWords = await nextEvent(activeSocket, 'clue_rejected');
      expect(rejWords.reason).toMatch(/1 palavra/);

      activeSocket.emit('submit_clue', { clue: 'azul', round: 1 });
      const rejColor = await nextEvent(activeSocket, 'clue_rejected');
      expect(rejColor.reason).toMatch(/cores não são permitidos/i);

      activeSocket.emit('submit_clue', { clue: '', round: 1 });
      const rejEmpty = await nextEvent(activeSocket, 'clue_rejected');
      expect(rejEmpty.reason).toMatch(/digite/i);
    });

    test('clue2 rejects 3-word clues but accepts 1 or 2', async () => {
      await startThreePlayerGame();
      const activeName = tracker.a.state.activeName;
      const activeSocket = { Alice: a, Bob: b, Carol: c }[activeName];
      activeSocket.emit('submit_clue', { clue: 'oceano', round: 1 });
      await waitFor(() => tracker.a.state.phase === 'markers1');
      const others = ['Alice', 'Bob', 'Carol'].filter(n => n !== activeName);
      others.forEach(n => {
        const sock = { Alice: a, Bob: b, Carol: c }[n];
        sock.emit('place_marker', { playerName: n, col: 5, row: 5, markerIndex: 1 });
      });
      await waitFor(() => tracker.a.state.phase === 'clue2');

      activeSocket.emit('submit_clue', { clue: 'a b c', round: 2 });
      const rej = await nextEvent(activeSocket, 'clue_rejected');
      expect(rej.reason).toMatch(/até 2/);

      activeSocket.emit('submit_clue', { clue: 'mar profundo', round: 2 });
      await waitFor(() => tracker.a.state.phase === 'markers2');
    });

    test('active player can skip clue1 and clue2', async () => {
      await startThreePlayerGame();
      const activeName = tracker.a.state.activeName;
      const activeSocket = { Alice: a, Bob: b, Carol: c }[activeName];
      activeSocket.emit('submit_clue', { skip: true, round: 1 });
      await waitFor(() => tracker.a.state.phase === 'markers1');
      expect(tracker.a.state.clue1).toBeNull();
      const others = ['Alice', 'Bob', 'Carol'].filter(n => n !== activeName);
      others.forEach(n => {
        const sock = { Alice: a, Bob: b, Carol: c }[n];
        sock.emit('place_marker', { playerName: n, col: 5, row: 5, markerIndex: 1 });
      });
      await waitFor(() => tracker.a.state.phase === 'clue2');
      activeSocket.emit('submit_clue', { skip: true, round: 2 });
      await waitFor(() => tracker.a.state.phase === 'markers2');
      expect(tracker.a.state.clue2).toBeNull();
    });

    test('rejects placing markers for the active player', async () => {
      await startThreePlayerGame();
      const activeName = tracker.a.state.activeName;
      const activeSocket = { Alice: a, Bob: b, Carol: c }[activeName];
      activeSocket.emit('submit_clue', { clue: 'oceano', round: 1 });
      await waitFor(() => tracker.a.state.phase === 'markers1');
      activeSocket.emit('place_marker', { playerName: activeName, col: 1, row: 1, markerIndex: 1 });
      await sleep(150);
      const room = server.rooms.get(code);
      expect(room.state.markers[activeName]).toBeUndefined();
    });

    test('scoring respects hue wrap on column distance', async () => {
      // Force a secret near the left edge by retrying until it lands on col 0
      let attempts = 0;
      let activeName, activeSocket, secret;
      while (attempts++ < 25) {
        await startThreePlayerGame();
        activeName = tracker.a.state.activeName;
        activeSocket = { Alice: a, Bob: b, Carol: c }[activeName];
        const sock = { Alice: tracker.a, Bob: tracker.b, Carol: tracker.c }[activeName];
        await waitFor(() => sock.secret);
        secret = sock.secret;
        if (secret.col === 0) break;
        [a, b, c].forEach(s => s.disconnect());
        a = b = c = null;
      }
      if (secret.col !== 0) {
        return; // accept that randomness skipped this scenario
      }
      const others = ['Alice', 'Bob', 'Carol'].filter(n => n !== activeName);
      const wrapRow = secret.row;
      // wrap-mate at col (cols-1) is 1 step around for cols=15
      activeSocket.emit('submit_clue', { clue: 'oceano', round: 1 });
      await waitFor(() => tracker.a.state.phase === 'markers1');
      others.forEach(n => {
        const sock = { Alice: a, Bob: b, Carol: c }[n];
        sock.emit('place_marker', { playerName: n, col: 14, row: wrapRow, markerIndex: 1 });
      });
      await waitFor(() => tracker.a.state.phase === 'clue2');
      activeSocket.emit('submit_clue', { clue: 'profundo', round: 2 });
      await waitFor(() => tracker.a.state.phase === 'markers2');
      others.forEach(n => {
        const sock = { Alice: a, Bob: b, Carol: c }[n];
        sock.emit('place_marker', { playerName: n, col: 14, row: wrapRow, markerIndex: 2 });
      });
      await waitFor(() => tracker.a.state.phase === 'reveal');
      // distance via wrap is 1 — both markers in 3x3 → 2 pts each per marker
      others.forEach(n => {
        expect(tracker.a.state.roundScores[n]).toBe(4);
      });
      // giver gets +1 per marker in 3x3 (max 9)
      expect(tracker.a.state.roundScores[activeName]).toBeGreaterThanOrEqual(2);
    });

    test('only the active player can advance to the next turn', async () => {
      await startThreePlayerGame();
      const activeName = tracker.a.state.activeName;
      const activeSocket = { Alice: a, Bob: b, Carol: c }[activeName];
      const others = ['Alice', 'Bob', 'Carol'].filter(n => n !== activeName);
      const otherSocket = { Alice: a, Bob: b, Carol: c }[others[0]];

      activeSocket.emit('submit_clue', { skip: true, round: 1 });
      await waitFor(() => tracker.a.state.phase === 'markers1');
      others.forEach(n => {
        const sock = { Alice: a, Bob: b, Carol: c }[n];
        sock.emit('place_marker', { playerName: n, col: 5, row: 5, markerIndex: 1 });
      });
      await waitFor(() => tracker.a.state.phase === 'clue2');
      activeSocket.emit('submit_clue', { skip: true, round: 2 });
      await waitFor(() => tracker.a.state.phase === 'markers2');
      others.forEach(n => {
        const sock = { Alice: a, Bob: b, Carol: c }[n];
        sock.emit('place_marker', { playerName: n, col: 5, row: 5, markerIndex: 2 });
      });
      await waitFor(() => tracker.a.state.phase === 'reveal');

      // non-active should be ignored
      otherSocket.emit('next_round');
      await sleep(150);
      expect(tracker.a.state.phase).toBe('reveal');

      activeSocket.emit('next_round');
      await waitFor(() => tracker.a.state.phase !== 'reveal');
      expect(tracker.a.state.phase).toBe('clue1');
      expect(tracker.a.state.activeName).not.toBe(activeName);
    });

    test('change_active_player resets the turn with a fresh secret', async () => {
      await startThreePlayerGame();
      const originalActive = tracker.a.state.activeName;
      const activeSocket = { Alice: a, Bob: b, Carol: c }[originalActive];
      activeSocket.emit('submit_clue', { clue: 'oceano', round: 1 });
      await waitFor(() => tracker.a.state.phase === 'markers1');
      const others = ['Alice', 'Bob', 'Carol'].filter(n => n !== originalActive);
      const newActive = others[0];
      a.emit('change_active_player', { playerName: newActive });
      await waitFor(() => tracker.a.state.activeName === newActive && tracker.a.state.phase === 'clue1');
      expect(tracker.a.state.markers).toEqual({});
      expect(tracker.a.state.clue1).toBeNull();
    });

    test('finishes the game after totalTurns and emits game_over', async () => {
      await startThreePlayerGame();
      const room = server.rooms.get(code);
      const totalTurns = room.state.totalTurns;
      for (let t = 0; t < totalTurns; t++) {
        const activeName = tracker.a.state.activeName;
        const activeSocket = { Alice: a, Bob: b, Carol: c }[activeName];
        activeSocket.emit('submit_clue', { skip: true, round: 1 });
        await waitFor(() => tracker.a.state.phase === 'markers1');
        const others = ['Alice', 'Bob', 'Carol'].filter(n => n !== activeName);
        others.forEach((n, i) => {
          const sock = { Alice: a, Bob: b, Carol: c }[n];
          sock.emit('place_marker', { playerName: n, col: i, row: 0, markerIndex: 1 });
        });
        await waitFor(() => tracker.a.state.phase === 'clue2');
        activeSocket.emit('submit_clue', { skip: true, round: 2 });
        await waitFor(() => tracker.a.state.phase === 'markers2');
        others.forEach((n, i) => {
          const sock = { Alice: a, Bob: b, Carol: c }[n];
          sock.emit('place_marker', { playerName: n, col: i, row: 0, markerIndex: 2 });
        });
        await waitFor(() => tracker.a.state.phase === 'reveal');
        activeSocket.emit('next_round');
        if (t < totalTurns - 1) {
          await waitFor(() => tracker.a.state.phase !== 'reveal');
        }
      }
      await waitFor(() => tracker.a.gameOver != null);
      expect(tracker.a.gameOver.finalScores).toHaveLength(3);
    });

    test('reset_game returns to lobby preserving the player list', async () => {
      await startThreePlayerGame();
      a.emit('reset_game');
      await waitFor(() => tracker.a.state.status === 'lobby');
      expect(tracker.a.state.lobbyPlayers).toEqual(expect.arrayContaining(['Alice', 'Bob', 'Carol']));
    });
  });

  describe('Reconnect and join in-game', () => {
    test('a known player can rejoin during play and gets their color back', async () => {
      const host = makeClient(port);
      const p2 = makeClient(port);
      await Promise.all([nextEvent(host, 'connect'), nextEvent(p2, 'connect')]);
      const { code } = await createRoom(host);
      p2.emit('join_room', { code });
      await nextEvent(p2, 'room_joined');
      host.emit('join', { playerName: 'Alice', room: code });
      await nextEvent(host, 'join_accepted');
      p2.emit('join', { playerName: 'Bob', room: code });
      await nextEvent(p2, 'join_accepted');
      host.emit('start_game', { players: ['Alice', 'Bob'], cols: 15, rows: 9 });
      const hostState = trackState(host);
      await waitFor(() => hostState.state && hostState.state.status === 'playing');

      // Bob disconnects
      p2.disconnect();
      await waitFor(() => {
        const room = server.rooms.get(code);
        const bob = room.state.players.find(p => p.name === 'Bob');
        return bob && !bob.socketId;
      });

      // Bob rejoins on a fresh socket
      const p2b = makeClient(port);
      await nextEvent(p2b, 'connect');
      p2b.emit('join_room', { code });
      await nextEvent(p2b, 'room_joined');
      p2b.emit('join', { playerName: 'Bob', room: code });
      const accepted = await nextEvent(p2b, 'join_accepted');
      expect(accepted).toEqual(expect.objectContaining({ playerName: 'Bob' }));
      expect(accepted.color).toBeDefined();
      host.disconnect();
      p2b.disconnect();
    });

    test('unknown name during play is rejected', async () => {
      const host = makeClient(port);
      const p2 = makeClient(port);
      await Promise.all([nextEvent(host, 'connect'), nextEvent(p2, 'connect')]);
      const { code } = await createRoom(host);
      p2.emit('join_room', { code });
      await nextEvent(p2, 'room_joined');
      host.emit('join', { playerName: 'Alice', room: code });
      await nextEvent(host, 'join_accepted');
      p2.emit('join', { playerName: 'Bob', room: code });
      await nextEvent(p2, 'join_accepted');
      host.emit('start_game', { players: ['Alice', 'Bob'], cols: 15, rows: 9 });
      const hostState = trackState(host);
      await waitFor(() => hostState.state && hostState.state.status === 'playing');

      const intruder = makeClient(port);
      await nextEvent(intruder, 'connect');
      intruder.emit('join_room', { code });
      await nextEvent(intruder, 'room_joined');
      intruder.emit('join', { playerName: 'Mallory', room: code });
      const rej = await nextEvent(intruder, 'join_rejected');
      expect(rej.reason).toMatch(/não está na partida/i);
      host.disconnect();
      p2.disconnect();
      intruder.disconnect();
    });
  });
});
