(function () {
  const socket = io();
  const { generateBoard, cellHsl, chebyshev } = window.GameColors;

  let cells = [];
  let currentCols = 0;
  let currentRows = 0;
  let state = null;
  let cellEls = [];
  let placingPlayerName = null;
  let placingChoice = null;

  const $ = (id) => document.getElementById(id);

  /* ---------- LOBBY ---------- */
  const lobbyPlayersEl = $('lobby-players');
  const connectedListEl = $('connected-players');
  const startBtn = $('start-btn');
  const lobbyHelp = $('lobby-help');

  function renderLobby() {
    if (!state) return;
    const names = state.lobbyPlayers || [];
    const conn = state.lobbyConnected || {};
    lobbyPlayersEl.innerHTML = '';
    names.forEach((name, i) => {
      const li = document.createElement('li');
      li.style.setProperty('--player-color', PLAYER_COLOR(i));
      li.innerHTML = `
        <span class="name">${escapeHtml(name)}</span>
        <span class="conn-dot ${conn[name] ? 'on' : ''}"></span>
        <button class="remove" data-name="${escapeHtml(name)}">✕</button>
      `;
      lobbyPlayersEl.appendChild(li);
    });
    lobbyPlayersEl.querySelectorAll('.remove').forEach(btn => {
      btn.addEventListener('click', () => {
        socket.emit('kick_player', { playerName: btn.dataset.name });
      });
    });
    const enough = names.length >= 2 && names.length <= 10;
    startBtn.disabled = !enough;
    if (names.length < 2) lobbyHelp.textContent = `Faltam ${2 - names.length} jogador(es).`;
    else if (names.length > 10) lobbyHelp.textContent = 'Máximo 10 jogadores.';
    else lobbyHelp.textContent = 'Pronto para iniciar!';
  }

  function PLAYER_COLOR(i) {
    const palette = ['#e63946', '#4a90d9', '#2a9d8f', '#f4a261', '#7209b7', '#06aed5', '#80b918', '#ff006e', '#3a86ff', '#fb8500'];
    return palette[i % palette.length];
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  const GRID_PRESETS = [
    { label: 'Fácil (15×9)',    cols: 15, rows: 9  },
    { label: 'Médio (20×12)',   cols: 20, rows: 12 },
    { label: 'Difícil (30×18)', cols: 30, rows: 18 },
  ];
  let selectedPreset = 1;

  const gridSizeOptions = $('grid-size-options');
  function renderGridPresets() {
    gridSizeOptions.innerHTML = '';
    GRID_PRESETS.forEach((p, i) => {
      const btn = document.createElement('button');
      btn.className = 'grid-size-btn' + (i === selectedPreset ? ' active' : '');
      btn.textContent = p.label;
      btn.addEventListener('click', () => { selectedPreset = i; renderGridPresets(); });
      gridSizeOptions.appendChild(btn);
    });
  }
  renderGridPresets();

  startBtn.addEventListener('click', () => {
    const preset = GRID_PRESETS[selectedPreset];
    socket.emit('start_game', {
      players: state?.lobbyPlayers || [],
      cols: preset.cols,
      rows: preset.rows
    });
  });

  function renderConnected() {
    if (!state) return;
    connectedListEl.innerHTML = '';
    const conn = state.lobbyConnected || {};
    state.lobbyPlayers.forEach((name, i) => {
      if (!conn[name]) return;
      const li = document.createElement('li');
      li.style.borderLeft = `3px solid ${PLAYER_COLOR(i)}`;
      li.innerHTML = `<span>${escapeHtml(name)}</span>`;
      connectedListEl.appendChild(li);
    });
  }

  /* ---------- QR CODE ---------- */
  fetch('/qr').then(r => r.json()).then(d => {
    if (d.qr) document.getElementById('qr-img').src = d.qr;
    if (d.url) document.getElementById('qr-url').textContent = d.url;
  }).catch(() => {});

  /* ---------- BOARD GRID ---------- */
  const boardGrid = $('board-grid');
  function buildBoard() {
    const cols = state ? state.boardCols : 30;
    const rows = state ? state.boardRows : 18;
    cells = generateBoard(cols, rows);
    currentCols = cols;
    currentRows = rows;
    boardGrid.innerHTML = '';
    boardGrid.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
    boardGrid.style.gridTemplateRows = `repeat(${rows}, 1fr)`;
    cellEls = [];
    cells.forEach((c) => {
      const div = document.createElement('div');
      div.className = 'cell';
      div.style.background = cellHsl(c);
      div.dataset.col = c.col;
      div.dataset.row = c.row;
      div.dataset.id = c.id;
      div.addEventListener('click', () => onCellClick(c));
      boardGrid.appendChild(div);
      cellEls.push(div);
    });
  }

  function cellEl(col, row) {
    return cellEls[row * currentCols + col];
  }

  function onCellClick(c) {
    if (!state) return;
    if (state.phase !== 'markers1' && state.phase !== 'markers2') return;
    const next = (state.pendingMarkers || [])[0];
    if (!next) return;
    const markerIndex = state.phase === 'markers1' ? 1 : (placingChoice || 2);
    socket.emit('place_marker', {
      playerName: next,
      col: c.col,
      row: c.row,
      markerIndex
    });
    placingChoice = null;
    syncChoiceButtons();
  }

  const placingChoiceEl = document.getElementById('placing-choice');
  placingChoiceEl.querySelectorAll('.choice-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      placingChoice = +btn.dataset.mi;
      syncChoiceButtons();
    });
  });
  function syncChoiceButtons() {
    placingChoiceEl.querySelectorAll('.choice-btn').forEach(b => {
      const v = +b.dataset.mi;
      const active = (placingChoice || 2) === v;
      b.classList.toggle('active', active);
    });
  }

  /* ---------- RENDER GAME ---------- */
  const placingBanner = $('placing-banner');
  const placingNameEl = $('placing-name');
  const placingHintEl = $('placing-hint');
  const phaseTitle = $('phase-title');
  const phaseDesc = $('phase-desc');
  const activeNameEl = $('active-name');
  const clue1El = $('clue-1');
  const clue2El = $('clue-2');
  const scoreboardEl = $('scoreboard');
  const nextRoundBtn = $('next-round-btn');
  const playAgainBtn = $('play-again-btn');

  function renderMarkers() {
    cellEls.forEach(el => {
      el.querySelectorAll('.marker').forEach(m => m.remove());
      el.classList.remove('secret-reveal', 'score-3x3', 'score-5x5', 'revealed');
    });
    if (!state) return;
    Object.entries(state.markers || {}).forEach(([name, mks]) => {
      const player = state.players.find(p => p.name === name);
      if (!player) return;
      [1, 2].forEach(idx => {
        const m = mks[idx];
        if (!m) return;
        const el = cellEl(m.col, m.row);
        if (!el) return;
        const dot = document.createElement('div');
        dot.className = 'marker' + (idx === 2 ? ' m2' : '');
        dot.style.background = player.color;
        dot.title = `${name} (${idx})`;
        dot.textContent = name.charAt(0).toUpperCase();
        el.appendChild(dot);
      });
    });

    if (state.revealCell) {
      const el = cellEl(state.revealCell.col, state.revealCell.row);
      if (el) el.classList.add('secret-reveal');
      // Highlight scoring zones
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const c = state.revealCell.col + dc, r = state.revealCell.row + dr;
          const e = cellEl(c, r);
          if (!e) continue;
          const d = Math.max(Math.abs(dc), Math.abs(dr));
          if (d === 0) continue;
          if (d <= 1) e.classList.add('score-3x3');
          else e.classList.add('score-5x5');
        }
      }
      cellEls.forEach(e => e.classList.add('revealed'));
    }
  }

  function renderPhase() {
    if (!state) return;
    activeNameEl.textContent = state.activeName || '—';
    activeNameEl.style.color = state.players[state.activeIdx]?.color || '#fff';
    clue1El.textContent = state.clue1 || '—';
    clue2El.textContent = state.clue2 || '—';
    $('round-num').textContent = state.currentRound;
    $('round-total').textContent = state.rounds;
    $('turn-num').textContent = Math.min(state.turnsTaken + 1, state.totalTurns);
    $('turn-total').textContent = state.totalTurns;

    placingBanner.classList.add('hidden');
    nextRoundBtn.classList.add('hidden');
    playAgainBtn.classList.add('hidden');

    switch (state.phase) {
      case 'clue1':
        phaseTitle.textContent = 'Aguardando dica (1 palavra)';
        phaseDesc.textContent = `${state.activeName} está pensando…`;
        break;
      case 'markers1':
        phaseTitle.textContent = 'Hora de marcar';
        phaseDesc.textContent = 'Cada jogador toca no tabuleiro onde acha que é a cor.';
        showPlacingBanner(1);
        break;
      case 'clue2':
        phaseTitle.textContent = 'Aguardando segunda dica (até 2 palavras)';
        phaseDesc.textContent = `${state.activeName} está pensando…`;
        break;
      case 'markers2':
        phaseTitle.textContent = 'Segunda marcação';
        phaseDesc.textContent = 'Mova seu marcador ou adicione um segundo.';
        showPlacingBanner(2);
        break;
      case 'reveal':
        phaseTitle.textContent = 'Revelação!';
        phaseDesc.textContent = 'A cor secreta foi revelada.';
        nextRoundBtn.classList.remove('hidden');
        nextRoundBtn.textContent = state.turnsTaken + 1 >= state.totalTurns ? 'Ver Placar Final ▶' : 'Próximo Turno ▶';
        break;
      case 'end':
        phaseTitle.textContent = 'Fim de jogo';
        phaseDesc.textContent = '';
        playAgainBtn.classList.remove('hidden');
        break;
      default:
        phaseTitle.textContent = '—';
        phaseDesc.textContent = '';
    }
  }

  function showPlacingBanner(round) {
    const next = (state.pendingMarkers || [])[0];
    if (!next) {
      placingBanner.classList.add('hidden');
      return;
    }
    const player = state.players.find(p => p.name === next);
    placingBanner.classList.remove('hidden');
    placingNameEl.textContent = next;
    placingNameEl.style.color = player?.color || '#fff';
    placingHintEl.textContent = round === 1
      ? 'Toque na cor que acha ser a secreta.'
      : 'Toque para mover ou adicionar marcador.';
    if (round === 2) {
      placingChoiceEl.classList.remove('hidden');
      syncChoiceButtons();
    } else {
      placingChoiceEl.classList.add('hidden');
    }
  }

  function renderScoreboard() {
    if (!state) return;
    scoreboardEl.innerHTML = '';
    state.players.forEach((p, i) => {
      const li = document.createElement('li');
      if (i === state.activeIdx) li.classList.add('active');
      li.style.borderLeftColor = p.color;
      const delta = state.roundScores ? state.roundScores[p.name] || 0 : null;
      li.innerHTML = `
        <span class="name">${escapeHtml(p.name)}</span>
        <span class="conn-dot ${p.connected ? 'on' : ''}"></span>
        ${delta != null && state.phase === 'reveal' ? `<span class="delta">+${delta}</span>` : ''}
        <span class="total">${p.score}</span>
      `;
      scoreboardEl.appendChild(li);
    });
  }

  /* ---------- SCREENS ---------- */
  function showScreen(name) {
    ['lobby', 'game', 'end'].forEach(s => {
      const el = document.getElementById(s);
      if (s === name) el.classList.remove('hidden'); else el.classList.add('hidden');
    });
  }

  /* ---------- TOASTS ---------- */
  const toastsEl = $('toasts');
  function toast(msg, ms = 2200) {
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = msg;
    toastsEl.appendChild(t);
    requestAnimationFrame(() => t.classList.add('show'));
    setTimeout(() => {
      t.classList.remove('show');
      setTimeout(() => t.remove(), 250);
    }, ms);
  }

  /* ---------- CONFETTI ---------- */
  let confettiAnim = null;
  function startConfetti() {
    const cnv = $('confetti');
    const ctx = cnv.getContext('2d');
    function resize() { cnv.width = cnv.clientWidth; cnv.height = cnv.clientHeight; }
    resize(); window.addEventListener('resize', resize);
    const colors = ['#ff5e5e', '#ffb84a', '#62d36b', '#5cb8ff', '#b478ff', '#ffd54a'];
    const parts = [];
    for (let i = 0; i < 200; i++) {
      parts.push({
        x: Math.random() * cnv.width,
        y: -Math.random() * cnv.height,
        vy: 2 + Math.random() * 3,
        vx: (Math.random() - 0.5) * 2,
        size: 6 + Math.random() * 6,
        color: colors[(Math.random() * colors.length) | 0],
        rot: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 0.2
      });
    }
    function tick() {
      ctx.clearRect(0, 0, cnv.width, cnv.height);
      parts.forEach(p => {
        p.x += p.vx; p.y += p.vy; p.rot += p.vr;
        if (p.y > cnv.height) { p.y = -10; p.x = Math.random() * cnv.width; }
        ctx.save();
        ctx.translate(p.x, p.y); ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.5);
        ctx.restore();
      });
      confettiAnim = requestAnimationFrame(tick);
    }
    tick();
  }
  function stopConfetti() {
    if (confettiAnim) cancelAnimationFrame(confettiAnim);
    confettiAnim = null;
    const cnv = $('confetti');
    const ctx = cnv.getContext('2d');
    ctx.clearRect(0, 0, cnv.width, cnv.height);
  }

  /* ---------- END SCREEN ---------- */
  function renderEndScreen() {
    const list = $('final-scores');
    list.innerHTML = '';
    (state.finalScores || []).forEach((p, i) => {
      const li = document.createElement('li');
      li.style.borderLeftColor = p.color;
      li.innerHTML = `
        <span class="rank">#${i + 1}</span>
        <span class="name">${escapeHtml(p.name)}</span>
        <span class="score">${p.score}</span>
      `;
      list.appendChild(li);
    });
    const winner = (state.finalScores || [])[0];
    $('winner-name').textContent = winner ? `${winner.name} venceu!` : '';
  }

  /* ---------- BUTTONS ---------- */
  nextRoundBtn.addEventListener('click', () => socket.emit('next_round'));
  playAgainBtn.addEventListener('click', () => socket.emit('reset_game'));
  $('end-play-again-btn').addEventListener('click', () => socket.emit('reset_game'));
  $('stop-game-btn').addEventListener('click', () => {
    if (confirm('Tem certeza que quer encerrar o jogo?')) socket.emit('reset_game');
  });

  /* ---------- SOCKET ---------- */
  socket.on('connect', () => socket.emit('hello_board'));

  socket.on('game_state', (s) => {
    const wasEnded = state && state.phase === 'end';
    state = s;

    if (s.status === 'lobby') {
      renderLobby();
      renderConnected();
      showScreen('lobby');
      stopConfetti();
      return;
    }
    if (s.status === 'playing') {
      if (boardGrid.children.length === 0 || currentCols !== s.boardCols || currentRows !== s.boardRows) buildBoard();
      showScreen('game');
      stopConfetti();
      renderPhase();
      renderMarkers();
      renderScoreboard();
      return;
    }
    if (s.status === 'ended') {
      renderEndScreen();
      showScreen('end');
      if (!wasEnded) startConfetti();
    }
  });

  socket.on('reveal', (data) => {
    if (data && data.scores) {
      Object.entries(data.scores).forEach(([name, pts]) => {
        if (pts > 0) toast(`${name}: +${pts}`);
      });
    }
  });

  socket.on('start_rejected', (d) => toast(d?.reason || 'Não foi possível iniciar.'));
})();
