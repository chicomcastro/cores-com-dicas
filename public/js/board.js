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
  let pendingSelect = null;
  let lastPhase = null;
  let roomCode = sessionStorage.getItem('ccd:board-room') || null;
  let soundOn = (localStorage.getItem('ccd:sound') !== '0');

  function colLabel(i) {
    let s = '';
    let n = i;
    while (true) {
      s = String.fromCharCode(65 + (n % 26)) + s;
      n = Math.floor(n / 26) - 1;
      if (n < 0) break;
    }
    return s;
  }
  function rowLabel(i) { return String(i + 1); }

  /* ---------- AUDIO ---------- */
  let audioCtx = null;
  function ensureAudio() {
    if (audioCtx) return audioCtx;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return null;
      audioCtx = new Ctx();
    } catch (e) { audioCtx = null; }
    return audioCtx;
  }
  function beep(freq, durationMs, type, gain) {
    if (!soundOn) return;
    const ctx = ensureAudio();
    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type || 'sine';
    osc.frequency.value = freq;
    g.gain.value = gain == null ? 0.08 : gain;
    osc.connect(g); g.connect(ctx.destination);
    const now = ctx.currentTime;
    g.gain.setValueAtTime(g.gain.value, now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + durationMs / 1000);
    osc.start(now);
    osc.stop(now + durationMs / 1000 + 0.02);
  }
  function chime(notes) {
    if (!soundOn) return;
    let t = 0;
    notes.forEach(n => {
      setTimeout(() => beep(n.f, n.d || 150, n.type || 'sine', n.g), t);
      t += (n.gap != null ? n.gap : (n.d || 150));
    });
  }
  function phaseChime(phase) {
    switch (phase) {
      case 'clue1':
      case 'clue2':
        chime([{ f: 660, d: 120 }, { f: 880, d: 180 }]);
        break;
      case 'markers1':
      case 'markers2':
        chime([{ f: 520, d: 100 }, { f: 660, d: 100 }, { f: 820, d: 200 }]);
        break;
      case 'reveal':
        chime([{ f: 880, d: 100 }, { f: 1100, d: 100 }, { f: 1320, d: 220 }]);
        break;
      case 'end':
        chime([{ f: 660, d: 120 }, { f: 880, d: 120 }, { f: 1100, d: 120 }, { f: 1320, d: 280 }]);
        break;
    }
  }

  const $ = (id) => document.getElementById(id);

  /* ---------- ROOM CREATION ---------- */
  function createNewRoom() {
    socket.emit('create_room', null, (resp) => {
      if (!resp || !resp.code) return;
      roomCode = resp.code;
      sessionStorage.setItem('ccd:board-room', roomCode);
      renderRoomCode();
      fetchQr();
      socket.emit('hello_board');
    });
  }

  socket.on('connect', () => {
    if (roomCode) {
      socket.emit('join_room', { code: roomCode });
      socket.emit('hello_board');
      renderRoomCode();
      fetchQr();
      return;
    }
    createNewRoom();
  });

  socket.on('join_rejected', () => {
    roomCode = null;
    sessionStorage.removeItem('ccd:board-room');
    createNewRoom();
  });

  function renderRoomCode() {
    const el = $('room-code');
    if (el) el.textContent = roomCode || '—';
  }

  let playerUrl = '';
  $('copy-url-btn').addEventListener('click', () => {
    if (!playerUrl) return;
    navigator.clipboard.writeText(playerUrl).then(() => {
      $('copy-url-btn').textContent = '✓';
      setTimeout(() => { $('copy-url-btn').textContent = '📋'; }, 1500);
    }).catch(() => {});
  });

  function fetchQr() {
    const param = roomCode ? `?room=${roomCode}` : '';
    fetch(`/qr${param}`).then(r => r.json()).then(d => {
      if (d.qr) $('qr-img').src = d.qr;
      if (d.url) { playerUrl = d.url; $('qr-url').textContent = d.url; }
    }).catch(() => {});
  }

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

  /* ---------- BOARD GRID ---------- */
  const boardGrid = $('board-grid');
  const colLabelsEl = $('board-col-labels');
  const rowLabelsEl = $('board-row-labels');
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

    colLabelsEl.innerHTML = '';
    colLabelsEl.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
    for (let i = 0; i < cols; i++) {
      const s = document.createElement('span');
      s.textContent = colLabel(i);
      colLabelsEl.appendChild(s);
    }
    rowLabelsEl.innerHTML = '';
    rowLabelsEl.style.gridTemplateRows = `repeat(${rows}, 1fr)`;
    for (let i = 0; i < rows; i++) {
      const s = document.createElement('span');
      s.textContent = rowLabel(i);
      rowLabelsEl.appendChild(s);
    }
  }

  function cellEl(col, row) {
    return cellEls[row * currentCols + col];
  }

  function clearPendingSelect() {
    if (pendingSelect) {
      const el = cellEl(pendingSelect.col, pendingSelect.row);
      if (el) {
        el.classList.remove('pending-select');
        el.style.removeProperty('--player-color');
        el.style.removeProperty('--player-glow');
      }
      pendingSelect = null;
    }
  }

  function highlightPendingSelect(c) {
    clearPendingSelect();
    const el = cellEl(c.col, c.row);
    if (!el) return;
    const next = (state.pendingMarkers || [])[0];
    const player = state.players.find(p => p.name === next);
    const color = player?.color || '#ffffff';
    el.style.setProperty('--player-color', color);
    el.style.setProperty('--player-glow', hexToRgba(color, 0.55));
    el.classList.add('pending-select');
    pendingSelect = { col: c.col, row: c.row };
  }

  function hexToRgba(hex, alpha) {
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || '');
    if (!m) return `rgba(255,255,255,${alpha})`;
    const r = parseInt(m[1], 16), g = parseInt(m[2], 16), b = parseInt(m[3], 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }

  function onCellClick(c) {
    if (!state) return;
    if (state.phase !== 'markers1' && state.phase !== 'markers2') return;
    const next = (state.pendingMarkers || [])[0];
    if (!next) return;

    if (pendingSelect && pendingSelect.col === c.col && pendingSelect.row === c.row) {
      const markerIndex = state.phase === 'markers1' ? 1 : 2;
      socket.emit('place_marker', {
        playerName: next,
        col: c.col,
        row: c.row,
        markerIndex
      });
      clearPendingSelect();
      beep(720, 90, 'sine', 0.06);
      return;
    }
    highlightPendingSelect(c);
    const round = state.phase === 'markers1' ? 1 : 2;
    placingHintEl.textContent = round === 1
      ? 'Toque novamente para confirmar.'
      : 'Confirme a seleção do segundo marcador.';
    beep(440, 50, 'sine', 0.04);
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
    if (pendingSelect) {
      const el = cellEl(pendingSelect.col, pendingSelect.row);
      const validPhase = state.phase === 'markers1' || state.phase === 'markers2';
      if (el && validPhase && (state.pendingMarkers || []).length > 0) {
        el.classList.add('pending-select');
      } else {
        clearPendingSelect();
      }
    }
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
    const phasesAfterClue1 = ['markers1', 'clue2', 'markers2', 'reveal', 'end'];
    const phasesAfterClue2 = ['markers2', 'reveal', 'end'];
    if (state.clue1) {
      clue1El.textContent = state.clue1;
      clue1El.classList.remove('skipped');
    } else if (phasesAfterClue1.includes(state.phase)) {
      clue1El.textContent = '(pulou)';
      clue1El.classList.add('skipped');
    } else {
      clue1El.textContent = '—';
      clue1El.classList.remove('skipped');
    }
    if (state.clue2) {
      clue2El.textContent = state.clue2;
      clue2El.classList.remove('skipped');
    } else if (phasesAfterClue2.includes(state.phase)) {
      clue2El.textContent = '(pulou)';
      clue2El.classList.add('skipped');
    } else {
      clue2El.textContent = '—';
      clue2El.classList.remove('skipped');
    }
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
        phaseDesc.textContent = 'Cada jogador adiciona um segundo marcador.';
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
    if (pendingSelect) {
      placingHintEl.textContent = round === 1
        ? 'Toque novamente para confirmar.'
        : 'Confirme a seleção do segundo marcador.';
    } else {
      placingHintEl.textContent = round === 1
        ? 'Toque na cor que acha ser a secreta.'
        : 'Toque para adicionar o segundo marcador.';
    }
    placingChoiceEl.classList.add('hidden');
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
    ['loading', 'lobby', 'game', 'end'].forEach(s => {
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

  /* sound toggle */
  const soundToggle = $('sound-toggle');
  function syncSoundToggle() {
    soundToggle.textContent = soundOn ? '🔊' : '🔇';
    soundToggle.classList.toggle('muted', !soundOn);
    soundToggle.title = soundOn ? 'Som ligado' : 'Som mutado';
  }
  syncSoundToggle();
  soundToggle.addEventListener('click', () => {
    soundOn = !soundOn;
    localStorage.setItem('ccd:sound', soundOn ? '1' : '0');
    syncSoundToggle();
    if (soundOn) {
      ensureAudio();
      beep(880, 80, 'sine', 0.06);
    }
  });

  /* reset round modal */
  const resetRoundBtn = $('reset-round-btn');
  const resetRoundModal = $('reset-round-modal');
  $('reset-round-cancel').addEventListener('click', () => resetRoundModal.classList.add('hidden'));
  resetRoundModal.addEventListener('click', (e) => {
    if (e.target === resetRoundModal) resetRoundModal.classList.add('hidden');
  });
  resetRoundBtn.addEventListener('click', () => {
    if (!state || !state.players) return;
    if (state.phase === 'reveal' || state.phase === 'end') {
      toast('Não é possível resetar agora.');
      return;
    }
    resetRoundModal.classList.remove('hidden');
  });
  $('reset-round-confirm').addEventListener('click', () => {
    if (!state || !state.players) return;
    const active = state.players[state.activeIdx];
    if (active) socket.emit('change_active_player', { playerName: active.name });
    resetRoundModal.classList.add('hidden');
  });

  /* ---------- SOCKET ---------- */
  socket.on('game_state', (s) => {
    const wasEnded = state && state.phase === 'end';
    const prevPhase = lastPhase;
    const prevActive = state ? state.activeName : null;
    state = s;
    if (s.roomCode) {
      roomCode = s.roomCode;
      sessionStorage.setItem('ccd:board-room', roomCode);
      renderRoomCode();
    }

    if (s.status === 'lobby') {
      renderLobby();
      renderConnected();
      renderRoomCode();
      showScreen('lobby');
      stopConfetti();
      lastPhase = null;
      return;
    }
    if (s.status === 'playing') {
      if (boardGrid.children.length === 0 || currentCols !== s.boardCols || currentRows !== s.boardRows) buildBoard();
      showScreen('game');
      stopConfetti();
      renderPhase();
      renderMarkers();
      renderScoreboard();

      if (s.phase !== prevPhase || s.activeName !== prevActive) {
        clearPendingSelect();
        if (s.phase !== prevPhase && prevPhase != null) phaseChime(s.phase);
      }
      lastPhase = s.phase;
      return;
    }
    if (s.status === 'ended') {
      renderEndScreen();
      showScreen('end');
      if (!wasEnded) {
        startConfetti();
        phaseChime('end');
      }
      lastPhase = s.phase;
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
