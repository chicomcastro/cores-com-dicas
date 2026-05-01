(function () {
  const socket = io();
  const { COLS, ROWS, generateBoard, cellHsl, chebyshev } = window.GameColors;

  const cells = generateBoard();
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
  const playerNameInput = $('player-name-input');
  const addPlayerBtn = $('add-player-btn');
  let localLobby = [];

  function renderLobby() {
    lobbyPlayersEl.innerHTML = '';
    const conn = state?.lobbyConnected || {};
    localLobby.forEach((name, i) => {
      const li = document.createElement('li');
      li.innerHTML = `
        <span class="swatch" style="background:${PLAYER_COLOR(i)}"></span>
        <span class="name">${escapeHtml(name)}</span>
        <span class="conn-dot ${conn[name] ? 'on' : ''}"></span>
        <button class="remove" data-name="${escapeHtml(name)}">✕</button>
      `;
      lobbyPlayersEl.appendChild(li);
    });
    lobbyPlayersEl.querySelectorAll('.remove').forEach(btn => {
      btn.addEventListener('click', () => {
        localLobby = localLobby.filter(n => n !== btn.dataset.name);
        emitLobbyUpdate();
      });
    });
    const enough = localLobby.length >= 3 && localLobby.length <= 10;
    startBtn.disabled = !enough;
    if (localLobby.length < 3) lobbyHelp.textContent = `Faltam ${3 - localLobby.length} jogador(es).`;
    else if (localLobby.length > 10) lobbyHelp.textContent = 'Máximo 10 jogadores.';
    else lobbyHelp.textContent = 'Pronto para iniciar!';
  }

  function PLAYER_COLOR(i) {
    const palette = ['#e63946', '#1d3557', '#2a9d8f', '#f4a261', '#7209b7', '#06aed5', '#80b918', '#ff006e', '#3a86ff', '#fb8500'];
    return palette[i % palette.length];
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function emitLobbyUpdate() {
    socket.emit('lobby_update', { players: localLobby });
    renderLobby();
  }

  function addPlayerFromInput() {
    const v = playerNameInput.value.trim();
    if (!v) return;
    if (localLobby.includes(v)) { playerNameInput.value = ''; return; }
    if (localLobby.length >= 10) return;
    localLobby.push(v);
    playerNameInput.value = '';
    emitLobbyUpdate();
  }

  addPlayerBtn.addEventListener('click', addPlayerFromInput);
  playerNameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') addPlayerFromInput(); });
  startBtn.addEventListener('click', () => {
    socket.emit('start_game', { players: localLobby });
  });

  function renderConnected() {
    if (!state) return;
    connectedListEl.innerHTML = '';
    const conn = state.lobbyConnected || {};
    state.lobbyPlayers.forEach((name, i) => {
      if (!conn[name]) return;
      const li = document.createElement('li');
      li.innerHTML = `<span class="swatch" style="background:${PLAYER_COLOR(i)}; width:10px; height:10px; border-radius:50%; display:inline-block;"></span><span>${escapeHtml(name)}</span>`;
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
    boardGrid.innerHTML = '';
    cellEls = [];
    cells.forEach((c, idx) => {
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
    return cellEls[row * COLS + col];
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
        phaseTitle.textContent = 'Coloquem os marcadores';
        phaseDesc.textContent = 'Toque no tablet para marcar onde acham que é a cor.';
        showPlacingBanner(1);
        break;
      case 'clue2':
        phaseTitle.textContent = 'Aguardando segunda dica (até 2 palavras)';
        phaseDesc.textContent = `${state.activeName} está pensando…`;
        break;
      case 'markers2':
        phaseTitle.textContent = 'Coloquem o segundo marcador';
        phaseDesc.textContent = 'Toque no tablet para mover ou adicionar o marcador.';
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
      : 'Adicione um 2º marcador ou mova o 1º.';
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
      const delta = state.roundScores ? state.roundScores[p.name] || 0 : null;
      li.innerHTML = `
        <span class="swatch" style="background:${p.color}"></span>
        <span class="name">${escapeHtml(p.name)}</span>
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
      li.innerHTML = `
        <span class="rank">#${i + 1}</span>
        <span class="swatch" style="background:${p.color}"></span>
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

  /* ---------- SOCKET ---------- */
  socket.on('connect', () => socket.emit('hello_board'));

  socket.on('game_state', (s) => {
    const wasEnded = state && state.phase === 'end';
    state = s;

    if (s.status === 'lobby') {
      // sync local lobby with server
      if (JSON.stringify(localLobby) !== JSON.stringify(s.lobbyPlayers)) {
        localLobby = [...s.lobbyPlayers];
      }
      renderLobby();
      renderConnected();
      showScreen('lobby');
      stopConfetti();
      return;
    }
    if (s.status === 'playing') {
      if (boardGrid.children.length === 0) buildBoard();
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

  // Build at first
  buildBoard();
})();
