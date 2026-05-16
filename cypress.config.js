const { defineConfig } = require('cypress');
const ioc = require('socket.io-client');

/**
 * Cypress task helpers: spawn lightweight headless "drivers" that play
 * non-protagonist players via socket.io-client. The UI controls Alice;
 * drivers respond to game_state events to keep the game moving.
 */
function makeDriver(baseUrl, code, name) {
  const socket = ioc(baseUrl, { reconnection: false, forceNew: true });
  return new Promise((resolve, reject) => {
    let secret = null;
    socket.on('connect', () => {
      socket.emit('join_room', { code });
    });
    socket.on('room_joined', () => {
      socket.emit('join', { playerName: name, room: code });
    });
    socket.on('join_accepted', () => resolve({ socket, getSecret: () => secret }));
    socket.on('join_rejected', (d) => reject(new Error(d && d.reason)));
    socket.on('your_secret', (s) => { secret = s; });
    socket.on('game_state', (state) => {
      // Auto-play this driver's role
      const me = state.players.find(p => p.name === name);
      if (!me) return;
      const isActive = state.activeName === name;
      const phase = state.phase;

      if (isActive && (phase === 'clue1' || phase === 'clue2')) {
        const clue = phase === 'clue1' ? 'tarde' : 'fim manso';
        setTimeout(() => socket.emit('submit_clue', { clue, round: phase === 'clue1' ? 1 : 2 }), 60);
      }
      if (!isActive && (phase === 'markers1' || phase === 'markers2') && state.pendingMarkers?.includes(name)) {
        const idx = phase === 'markers1' ? 1 : 2;
        const col = (state.boardCols / 2) | 0;
        const row = (state.boardRows / 2) | 0;
        setTimeout(() => socket.emit('place_marker', { playerName: name, col, row, markerIndex: idx }), 60);
      }
      if (isActive && phase === 'reveal') {
        setTimeout(() => socket.emit('next_round'), 80);
      }
    });
    setTimeout(() => reject(new Error('Driver connect timeout for ' + name)), 5000);
  });
}

const drivers = new Map();

module.exports = defineConfig({
  e2e: {
    baseUrl: 'http://localhost:3000',
    specPattern: 'cypress/e2e/**/*.cy.{js,ts}',
    supportFile: 'cypress/support/e2e.js',
    fixturesFolder: 'cypress/fixtures',
    screenshotsFolder: 'cypress/screenshots',
    videosFolder: 'cypress/videos',
    video: false,
    screenshotOnRunFailure: true,
    viewportWidth: 412,
    viewportHeight: 850,
    defaultCommandTimeout: 8000,
    setupNodeEvents(on, config) {
      on('task', {
        async startDriver({ code, name }) {
          const base = config.baseUrl;
          const drv = await makeDriver(base, code, name);
          drivers.set(name, drv);
          return true;
        },
        stopAllDrivers() {
          for (const { socket } of drivers.values()) {
            try { socket.disconnect(); } catch (e) {}
          }
          drivers.clear();
          return null;
        },
        log(message) {
          // forward to terminal during cypress run
          // eslint-disable-next-line no-console
          console.log('[cy-log]', message);
          return null;
        },
      });
    },
  },
});
