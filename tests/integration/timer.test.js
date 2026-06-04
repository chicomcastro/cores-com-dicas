const ioc = require('socket.io-client');
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
  const acc = { state: null, gameOver: null };
  socket.on('game_state', (s) => { acc.state = s; });
  socket.on('game_over', (d) => { acc.gameOver = d; });
  return acc;
}
async function waitFor(predicate, timeoutMs = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return true;
    await sleep(20);
  }
  throw new Error('waitFor timed out');
}

describe('phase timer', () => {
  let port;

  beforeAll(async () => {
    const r = await server.start({ port: 0, silent: true });
    port = r.port;
  });
  afterAll(async () => { await server.stop(); });
  beforeEach(() => { server.resetRooms(); });

  async function setupGame(timerSeconds) {
    const a = makeClient(port);
    const b = makeClient(port);
    await Promise.all([nextEvent(a, 'connect'), nextEvent(b, 'connect')]);
    const opts = { gridSize: 0 };
    if (timerSeconds !== undefined) opts.timerSeconds = timerSeconds;
    const { code } = await new Promise((r) => a.emit('create_room', opts, r));
    b.emit('join_room', { code });
    await nextEvent(b, 'room_joined');
    a.emit('join', { playerName: 'Alice', room: code });
    await nextEvent(a, 'join_accepted');
    b.emit('join', { playerName: 'Bob', room: code });
    await nextEvent(b, 'join_accepted');
    const aT = trackState(a);
    a.emit('start_game', { players: ['Alice', 'Bob'], cols: 15, rows: 9 });
    await waitFor(() => aT.state && aT.state.status === 'playing');
    return { a, b, code, aT };
  }

  test('publicState exposes timerSeconds and phaseDeadline (default 60)', async () => {
    const { a, b, aT } = await setupGame();
    expect(aT.state.timerSeconds).toBe(60);
    expect(aT.state.phaseDeadline).toBeGreaterThan(Date.now());
    expect(aT.state.phaseDeadline - Date.now()).toBeLessThanOrEqual(60000 + 500);
    a.disconnect(); b.disconnect();
  });

  test('timerSeconds=0 disables the deadline', async () => {
    const { a, b, aT } = await setupGame(0);
    expect(aT.state.timerSeconds).toBe(0);
    expect(aT.state.phaseDeadline).toBeNull();
    a.disconnect(); b.disconnect();
  });

  test('update_room_settings accepts only allowed timer values', async () => {
    const a = makeClient(port);
    await nextEvent(a, 'connect');
    const { code } = await new Promise(r => a.emit('create_room', {}, r));
    a.emit('update_room_settings', { timerSeconds: 30 });
    await sleep(100);
    expect(server.rooms.get(code).state.timerSeconds).toBe(30);
    a.emit('update_room_settings', { timerSeconds: 45 });
    await sleep(100);
    expect(server.rooms.get(code).state.timerSeconds).toBe(30);
    a.emit('update_room_settings', { timerSeconds: 90 });
    await sleep(100);
    expect(server.rooms.get(code).state.timerSeconds).toBe(90);
    a.disconnect();
  });

  test('expired clue1 timer auto-skips into markers1', async () => {
    const { a, b, code, aT } = await setupGame(60);
    expect(aT.state.phase).toBe('clue1');
    server._triggerPhaseExpire(code);
    await waitFor(() => aT.state.phase === 'markers1');
    expect(aT.state.clue1).toBeNull();
    a.disconnect(); b.disconnect();
  });

  test('expired clue2 timer auto-skips into markers2', async () => {
    const { a, b, code, aT } = await setupGame(60);
    const activeSocket = aT.state.activeName === 'Alice' ? a : b;
    const otherName = aT.state.activeName === 'Alice' ? 'Bob' : 'Alice';
    const otherSocket = aT.state.activeName === 'Alice' ? b : a;
    activeSocket.emit('submit_clue', { clue: 'oceano', round: 1 });
    await waitFor(() => aT.state.phase === 'markers1');
    otherSocket.emit('place_marker', { playerName: otherName, col: 1, row: 1, markerIndex: 1 });
    await waitFor(() => aT.state.phase === 'clue2');
    server._triggerPhaseExpire(code);
    await waitFor(() => aT.state.phase === 'markers2');
    expect(aT.state.clue2).toBeNull();
    a.disconnect(); b.disconnect();
  });

  test('expired markers1 timer auto-places a random marker for the next pending', async () => {
    const { a, b, code, aT } = await setupGame(60);
    const activeSocket = aT.state.activeName === 'Alice' ? a : b;
    activeSocket.emit('submit_clue', { clue: 'oceano', round: 1 });
    await waitFor(() => aT.state.phase === 'markers1');
    const pendingBefore = [...aT.state.pendingMarkers];
    expect(pendingBefore).toHaveLength(1);
    server._triggerPhaseExpire(code);
    // With only one pending player, the auto-mark drains the queue and the phase advances
    await waitFor(() => aT.state.phase === 'clue2');
    const otherName = pendingBefore[0];
    expect(aT.state.markers[otherName]).toBeDefined();
    expect(aT.state.markers[otherName][1]).toEqual(expect.objectContaining({
      col: expect.any(Number), row: expect.any(Number),
    }));
    a.disconnect(); b.disconnect();
  });

  test('expired markers2 timer auto-completes and advances to reveal', async () => {
    const { a, b, code, aT } = await setupGame(60);
    const activeSocket = aT.state.activeName === 'Alice' ? a : b;
    const otherName = aT.state.activeName === 'Alice' ? 'Bob' : 'Alice';
    const otherSocket = aT.state.activeName === 'Alice' ? b : a;
    activeSocket.emit('submit_clue', { skip: true, round: 1 });
    await waitFor(() => aT.state.phase === 'markers1');
    otherSocket.emit('place_marker', { playerName: otherName, col: 0, row: 0, markerIndex: 1 });
    await waitFor(() => aT.state.phase === 'clue2');
    activeSocket.emit('submit_clue', { skip: true, round: 2 });
    await waitFor(() => aT.state.phase === 'markers2');
    server._triggerPhaseExpire(code);
    await waitFor(() => aT.state.phase === 'reveal');
    a.disconnect(); b.disconnect();
  });

  test('expired reveal timer auto-advances to next turn', async () => {
    const { a, b, code, aT } = await setupGame(60);
    const activeSocket = aT.state.activeName === 'Alice' ? a : b;
    const otherName = aT.state.activeName === 'Alice' ? 'Bob' : 'Alice';
    const otherSocket = aT.state.activeName === 'Alice' ? b : a;
    activeSocket.emit('submit_clue', { skip: true, round: 1 });
    await waitFor(() => aT.state.phase === 'markers1');
    otherSocket.emit('place_marker', { playerName: otherName, col: 0, row: 0, markerIndex: 1 });
    await waitFor(() => aT.state.phase === 'clue2');
    activeSocket.emit('submit_clue', { skip: true, round: 2 });
    await waitFor(() => aT.state.phase === 'markers2');
    otherSocket.emit('place_marker', { playerName: otherName, col: 0, row: 0, markerIndex: 2 });
    await waitFor(() => aT.state.phase === 'reveal');
    const originalActive = aT.state.activeName;
    server._triggerPhaseExpire(code);
    await waitFor(() => aT.state.phase === 'clue1' || aT.state.phase === 'end');
    if (aT.state.phase === 'clue1') {
      expect(aT.state.activeName).not.toBe(originalActive);
    }
    a.disconnect(); b.disconnect();
  });

  test('extend_timer adds 10s and is allowed only once per turn', async () => {
    const { a, b, code, aT } = await setupGame(60);
    const originalDeadline = aT.state.phaseDeadline;
    a.emit('extend_timer');
    await waitFor(() => aT.state.phaseDeadline >= originalDeadline + 9000);
    expect(aT.state.turnExtended).toBe(true);
    const afterFirst = aT.state.phaseDeadline;
    // second extend in same turn is ignored
    a.emit('extend_timer');
    await sleep(200);
    expect(aT.state.phaseDeadline).toBeLessThanOrEqual(afterFirst + 100);
    a.disconnect(); b.disconnect();
  });

  test('extend_timer is ignored when game has no active timer', async () => {
    const { a, b, code, aT } = await setupGame(0);
    a.emit('extend_timer');
    await sleep(200);
    expect(aT.state.phaseDeadline).toBeNull();
    expect(aT.state.turnExtended).toBe(false);
    a.disconnect(); b.disconnect();
  });

  test('turnExtended resets at the start of a new turn', async () => {
    const { a, b, code, aT } = await setupGame(60);
    a.emit('extend_timer');
    await waitFor(() => aT.state.turnExtended === true);
    const activeSocket = aT.state.activeName === 'Alice' ? a : b;
    const otherName = aT.state.activeName === 'Alice' ? 'Bob' : 'Alice';
    const otherSocket = aT.state.activeName === 'Alice' ? b : a;
    activeSocket.emit('submit_clue', { skip: true, round: 1 });
    await waitFor(() => aT.state.phase === 'markers1');
    otherSocket.emit('place_marker', { playerName: otherName, col: 0, row: 0, markerIndex: 1 });
    await waitFor(() => aT.state.phase === 'clue2');
    activeSocket.emit('submit_clue', { skip: true, round: 2 });
    await waitFor(() => aT.state.phase === 'markers2');
    otherSocket.emit('place_marker', { playerName: otherName, col: 0, row: 0, markerIndex: 2 });
    await waitFor(() => aT.state.phase === 'reveal');
    activeSocket.emit('next_round');
    await waitFor(() => aT.state.phase === 'clue1' && aT.state.turnExtended === false);
    a.disconnect(); b.disconnect();
  });

  test('resetGame preserves timerSeconds', async () => {
    const { a, b, code, aT } = await setupGame(30);
    a.emit('reset_game');
    await waitFor(() => aT.state.status === 'lobby');
    expect(aT.state.timerSeconds).toBe(30);
    expect(aT.state.phaseDeadline).toBeNull();
    a.disconnect(); b.disconnect();
  });
});
