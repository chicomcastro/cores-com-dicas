(function () {
  const socket = io();
  const $ = (id) => document.getElementById(id);
  const G = window.GameColors;

  let state = null;
  let myName = sessionStorage.getItem('ccd:name') || null;
  let myRoom = sessionStorage.getItem('ccd:room') || null;
  let mySecret = null;
  let pendingPick = null;

  // mini-board state
  let miniCells = [];
  let miniCellEls = [];
  let miniCols = 0, miniRows = 0;
  let zoom = 1;
  let panX = 0, panY = 0;

  // check URL for room code (use once, then clean URL)
  const urlParams = new URLSearchParams(window.location.search);
  const urlRoom = (urlParams.get('room') || '').toUpperCase().trim();
  if (urlRoom) {
    myRoom = urlRoom;
    sessionStorage.setItem('ccd:room', urlRoom);
    window.history.replaceState({}, '', window.location.pathname);
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

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
  function coordOf(c) { return `${colLabel(c.col)}${rowLabel(c.row)}`; }

  function showScreen(name) {
    ['loading', 'home', 'create-room', 'join-room', 'login', 'waiting', 'secret', 'wait-turn', 'place-marker', 'reveal', 'end'].forEach(s => {
      const el = document.getElementById(s);
      if (!el) return;
      if (s === name) el.classList.add('active'); else el.classList.remove('active');
    });
    const showRank = !['loading', 'home', 'create-room', 'join-room', 'login', 'waiting', 'end'].includes(name);
    document.body.classList.toggle('has-rank', showRank);
    $('mini-rank').classList.toggle('hidden', !showRank);
    const showExit = !['loading', 'home', 'create-room', 'join-room', 'login'].includes(name);
    $('exit-room-btn').classList.toggle('hidden', !showExit);
  }

  function vibrate(ms) {
    if (navigator.vibrate) {
      try { navigator.vibrate(ms); } catch (e) {}
    }
  }

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
    let t = 0;
    notes.forEach(n => {
      setTimeout(() => beep(n.f, n.d || 150, n.type || 'sine', n.g), t);
      t += (n.gap != null ? n.gap : (n.d || 150));
    });
  }
  function notifyMyTurn(kind) {
    if (kind === 'clue') {
      chime([{ f: 660, d: 120 }, { f: 880, d: 180 }]);
      vibrate([80, 40, 120]);
    } else if (kind === 'mark') {
      chime([{ f: 520, d: 100 }, { f: 720, d: 120 }, { f: 980, d: 180 }]);
      vibrate([60, 30, 60, 30, 100]);
    }
  }

  ['touchstart', 'click', 'keydown'].forEach(ev => {
    document.addEventListener(ev, function unlock() {
      ensureAudio();
      if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
    }, { once: true, passive: true });
  });

  /* ---------- GRID PRESETS ---------- */
  const GRID_PRESETS = [
    { label: 'Fácil (15×9)', cols: 15, rows: 9 },
    { label: 'Médio (20×12)', cols: 20, rows: 12 },
    { label: 'Difícil (30×18)', cols: 30, rows: 18 },
  ];
  let selectedPreset = 1;

  function renderGridOptions(container, onSelect) {
    container.innerHTML = '';
    GRID_PRESETS.forEach((p, i) => {
      const btn = document.createElement('button');
      btn.className = 'grid-size-btn' + (i === selectedPreset ? ' active' : '');
      btn.textContent = p.label;
      btn.addEventListener('click', () => { selectedPreset = i; if (onSelect) onSelect(i); renderGridOptions(container, onSelect); });
      container.appendChild(btn);
    });
  }

  /* ---------- HOME ---------- */
  function updateGreeting() {
    const el = $('home-greeting');
    if (el) el.textContent = myName ? `Olá, ${myName}!` : '';
  }

  $('home-create-btn').addEventListener('click', () => {
    renderGridOptions($('create-grid-options'));
    showScreen('create-room');
  });
  $('home-join-btn').addEventListener('click', () => {
    $('password-field').classList.add('hidden');
    $('room-status').textContent = '';
    showScreen('join-room');
  });

  /* ---------- CREATE ROOM ---------- */
  $('create-room-btn').addEventListener('click', () => {
    const password = $('create-password').value.trim() || null;
    $('create-room-btn').disabled = true;
    $('create-status').textContent = 'Criando sala…';
    socket.emit('create_room', { password, gridSize: selectedPreset }, (resp) => {
      $('create-room-btn').disabled = false;
      $('create-status').textContent = '';
      if (resp && resp.code) {
        myRoom = resp.code;
        sessionStorage.setItem('ccd:room', myRoom);
        if (password) sessionStorage.setItem('ccd:room-pw', password);
        joinAttempted = false;
        if (myName) {
          socket.emit('join', { playerName: myName, room: myRoom });
        }
      }
    });
  });
  $('create-back-btn').addEventListener('click', () => showScreen('home'));

  /* ---------- JOIN ROOM ---------- */
  const roomCodeInput = $('room-code-input');
  const roomJoinBtn = $('room-join-btn');
  const roomStatus = $('room-status');

  roomJoinBtn.addEventListener('click', joinRoom);
  roomCodeInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') joinRoom(); });
  $('join-back-btn').addEventListener('click', () => showScreen('home'));

  function joinRoom() {
    const code = roomCodeInput.value.trim().toUpperCase();
    if (!code || code.length < 3) { roomStatus.textContent = 'Digite o código da sala.'; return; }
    const pw = $('room-password-input').value.trim();
    myRoom = code;
    sessionStorage.setItem('ccd:room', code);
    if (pw) sessionStorage.setItem('ccd:room-pw', pw);
    roomStatus.textContent = 'Conectando…';
    roomJoinBtn.disabled = true;
    socket.emit('join_room', { code, password: pw || undefined });
  }

  /* ---------- LOGIN ---------- */
  const joinNameInput = $('join-name-input');
  const joinBtn = $('join-btn');
  const loginStatus = $('login-status');

  joinBtn.addEventListener('click', attemptJoin);
  joinNameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') attemptJoin(); });

  function attemptJoin() {
    const name = joinNameInput.value.trim();
    if (!name) { loginStatus.textContent = 'Digite um nome.'; return; }
    myName = name;
    sessionStorage.setItem('ccd:name', name);
    loginStatus.textContent = '';
    joinBtn.disabled = false;
    if (myRoom && state) {
      joinAttempted = false;
      socket.emit('join', { playerName: name, room: myRoom });
    } else {
      showScreen('home');
    }
  }

  /* ---------- WAITING ---------- */
  const editNameBtn = $('edit-name-btn');

  editNameBtn.addEventListener('click', () => {
    joinNameInput.value = myName || '';
    myName = null;
    loginStatus.textContent = '';
    joinBtn.disabled = false;
    showScreen('login');
  });

  /* ---------- LOBBY ACTIONS ---------- */
  function copyToClipboard(text, btn) {
    const done = () => { btn.textContent = '✓'; setTimeout(() => { btn.textContent = '📋'; }, 1500); };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(() => fallback());
    } else { fallback(); }
    function fallback() {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.cssText = 'position:fixed;opacity:0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); done(); } catch (e) {}
      ta.remove();
    }
  }

  $('lobby-copy-code').addEventListener('click', () => {
    copyToClipboard(myRoom || '', $('lobby-copy-code'));
  });

  $('lobby-start-btn').addEventListener('click', () => {
    const preset = GRID_PRESETS[selectedPreset];
    socket.emit('start_game', {
      players: state?.lobbyPlayers || [],
      cols: preset.cols,
      rows: preset.rows,
    });
  });

  function leaveRoom() {
    myRoom = null;
    state = null;
    sessionStorage.removeItem('ccd:room');
    sessionStorage.removeItem('ccd:room-pw');
    updateGreeting();
    showScreen('home');
  }

  $('lobby-leave-btn').addEventListener('click', leaveRoom);

  $('exit-room-btn').addEventListener('click', () => {
    if (confirm('Sair da sala?')) leaveRoom();
  });

  socket.on('start_rejected', (d) => {
    $('lobby-help').textContent = d?.reason || 'Não foi possível iniciar.';
  });

  function renderWaiting() {
    $('waiting-name').textContent = myName || '';
    $('lobby-room-code').textContent = myRoom || '—';

    const listEl = $('lobby-player-list');
    listEl.innerHTML = '';
    const conn = state?.lobbyConnected || {};
    (state?.lobbyPlayers || []).forEach(name => {
      const isConnected = !!conn[name];
      const div = document.createElement('div');
      div.className = 'lobby-player-item' + (isConnected ? ' connected' : '');
      div.innerHTML = `<span class="player-name">${escapeHtml(name)}</span><span class="conn-dot ${isConnected ? 'on' : ''}"></span>`;
      listEl.appendChild(div);
    });

    const names = state?.lobbyPlayers || [];
    const enough = names.length >= 2 && names.length <= 10;
    $('lobby-start-btn').disabled = !enough;
    const help = $('lobby-help');
    if (names.length < 2) help.textContent = `Faltam ${2 - names.length} jogador(es).`;
    else help.textContent = 'Pronto para iniciar!';
  }

  /* ---------- SECRET (clue giver) ---------- */
  const secretColor = $('secret-color');
  const secretIdEl = $('secret-id');
  const clueLabel = $('clue-label');
  const clueInput = $('clue-input');
  const clueSend = $('clue-send');
  const clueSkip = $('clue-skip');
  const clueError = $('clue-error');

  function setSecretRevealed(revealed) {
    if (revealed) {
      secretColor.classList.add('secret-revealed');
      secretColor.classList.remove('secret-hidden');
    } else {
      secretColor.classList.add('secret-hidden');
      secretColor.classList.remove('secret-revealed');
    }
  }

  let pressing = false;
  function onPressStart(e) {
    pressing = true;
    if (mySecret) secretColor.style.background = mySecret.hsl;
    setSecretRevealed(true);
    if (e.cancelable) e.preventDefault();
  }
  function onPressEnd() {
    if (!pressing) return;
    pressing = false;
    setSecretRevealed(false);
    secretColor.style.background = '#555';
  }
  secretColor.addEventListener('pointerdown', onPressStart);
  secretColor.addEventListener('pointerup', onPressEnd);
  secretColor.addEventListener('pointercancel', onPressEnd);
  secretColor.addEventListener('pointerleave', onPressEnd);
  secretColor.addEventListener('contextmenu', (e) => e.preventDefault());

  function renderSecret() {
    if (!mySecret) return;
    secretColor.style.background = '#555';
    setSecretRevealed(false);
    secretIdEl.textContent = coordOf(mySecret);
    const round = state.phase === 'clue1' ? 1 : 2;
    clueLabel.textContent = round === 1
      ? 'Dê a 1ª dica (1 palavra):'
      : 'Dê a 2ª dica (até 2 palavras):';
    clueInput.placeholder = round === 1 ? 'ex: oceano' : 'ex: oceano profundo';
    clueInput.value = '';
    clueError.textContent = '';
    clueSend.disabled = false;
    clueSkip.disabled = false;
    renderSecretActiveInfo();
  }

  function renderSecretActiveInfo() {
    const info = $('secret-active-info');
    if (!mySecret || !state) { info.classList.add('hidden'); return; }
    const partial = computeActivePartialScore();
    info.classList.remove('hidden');
    $('secret-coords').textContent = coordOf(mySecret);
    $('secret-partial').textContent = '+' + partial;
  }

  clueSend.addEventListener('click', sendClue);
  clueSkip.addEventListener('click', skipClue);
  clueInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendClue(); });

  function sendClue() {
    const v = clueInput.value.trim();
    if (!v) { clueError.textContent = 'Digite uma dica ou pule.'; return; }
    const round = state.phase === 'clue1' ? 1 : (state.phase === 'clue2' ? 2 : null);
    if (!round) return;
    const words = v.split(/\s+/);
    if (round === 1 && words.length !== 1) {
      clueError.textContent = 'Use exatamente 1 palavra.'; return;
    }
    if (round === 2 && (words.length < 1 || words.length > 2)) {
      clueError.textContent = 'Use até 2 palavras.'; return;
    }
    clueSend.disabled = true;
    clueSkip.disabled = true;
    socket.emit('submit_clue', { clue: v, round });
    vibrate(20);
  }

  function skipClue() {
    const round = state.phase === 'clue1' ? 1 : (state.phase === 'clue2' ? 2 : null);
    if (!round) return;
    clueSend.disabled = true;
    clueSkip.disabled = true;
    socket.emit('submit_clue', { skip: true, round });
    vibrate(20);
  }

  /* ---------- WAIT TURN ---------- */
  function renderWaitTurn() {
    $('wt-active').textContent = state.activeName || '—';
    setClueLine($('wt-clue-1'), state.clue1, ['markers1', 'clue2', 'markers2', 'reveal', 'end'].includes(state.phase));
    setClueLine($('wt-clue-2'), state.clue2, ['markers2', 'reveal', 'end'].includes(state.phase));
    const hint = $('wt-hint');
    if (state.phase === 'clue1') hint.textContent = 'Esperando a primeira dica…';
    else if (state.phase === 'clue2') hint.textContent = 'Esperando a segunda dica…';
    else hint.textContent = '';

    const isActive = state.activeName === myName;
    const inMarkers = state.phase === 'markers1' || state.phase === 'markers2';
    const activeInfo = $('wt-active-info');
    const badge = $('wt-badge');
    if (isActive && inMarkers && mySecret) {
      activeInfo.classList.remove('hidden');
      $('wt-coords').textContent = coordOf(mySecret);
      $('wt-partial').textContent = '+' + computeActivePartialScore();
      badge.textContent = 'Sua dica está no ar';
      hint.textContent = 'Os outros jogadores estão marcando…';
    } else {
      activeInfo.classList.add('hidden');
      badge.textContent = 'Aguarde sua vez';
    }
  }

  function setClueLine(el, value, afterFlag) {
    if (value) {
      el.textContent = value;
      el.classList.remove('skipped');
    } else if (afterFlag) {
      el.textContent = '(pulou)';
      el.classList.add('skipped');
    } else {
      el.textContent = '—';
      el.classList.remove('skipped');
    }
  }

  function computeActivePartialScore() {
    if (!mySecret) return 0;
    const sc = mySecret.col, sr = mySecret.row;
    let pts = 0;
    const markers = state.markers || {};
    Object.entries(markers).forEach(([name, mks]) => {
      if (name === myName) return;
      [1, 2].forEach(idx => {
        const m = mks[idx];
        if (!m) return;
        const d = Math.max(Math.abs(m.col - sc), Math.abs(m.row - sr));
        if (d <= 1) pts += 1;
      });
    });
    return Math.min(9, pts);
  }

  /* ---------- PLACE MARKER (mini board on phone) ---------- */
  const miniWrap = $('mini-board-wrap');
  const miniPan = $('mini-board-pan');
  const miniBoard = $('mini-board');
  const pmConfirm = $('pm-confirm');
  const pmSelected = $('pm-selected');

  function buildMiniBoard() {
    if (!state || !G) return;
    const cols = state.boardCols, rows = state.boardRows;
    if (cols === miniCols && rows === miniRows && miniCellEls.length) return;
    miniCols = cols; miniRows = rows;
    miniCells = G.generateBoard(cols, rows);
    miniBoard.innerHTML = '';
    miniBoard.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
    miniBoard.style.gridTemplateRows = `repeat(${rows}, 1fr)`;

    const colLabels = $('mini-col-labels');
    const rowLabels = $('mini-row-labels');
    colLabels.innerHTML = '';
    colLabels.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
    for (let i = 0; i < cols; i++) {
      const s = document.createElement('span');
      s.textContent = colLabel(i);
      colLabels.appendChild(s);
    }
    rowLabels.innerHTML = '';
    rowLabels.style.gridTemplateRows = `repeat(${rows}, 1fr)`;
    for (let i = 0; i < rows; i++) {
      const s = document.createElement('span');
      s.textContent = rowLabel(i);
      rowLabels.appendChild(s);
    }

    miniCellEls = [];
    miniCells.forEach(c => {
      const div = document.createElement('div');
      div.className = 'mini-cell';
      div.style.background = G.cellHsl(c);
      div.dataset.col = c.col; div.dataset.row = c.row;
      div.addEventListener('click', () => onMiniCellClick(c));
      miniBoard.appendChild(div);
      miniCellEls.push(div);
    });
  }
  function miniCellEl(col, row) { return miniCellEls[row * miniCols + col]; }

  function onMiniCellClick(c) {
    if (!state) return;
    if (state.phase !== 'markers1' && state.phase !== 'markers2') return;
    if (!(state.pendingMarkers || []).includes(myName)) return;
    if (pendingPick && pendingPick.col === c.col && pendingPick.row === c.row) {
      const markerIndex = state.phase === 'markers1' ? 1 : 2;
      socket.emit('place_marker', { playerName: myName, col: c.col, row: c.row, markerIndex });
      vibrate(40);
      beep(720, 90, 'sine', 0.06);
      clearPendingPick();
      return;
    }
    setPendingPick(c);
    beep(440, 50, 'sine', 0.04);
    vibrate(15);
  }

  function setPendingPick(c) {
    clearPendingPick();
    pendingPick = { col: c.col, row: c.row };
    const el = miniCellEl(c.col, c.row);
    if (!el) return;
    const me = state.players.find(p => p.name === myName);
    const color = me?.color || '#ffffff';
    el.style.setProperty('--my-color', color);
    el.style.setProperty('--my-glow', hexToRgba(color, 0.55));
    el.classList.add('pending');
    pmSelected.classList.add('has-pick');
    pmSelected.textContent = `Selecionado: ${colLabel(c.col)}${rowLabel(c.row)} — toque novamente ou no botão abaixo para confirmar`;
    pmConfirm.disabled = false;
  }
  function clearPendingPick() {
    if (pendingPick) {
      const el = miniCellEl(pendingPick.col, pendingPick.row);
      if (el) {
        el.classList.remove('pending');
        el.style.removeProperty('--my-color');
        el.style.removeProperty('--my-glow');
      }
    }
    pendingPick = null;
    pmSelected.classList.remove('has-pick');
    pmSelected.textContent = 'Selecione uma cor…';
    pmConfirm.disabled = true;
  }
  function hexToRgba(hex, alpha) {
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || '');
    if (!m) return `rgba(255,255,255,${alpha})`;
    const r = parseInt(m[1], 16), g = parseInt(m[2], 16), b = parseInt(m[3], 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }

  pmConfirm.addEventListener('click', () => {
    if (!pendingPick || !state) return;
    if (state.phase !== 'markers1' && state.phase !== 'markers2') return;
    if (!(state.pendingMarkers || []).includes(myName)) return;
    const markerIndex = state.phase === 'markers1' ? 1 : 2;
    socket.emit('place_marker', { playerName: myName, col: pendingPick.col, row: pendingPick.row, markerIndex });
    vibrate(40);
    beep(720, 90, 'sine', 0.06);
    clearPendingPick();
  });

  function renderPlaceMarker() {
    buildMiniBoard();
    setClueLine($('pm-clue-1'), state.clue1, ['markers1', 'clue2', 'markers2', 'reveal', 'end'].includes(state.phase));
    setClueLine($('pm-clue-2'), state.clue2, ['markers2', 'reveal', 'end'].includes(state.phase));
    $('pm-hint').textContent = state.phase === 'markers1'
      ? 'Toque uma cor para selecionar, toque de novo para confirmar.'
      : 'Toque para adicionar o segundo marcador, toque de novo para confirmar.';
    renderMiniMarkers();
  }
  function renderMiniMarkers() {
    miniCellEls.forEach(el => el.querySelectorAll('.marker').forEach(m => m.remove()));
    if (!state) return;
    Object.entries(state.markers || {}).forEach(([name, mks]) => {
      const player = state.players.find(p => p.name === name);
      if (!player) return;
      [1, 2].forEach(idx => {
        const m = mks[idx];
        if (!m) return;
        const el = miniCellEl(m.col, m.row);
        if (!el) return;
        const dot = document.createElement('div');
        dot.className = 'marker' + (idx === 2 ? ' m2' : '');
        dot.style.background = player.color;
        dot.textContent = name.charAt(0).toUpperCase();
        el.appendChild(dot);
      });
    });
  }

  /* zoom & pan */
  function applyTransform() {
    miniPan.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
  }
  function setZoom(z, cx, cy) {
    const newZ = Math.max(1, Math.min(5, z));
    if (cx == null || cy == null) {
      zoom = newZ; clampPan(); applyTransform(); return;
    }
    const rect = miniWrap.getBoundingClientRect();
    const mx = cx - rect.left, my = cy - rect.top;
    const ratio = newZ / zoom;
    panX = mx - (mx - panX) * ratio;
    panY = my - (my - panY) * ratio;
    zoom = newZ;
    clampPan();
    applyTransform();
  }
  function clampPan() {
    const rect = miniWrap.getBoundingClientRect();
    const w = rect.width, h = rect.height;
    const ext = (zoom - 1) / 2;
    const maxX = w * ext, maxY = h * ext;
    panX = Math.max(-maxX, Math.min(maxX, panX));
    panY = Math.max(-maxY, Math.min(maxY, panY));
  }

  $('mini-zoom-in').addEventListener('click', (e) => { e.stopPropagation(); setZoom(zoom + 0.5); });
  $('mini-zoom-out').addEventListener('click', (e) => { e.stopPropagation(); setZoom(zoom - 0.5); });
  $('mini-zoom-reset').addEventListener('click', (e) => { e.stopPropagation(); zoom = 1; panX = 0; panY = 0; applyTransform(); });

  const pointers = new Map();
  let pinchStart = null;
  let panStart = null;
  let movedSinceDown = false;

  miniWrap.addEventListener('pointerdown', (e) => {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    movedSinceDown = false;
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinchStart = { dist: Math.hypot(a.x - b.x, a.y - b.y), zoom };
    } else if (pointers.size === 1 && zoom > 1) {
      panStart = { x: e.clientX, y: e.clientY, panX, panY };
    }
  });
  miniWrap.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2 && pinchStart) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const newZ = pinchStart.zoom * (d / pinchStart.dist);
      const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
      setZoom(newZ, cx, cy);
      movedSinceDown = true;
    } else if (pointers.size === 1 && panStart) {
      const dx = e.clientX - panStart.x, dy = e.clientY - panStart.y;
      if (Math.hypot(dx, dy) > 4) movedSinceDown = true;
      panX = panStart.panX + dx;
      panY = panStart.panY + dy;
      clampPan();
      applyTransform();
    }
  });
  function cancelPointer(e) {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinchStart = null;
    if (pointers.size === 0) panStart = null;
  }
  miniWrap.addEventListener('pointerup', cancelPointer);
  miniWrap.addEventListener('pointercancel', cancelPointer);
  miniWrap.addEventListener('pointerleave', cancelPointer);

  miniBoard.addEventListener('click', (e) => {
    if (movedSinceDown) {
      e.stopPropagation();
      e.preventDefault();
      movedSinceDown = false;
    }
  }, true);

  miniWrap.addEventListener('wheel', (e) => {
    e.preventDefault();
    const delta = -Math.sign(e.deltaY) * 0.2;
    setZoom(zoom + delta, e.clientX, e.clientY);
  }, { passive: false });

  /* ---------- REVEAL ---------- */
  const nextRoundBtn = $('next-round-btn');
  nextRoundBtn.addEventListener('click', () => {
    socket.emit('next_round');
    nextRoundBtn.disabled = true;
    nextRoundBtn.textContent = 'Aguardando…';
  });

  function renderReveal() {
    const me = state.players.find(p => p.name === myName);
    const delta = state.roundScores ? (state.roundScores[myName] || 0) : 0;
    $('score-big').textContent = (delta >= 0 ? '+' : '') + delta;
    $('total-score').textContent = me ? me.score : 0;
    const isLast = state.turnsTaken + 1 >= state.totalTurns;
    nextRoundBtn.textContent = isLast ? 'Ver Placar Final' : 'Próxima Rodada';
    nextRoundBtn.disabled = false;
    renderRevealBoard();
  }

  function renderRevealBoard() {
    if (!state || !G) return;
    const cols = state.boardCols, rows = state.boardRows;
    const board = $('reveal-board');
    const cells = G.generateBoard(cols, rows);
    board.innerHTML = '';
    board.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
    board.style.gridTemplateRows = `repeat(${rows}, 1fr)`;

    const rColLabels = $('reveal-col-labels');
    const rRowLabels = $('reveal-row-labels');
    rColLabels.innerHTML = '';
    rColLabels.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
    for (let i = 0; i < cols; i++) {
      const s = document.createElement('span');
      s.textContent = colLabel(i);
      rColLabels.appendChild(s);
    }
    rRowLabels.innerHTML = '';
    rRowLabels.style.gridTemplateRows = `repeat(${rows}, 1fr)`;
    for (let i = 0; i < rows; i++) {
      const s = document.createElement('span');
      s.textContent = rowLabel(i);
      rRowLabels.appendChild(s);
    }

    const rc = state.revealCell;
    cells.forEach(c => {
      const div = document.createElement('div');
      div.className = 'reveal-cell';
      div.style.background = G.cellHsl(c);
      if (rc) {
        const dc = Math.abs(c.col - rc.col), dr = Math.abs(c.row - rc.row);
        const d = Math.max(dc, dr);
        if (d === 0) {
          div.classList.add('secret-cell');
        } else if (d <= 1) {
          div.classList.add('score-3x3');
        } else if (d <= 2) {
          div.classList.add('score-5x5');
        }
      }
      const markers = state.markers || {};
      Object.entries(markers).forEach(([name, mks]) => {
        const player = state.players.find(p => p.name === name);
        if (!player) return;
        [1, 2].forEach(idx => {
          const m = mks[idx];
          if (!m || m.col !== c.col || m.row !== c.row) return;
          const dot = document.createElement('div');
          dot.className = 'reveal-marker' + (idx === 2 ? ' m2' : '');
          dot.style.background = player.color;
          dot.textContent = name.charAt(0).toUpperCase();
          div.appendChild(dot);
        });
      });
      board.appendChild(div);
    });
  }

  /* ---------- END ---------- */
  $('end-play-again-btn').addEventListener('click', () => {
    socket.emit('reset_game');
  });

  function renderEnd() {
    const me = state.players.find(p => p.name === myName);
    $('end-score').textContent = me ? me.score : 0;
    const idx = (state.finalScores || []).findIndex(p => p.name === myName);
    $('end-rank').textContent = idx >= 0 ? `Sua colocação: #${idx + 1}` : '';
  }

  /* ---------- MINI RANK ---------- */
  function renderMiniRank() {
    if (!state || !state.players || state.status !== 'playing') return;
    const row = $('mini-rank-row');
    const sorted = [...state.players].sort((a, b) => b.score - a.score);
    row.innerHTML = '';
    sorted.forEach((p, i) => {
      const el = document.createElement('div');
      el.className = 'mini-rank-item';
      if (p.name === myName) el.classList.add('me');
      if (p.name === state.activeName) el.classList.add('active');
      el.style.borderLeftColor = p.color;
      el.innerHTML = `
        <span class="rank-pos">#${i + 1}</span>
        <span class="rank-name">${escapeHtml(p.name)}</span>
        <span class="rank-score">${p.score}</span>
      `;
      row.appendChild(el);
    });
  }

  /* ---------- ROUTER ---------- */
  let prevPhase = null;
  let prevActive = null;
  let prevWasPending = false;
  let joinAttempted = false;

  function route() {
    if (!state) { showScreen('loading'); return; }
    if (!myName) { showScreen('login'); return; }
    if (!myRoom) { updateGreeting(); showScreen('home'); return; }

    const myPlayer = state.players.find(p => p.name === myName);

    if (state.status === 'lobby') {
      if (!myPlayer && !state.lobbyPlayers.includes(myName)) {
        if (!joinAttempted) {
          joinAttempted = true;
          socket.emit('join', { playerName: myName, room: myRoom });
        }
        return;
      }
      joinAttempted = false;
      showScreen('waiting');
      renderWaiting();
      return;
    }

    if (state.status === 'ended') {
      renderEnd();
      showScreen('end');
      return;
    }

    if (state.status !== 'playing') { showScreen('login'); return; }

    if (!myPlayer) {
      if (!joinAttempted) {
        joinAttempted = true;
        socket.emit('join', { playerName: myName, room: myRoom });
      }
      return;
    }

    const isActive = state.activeName === myName;
    const phase = state.phase;

    renderMiniRank();

    const turnChanged = prevActive !== state.activeName || prevPhase !== phase;
    const myPending = (state.pendingMarkers || []).includes(myName);
    const wasMyTurnToMark = prevWasPending;

    if (phase === 'clue1' || phase === 'clue2') {
      if (isActive) {
        showScreen('secret');
        renderSecret();
        if (turnChanged && (prevPhase !== phase || prevActive !== state.activeName)) {
          notifyMyTurn('clue');
        }
      } else {
        showScreen('wait-turn');
        renderWaitTurn();
      }
      prevPhase = phase; prevActive = state.activeName; prevWasPending = myPending;
      return;
    }

    if (phase === 'markers1' || phase === 'markers2') {
      if (isActive) {
        showScreen('wait-turn');
        renderWaitTurn();
      } else if (myPending) {
        showScreen('place-marker');
        renderPlaceMarker();
        if (!wasMyTurnToMark) notifyMyTurn('mark');
      } else {
        showScreen('wait-turn');
        renderWaitTurn();
        const remaining = (state.pendingMarkers || []).length;
        $('wt-hint').textContent = remaining > 0
          ? `Você já marcou. Aguardando ${remaining} jogador${remaining > 1 ? 'es' : ''}…`
          : 'Todos marcaram! Aguardando…';
      }
      prevPhase = phase; prevActive = state.activeName; prevWasPending = myPending;
      return;
    }

    if (phase === 'reveal') {
      renderReveal();
      showScreen('reveal');
      clearPendingPick();
      prevPhase = phase; prevActive = state.activeName; prevWasPending = myPending;
      return;
    }
  }

  /* ---------- SOCKET ---------- */
  socket.on('connect', () => {
    console.log('[CCD] connect myRoom=', myRoom, 'myName=', myName);
    if (myRoom) {
      const savedPw = sessionStorage.getItem('ccd:room-pw') || undefined;
      socket.emit('join_room', { code: myRoom, password: savedPw });
    } else if (!myName) {
      showScreen('login');
    } else {
      updateGreeting();
      showScreen('home');
    }
  });

  socket.on('room_joined', (d) => {
    console.log('[CCD] room_joined', d);
    myRoom = d.code;
    sessionStorage.setItem('ccd:room', myRoom);
    roomJoinBtn.disabled = false;
    roomStatus.textContent = '';
    if (myName) {
      joinAttempted = false;
      socket.emit('join', { playerName: myName, room: myRoom });
    }
  });

  socket.on('game_state', (s) => {
    console.log('[CCD] game_state status=', s.status, 'lobbyPlayers=', s.lobbyPlayers, 'myName=', myName);
    const prev = state;
    state = s;
    if (prev) {
      if (prev.activeName !== s.activeName || prev.phase !== s.phase) {
        clearPendingPick();
      }
    }
    const inActivePhase = ['clue1', 'markers1', 'clue2', 'markers2'].includes(s.phase);
    if (!inActivePhase || s.activeName !== myName) {
      if (s.activeName !== myName) mySecret = null;
    }
    route();
  });

  socket.on('your_secret', (s) => {
    mySecret = s;
    if (state && (state.phase === 'clue1' || state.phase === 'clue2')) {
      if (state.activeName === myName) renderSecret();
    }
    if (state && (state.phase === 'markers1' || state.phase === 'markers2') && state.activeName === myName) {
      renderWaitTurn();
    }
  });

  socket.on('join_accepted', (d) => {
    console.log('[CCD] join_accepted', d);
    myName = d.playerName;
    sessionStorage.setItem('ccd:name', myName);
    joinAttempted = false;
    loginStatus.textContent = '';
    joinBtn.disabled = false;
  });

  socket.on('join_rejected', (d) => {
    console.log('[CCD] join_rejected', d);
    const reason = d?.reason || 'Erro ao entrar.';
    if (d?.needsPassword) {
      $('password-field').classList.remove('hidden');
      roomStatus.textContent = reason;
      roomJoinBtn.disabled = false;
      sessionStorage.removeItem('ccd:room-pw');
      showScreen('join-room');
      return;
    }
    if (!myRoom || reason === 'Sala não encontrada.') {
      roomStatus.textContent = reason;
      roomJoinBtn.disabled = false;
      myRoom = null;
      sessionStorage.removeItem('ccd:room');
      sessionStorage.removeItem('ccd:room-pw');
      showScreen('home');
      return;
    }
    loginStatus.textContent = reason;
    joinBtn.disabled = false;
    myName = null;
    sessionStorage.removeItem('ccd:name');
    showScreen('login');
  });

  socket.on('kicked', () => {
    myName = null;
    sessionStorage.removeItem('ccd:name');
    loginStatus.textContent = 'Você foi removido da sala.';
    joinBtn.disabled = false;
    showScreen('login');
  });

  socket.on('room_expired', () => {
    alert('A sala expirou após 1 hora. Crie uma nova sala para continuar jogando.');
    leaveRoom();
  });

  socket.on('clue_rejected', (d) => {
    clueError.textContent = d?.reason || 'Dica inválida.';
    clueSend.disabled = false;
    clueSkip.disabled = false;
    vibrate(60);
  });

  socket.on('reveal', () => {
    vibrate(80);
  });

  socket.on('game_over', () => {
    vibrate([60, 60, 60]);
  });
})();
