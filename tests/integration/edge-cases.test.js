const ioc = require('socket.io-client');
const request = require('supertest');

const server = require('../../server');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function makeClient(port) {
  return ioc(`http://localhost:${port}`, { forceNew: true, reconnection: false });
}
function nextEvent(socket, event) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout ' + event)), 5000);
    socket.once(event, (p) => { clearTimeout(t); resolve(p); });
  });
}
function trackState(socket) {
  const acc = { state: null, secret: null };
  socket.on('game_state', (s) => { acc.state = s; });
  socket.on('your_secret', (s) => { acc.secret = s; });
  return acc;
}
async function waitFor(predicate, timeoutMs = 4000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return true;
    await sleep(30);
  }
  throw new Error('waitFor timed out');
}

describe('server edge cases', () => {
  let port, baseUrl;

  beforeAll(async () => {
    const result = await server.start({ port: 0, silent: true });
    port = result.port;
    baseUrl = `http://localhost:${port}`;
  });
  afterAll(async () => { await server.stop(); });
  beforeEach(() => { server.resetRooms(); });

  test('hello_board accepts a spectator that already joined a room', async () => {
    const a = makeClient(port);
    await nextEvent(a, 'connect');
    const resp = await new Promise(r => a.emit('create_room', {}, r));
    a.emit('hello_board');
    const s = await nextEvent(a, 'game_state');
    expect(s.roomCode).toBe(resp.code);
    a.disconnect();
  });

  test('hello_board with no room is silently ignored', async () => {
    const a = makeClient(port);
    await nextEvent(a, 'connect');
    a.emit('hello_board'); // no error, no game_state
    await sleep(150);
    a.disconnect();
  });

  test('joining the same name in lobby just rebinds the existing entry', async () => {
    const a = makeClient(port);
    await nextEvent(a, 'connect');
    const { code } = await new Promise(r => a.emit('create_room', {}, r));
    a.emit('join', { playerName: 'Alice', room: code });
    await nextEvent(a, 'join_accepted');
    // Same name re-joins on a fresh socket
    const b = makeClient(port);
    await nextEvent(b, 'connect');
    b.emit('join_room', { code });
    await nextEvent(b, 'room_joined');
    b.emit('join', { playerName: 'Alice', room: code });
    await nextEvent(b, 'join_accepted');
    const room = server.rooms.get(code);
    expect(room.state.lobbyPlayers).toEqual(['Alice']);
    a.disconnect(); b.disconnect();
  });

  test('changing name in lobby on the same socket removes the old entry', async () => {
    const a = makeClient(port);
    await nextEvent(a, 'connect');
    const { code } = await new Promise(r => a.emit('create_room', {}, r));
    a.emit('join', { playerName: 'OldName', room: code });
    await nextEvent(a, 'join_accepted');
    a.emit('join', { playerName: 'NewName', room: code });
    await nextEvent(a, 'join_accepted');
    const room = server.rooms.get(code);
    expect(room.state.lobbyPlayers).toEqual(['NewName']);
    a.disconnect();
  });

  test('submit_clue is rejected outside of a clue phase', async () => {
    const a = makeClient(port);
    const b = makeClient(port);
    await Promise.all([nextEvent(a, 'connect'), nextEvent(b, 'connect')]);
    const { code } = await new Promise(r => a.emit('create_room', {}, r));
    b.emit('join_room', { code });
    await nextEvent(b, 'room_joined');
    a.emit('join', { playerName: 'Alice', room: code });
    await nextEvent(a, 'join_accepted');
    b.emit('join', { playerName: 'Bob', room: code });
    await nextEvent(b, 'join_accepted');
    const aT = trackState(a);
    a.emit('start_game', { players: ['Alice', 'Bob'], cols: 15, rows: 9 });
    await waitFor(() => aT.state && aT.state.status === 'playing');
    // Move past clue1
    const activeSocket = aT.state.activeName === 'Alice' ? a : b;
    activeSocket.emit('submit_clue', { skip: true, round: 1 });
    await waitFor(() => aT.state.phase === 'markers1');
    activeSocket.emit('submit_clue', { clue: 'x', round: 1 });
    const rej = await nextEvent(activeSocket, 'clue_rejected');
    expect(rej.reason).toMatch(/Não é momento/i);
    a.disconnect(); b.disconnect();
  });

  test('confirm_markers no-ops when nothing is pending', async () => {
    const a = makeClient(port);
    await nextEvent(a, 'connect');
    const { code } = await new Promise(r => a.emit('create_room', {}, r));
    a.emit('confirm_markers'); // no game state yet
    await sleep(120);
    expect(server.rooms.get(code).state.status).toBe('lobby');
    a.disconnect();
  });

  test('change_active_player is a no-op when status is not playing', async () => {
    const a = makeClient(port);
    await nextEvent(a, 'connect');
    const { code } = await new Promise(r => a.emit('create_room', {}, r));
    a.emit('change_active_player', { playerName: 'X' });
    await sleep(120);
    expect(server.rooms.get(code).state.status).toBe('lobby');
    a.disconnect();
  });

  test('disconnect clears the player socketId mapping', async () => {
    const a = makeClient(port);
    const b = makeClient(port);
    await Promise.all([nextEvent(a, 'connect'), nextEvent(b, 'connect')]);
    const { code } = await new Promise(r => a.emit('create_room', {}, r));
    b.emit('join_room', { code });
    await nextEvent(b, 'room_joined');
    a.emit('join', { playerName: 'Alice', room: code });
    await nextEvent(a, 'join_accepted');
    b.emit('join', { playerName: 'Bob', room: code });
    await nextEvent(b, 'join_accepted');
    a.emit('start_game', { players: ['Alice', 'Bob'], cols: 15, rows: 9 });
    const aT = trackState(a);
    await waitFor(() => aT.state && aT.state.status === 'playing');
    b.disconnect();
    await waitFor(() => {
      const room = server.rooms.get(code);
      const bob = room.state.players.find(p => p.name === 'Bob');
      return bob && !bob.socketId;
    });
    a.disconnect();
  });

  test('reset_game from in-game returns to lobby with the same names', async () => {
    const a = makeClient(port);
    const b = makeClient(port);
    await Promise.all([nextEvent(a, 'connect'), nextEvent(b, 'connect')]);
    const { code } = await new Promise(r => a.emit('create_room', {}, r));
    b.emit('join_room', { code });
    await nextEvent(b, 'room_joined');
    a.emit('join', { playerName: 'Alice', room: code });
    await nextEvent(a, 'join_accepted');
    b.emit('join', { playerName: 'Bob', room: code });
    await nextEvent(b, 'join_accepted');
    a.emit('start_game', { players: ['Alice', 'Bob'], cols: 15, rows: 9 });
    const aT = trackState(a);
    await waitFor(() => aT.state && aT.state.status === 'playing');
    a.emit('reset_game');
    await waitFor(() => aT.state.status === 'lobby');
    expect(aT.state.lobbyPlayers).toEqual(expect.arrayContaining(['Alice', 'Bob']));
    a.disconnect(); b.disconnect();
  });

  test('start_game uses default grid when payload preset is unknown', async () => {
    const a = makeClient(port);
    const b = makeClient(port);
    await Promise.all([nextEvent(a, 'connect'), nextEvent(b, 'connect')]);
    const { code } = await new Promise(r => a.emit('create_room', {}, r));
    b.emit('join_room', { code });
    await nextEvent(b, 'room_joined');
    a.emit('join', { playerName: 'Alice', room: code });
    await nextEvent(a, 'join_accepted');
    b.emit('join', { playerName: 'Bob', room: code });
    await nextEvent(b, 'join_accepted');
    a.emit('start_game', { players: ['Alice', 'Bob'], cols: 999, rows: 999 });
    const aT = trackState(a);
    await waitFor(() => aT.state && aT.state.status === 'playing');
    // default preset is 30x18 when no match
    expect(aT.state.boardCols).toBe(30);
    expect(aT.state.boardRows).toBe(18);
    a.disconnect(); b.disconnect();
  });

  test('start_game is ignored when not in lobby', async () => {
    const a = makeClient(port);
    const b = makeClient(port);
    await Promise.all([nextEvent(a, 'connect'), nextEvent(b, 'connect')]);
    const { code } = await new Promise(r => a.emit('create_room', {}, r));
    b.emit('join_room', { code });
    await nextEvent(b, 'room_joined');
    a.emit('join', { playerName: 'Alice', room: code });
    await nextEvent(a, 'join_accepted');
    b.emit('join', { playerName: 'Bob', room: code });
    await nextEvent(b, 'join_accepted');
    a.emit('start_game', { players: ['Alice', 'Bob'], cols: 15, rows: 9 });
    const aT = trackState(a);
    await waitFor(() => aT.state && aT.state.status === 'playing');
    a.emit('start_game', { players: ['Alice', 'Bob'], cols: 20, rows: 12 });
    await sleep(150);
    expect(aT.state.boardCols).toBe(15); // unchanged
    a.disconnect(); b.disconnect();
  });

  test('socket handlers ignore actions without a room context', async () => {
    const a = makeClient(port);
    await nextEvent(a, 'connect');
    a.emit('submit_clue', { clue: 'x', round: 1 });
    a.emit('place_marker', { playerName: 'X', col: 0, row: 0, markerIndex: 1 });
    a.emit('next_round');
    a.emit('reset_game');
    a.emit('change_active_player', { playerName: 'X' });
    a.emit('kick_player', { playerName: 'X' });
    a.emit('update_room_settings', { cols: 15, rows: 9 });
    await sleep(150);
    a.disconnect();
  });

  test('host can kick someone, kicked socket receives kicked event', async () => {
    const a = makeClient(port);
    const b = makeClient(port);
    await Promise.all([nextEvent(a, 'connect'), nextEvent(b, 'connect')]);
    const { code } = await new Promise(r => a.emit('create_room', {}, r));
    b.emit('join_room', { code });
    await nextEvent(b, 'room_joined');
    a.emit('join', { playerName: 'Alice', room: code });
    await nextEvent(a, 'join_accepted');
    b.emit('join', { playerName: 'Bob', room: code });
    await nextEvent(b, 'join_accepted');
    const kicked = nextEvent(b, 'kicked');
    a.emit('kick_player', { playerName: 'Bob' });
    await kicked;
    a.disconnect(); b.disconnect();
  });

  test('/qr without room param returns join URL without room', async () => {
    const res = await request(baseUrl).get('/qr');
    expect(res.body.url).toMatch(/\/player$/);
  });

  test('expireOldRooms drops rooms older than the TTL', async () => {
    const a = makeClient(port);
    await nextEvent(a, 'connect');
    const { code } = await new Promise(r => a.emit('create_room', {}, r));
    const room = server.rooms.get(code);
    expect(room).toBeDefined();
    room._createdAt = Date.now() - (60 * 60 * 1000 + 5000); // 1h05m ago
    server.expireOldRooms();
    expect(server.rooms.has(code)).toBe(false);
    a.disconnect();
  });

  test('confirm_markers advances phase when no markers remain', async () => {
    const a = makeClient(port);
    const b = makeClient(port);
    await Promise.all([nextEvent(a, 'connect'), nextEvent(b, 'connect')]);
    const { code } = await new Promise(r => a.emit('create_room', {}, r));
    b.emit('join_room', { code });
    await nextEvent(b, 'room_joined');
    a.emit('join', { playerName: 'Alice', room: code });
    await nextEvent(a, 'join_accepted');
    b.emit('join', { playerName: 'Bob', room: code });
    await nextEvent(b, 'join_accepted');
    a.emit('start_game', { players: ['Alice', 'Bob'], cols: 15, rows: 9 });
    const aT = trackState(a);
    await waitFor(() => aT.state && aT.state.status === 'playing');
    const activeSocket = aT.state.activeName === 'Alice' ? a : b;
    const otherName = aT.state.activeName === 'Alice' ? 'Bob' : 'Alice';
    const otherSocket = aT.state.activeName === 'Alice' ? b : a;
    activeSocket.emit('submit_clue', { skip: true, round: 1 });
    await waitFor(() => aT.state.phase === 'markers1');
    otherSocket.emit('place_marker', { playerName: otherName, col: 3, row: 3, markerIndex: 1 });
    // Force the queue to drain by hand (already drained by place_marker, but exercise the handler)
    a.emit('confirm_markers');
    await waitFor(() => aT.state.phase === 'clue2');
    activeSocket.emit('submit_clue', { skip: true, round: 2 });
    await waitFor(() => aT.state.phase === 'markers2');
    otherSocket.emit('place_marker', { playerName: otherName, col: 3, row: 3, markerIndex: 2 });
    a.emit('confirm_markers');
    await waitFor(() => aT.state.phase === 'reveal');
    a.disconnect(); b.disconnect();
  });

  test('starting a fresh game preserves player socketId rebindings', async () => {
    const a = makeClient(port);
    const b = makeClient(port);
    await Promise.all([nextEvent(a, 'connect'), nextEvent(b, 'connect')]);
    const { code } = await new Promise(r => a.emit('create_room', {}, r));
    b.emit('join_room', { code });
    await nextEvent(b, 'room_joined');
    a.emit('join', { playerName: 'Alice', room: code });
    await nextEvent(a, 'join_accepted');
    b.emit('join', { playerName: 'Bob', room: code });
    await nextEvent(b, 'join_accepted');
    a.emit('start_game', { players: ['Alice', 'Bob'], cols: 15, rows: 9 });
    const aT = trackState(a);
    await waitFor(() => aT.state && aT.state.status === 'playing');
    a.emit('reset_game');
    await waitFor(() => aT.state.status === 'lobby');
    // start again — players list should still have both names
    a.emit('start_game', { players: ['Alice', 'Bob'], cols: 15, rows: 9 });
    await waitFor(() => aT.state.status === 'playing');
    const room = server.rooms.get(code);
    expect(room.state.players.find(p => p.name === 'Alice').socketId).toBeTruthy();
    a.disconnect(); b.disconnect();
  });
});
