(function () {
  const socket = io();
  const $ = (id) => document.getElementById(id);
  const G = window.GameColors;

  let state = null;
  let myName = sessionStorage.getItem('ccd:name') || null;
  let myRoom = sessionStorage.getItem('ccd:room') || null;
  let mySecret = null;
  let pendingPick = null;
  let joinAttempted = false;
  let board = null; // BoardView instance, created lazily once we enter the game

  /* read room from URL once */
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
    let s = '', n = i;
    while (true) { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1; if (n < 0) break; }
    return s;
  }
  function rowLabel(i) { return String(i + 1); }
  function coordOf(c) { return `${colLabel(c.col)}${rowLabel(c.row)}`; }

  /* ---------- SCREEN ROUTER ---------- */
  const PRE_GAME = ['loading', 'home', 'create-room', 'join-room', 'login', 'waiting'];
  const GAME_SCREENS = ['secret', 'wait-turn', 'place-marker', 'reveal'];

  function showScreen(name) {
    PRE_GAME.forEach(s => { const e = document.getElementById(s); if (e) e.classList.remove('active'); });
    GAME_SCREENS.forEach(s => { const e = document.getElementById(s); if (e) e.classList.remove('active'); });
    const endEl = document.getElementById('end');
    if (endEl) endEl.classList.remove('active');
    const layout = $('game-layout');
    layout.classList.add('hidden');

    if (PRE_GAME.includes(name)) {
      const el = document.getElementById(name);
      if (el) el.classList.add('active');
    } else if (GAME_SCREENS.includes(name)) {
      layout.classList.remove('hidden');
      const el = document.getElementById(name);
      if (el) el.classList.add('active');
    } else if (name === 'end') {
      endEl.classList.add('active');
    }

    const showRank = GAME_SCREENS.includes(name);
    document.body.classList.toggle('has-rank', showRank);
    $('mini-rank').classList.toggle('hidden', !showRank);
    const showExit = !['loading', 'home', 'create-room', 'join-room', 'login'].includes(name);
    $('exit-room-btn').classList.toggle('hidden', !showExit);

    if (name !== 'end') {
      endRendered = false;
      stopPlayerConfetti();
    }
  }

  function vibrate(ms) {
    if (navigator.vibrate) { try { navigator.vibrate(ms); } catch (e) {} }
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
    if (kind === 'clue') { chime([{ f: 660, d: 120 }, { f: 880, d: 180 }]); vibrate([80, 40, 120]); }
    else if (kind === 'mark') { chime([{ f: 520, d: 100 }, { f: 720, d: 120 }, { f: 980, d: 180 }]); vibrate([60, 30, 60, 30, 100]); }
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

  /* ---------- TIMER PRESETS ---------- */
  const TIMER_PRESETS = [
    { label: 'Sem timer', value: 0 },
    { label: '30s', value: 30 },
    { label: '60s', value: 60 },
    { label: '90s', value: 90 },
  ];

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

  /* ---------- CREATE / JOIN ROOM ---------- */
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
        if (myName) socket.emit('join', { playerName: myName, room: myRoom });
      }
    });
  });
  $('create-back-btn').addEventListener('click', () => showScreen('home'));

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
    updateGreeting();
    if (myRoom && state) {
      joinAttempted = false;
      socket.emit('join', { playerName: name, room: myRoom });
    } else {
      showScreen('home');
    }
  }

  /* ---------- WAITING (lobby) ---------- */
  $('edit-name-btn').addEventListener('click', () => {
    joinNameInput.value = myName || '';
    myName = null;
    loginStatus.textContent = '';
    joinBtn.disabled = false;
    showScreen('login');
  });

  /* ---------- TOAST ---------- */
  function showToast(text, ms) {
    const tEl = document.createElement('div');
    tEl.className = 'toast';
    tEl.textContent = text;
    $('toasts').appendChild(tEl);
    requestAnimationFrame(() => tEl.classList.add('show'));
    setTimeout(() => {
      tEl.classList.remove('show');
      setTimeout(() => tEl.remove(), 250);
    }, ms || 1800);
  }

  function copyToClipboard(text) {
    return new Promise((resolve, reject) => {
      if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(text).then(resolve).catch(() => fallback().then(resolve, reject));
      } else {
        fallback().then(resolve, reject);
      }
      function fallback() {
        return new Promise((res, rej) => {
          try {
            const ta = document.createElement('textarea');
            ta.value = text; ta.style.cssText = 'position:fixed;opacity:0';
            document.body.appendChild(ta); ta.select();
            const ok = document.execCommand('copy');
            ta.remove();
            ok ? res() : rej(new Error('copy failed'));
          } catch (e) { rej(e); }
        });
      }
    });
  }

  /* ---------- SHARE ---------- */
  function roomShareUrl() {
    return `${window.location.origin}/player?room=${encodeURIComponent(myRoom || '')}`;
  }
  function shareRoom() {
    if (!myRoom) return;
    const url = roomShareUrl();
    const shareData = {
      title: 'Cores com Dicas',
      text: `Vem jogar Cores com Dicas comigo! Sala ${myRoom}`,
      url,
    };
    if (navigator.share && navigator.canShare?.(shareData) !== false) {
      navigator.share(shareData).catch(err => {
        if (err && err.name === 'AbortError') return;
        copyToClipboard(url).then(() => showToast('Link copiado!')).catch(() => {});
      });
    } else {
      copyToClipboard(url).then(() => showToast('Link copiado!')).catch(() => showToast('Falha ao copiar.'));
    }
  }
  $('lobby-share-btn').addEventListener('click', shareRoom);

  /* ---------- QR TOGGLE ---------- */
  let lobbyQrLoaded = false;
  $('lobby-qr-toggle').addEventListener('click', () => {
    const wrap = $('lobby-qr-wrap');
    const toggle = $('lobby-qr-toggle');
    const expanded = toggle.getAttribute('aria-expanded') === 'true';
    if (expanded) {
      wrap.classList.add('hidden');
      toggle.setAttribute('aria-expanded', 'false');
      toggle.querySelector('.qr-toggle-text').textContent = 'Mostrar QR Code';
    } else {
      wrap.classList.remove('hidden');
      toggle.setAttribute('aria-expanded', 'true');
      toggle.querySelector('.qr-toggle-text').textContent = 'Esconder QR Code';
      if (!lobbyQrLoaded && myRoom) loadLobbyQr();
    }
  });
  function loadLobbyQr() {
    if (!myRoom) return;
    fetch(`/qr?room=${encodeURIComponent(myRoom)}`)
      .then(r => r.json())
      .then(d => {
        if (d.qr) $('lobby-qr-img').src = d.qr;
        if (d.url) $('lobby-qr-url').textContent = d.url;
        lobbyQrLoaded = true;
      })
      .catch(() => {});
  }

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
    mySecret = null;
    pendingPick = null;
    if (board) { board = null; $('game-board-host').innerHTML = ''; }
    sessionStorage.removeItem('ccd:room');
    sessionStorage.removeItem('ccd:room-pw');
    updateGreeting();
    showScreen('home');
  }
  $('lobby-leave-btn').addEventListener('click', leaveRoom);
  $('exit-room-btn').addEventListener('click', () => { if (confirm('Sair da sala?')) leaveRoom(); });

  socket.on('start_rejected', (d) => { $('lobby-help').textContent = d?.reason || 'Não foi possível iniciar.'; });

  let lobbyRoomShown = null;
  function renderWaiting() {
    $('waiting-name').textContent = myName || '';
    $('lobby-room-code').textContent = myRoom || '—';

    // reset QR if room changed
    if (lobbyRoomShown !== myRoom) {
      lobbyRoomShown = myRoom;
      lobbyQrLoaded = false;
      $('lobby-qr-img').removeAttribute('src');
      $('lobby-qr-url').textContent = '';
      $('lobby-qr-wrap').classList.add('hidden');
      const toggle = $('lobby-qr-toggle');
      toggle.setAttribute('aria-expanded', 'false');
      toggle.querySelector('.qr-toggle-text').textContent = 'Mostrar QR Code';
    }

    const listEl = $('lobby-player-list');
    listEl.innerHTML = '';
    const conn = state?.lobbyConnected || {};
    const names = state?.lobbyPlayers || [];
    names.forEach(name => {
      const isConnected = !!conn[name];
      const isMe = name === myName;
      const initial = (name.charAt(0) || '?').toUpperCase();
      const div = document.createElement('div');
      div.className = 'lobby-player-item' + (isMe ? ' me' : '') + (isConnected ? '' : ' disconnected');
      div.innerHTML = `
        <span class="player-avatar">${escapeHtml(initial)}</span>
        <span class="player-name">${escapeHtml(name)}</span>
        ${isMe ? '<span class="you-pill">você</span>' : ''}
        <span class="conn-dot ${isConnected ? 'on' : ''}" title="${isConnected ? 'Conectado' : 'Desconectado'}"></span>
      `;
      listEl.appendChild(div);
    });

    $('lobby-players-count').textContent = `${names.length}/10`;
    renderTimerOptions();

    const enough = names.length >= 2 && names.length <= 10;
    $('lobby-start-btn').disabled = !enough;
    const help = $('lobby-help');
    if (names.length < 2) help.textContent = `Faltam ${2 - names.length} jogador(es).`;
    else help.textContent = 'Pronto para iniciar!';
  }

  function renderTimerOptions() {
    const host = $('lobby-timer-options');
    if (!host) return;
    const current = state?.timerSeconds ?? 60;
    host.innerHTML = '';
    TIMER_PRESETS.forEach((p) => {
      const btn = document.createElement('button');
      btn.className = 'grid-size-btn' + (p.value === current ? ' active' : '');
      btn.textContent = p.label;
      btn.addEventListener('click', () => {
        socket.emit('update_room_settings', { timerSeconds: p.value });
      });
      host.appendChild(btn);
    });
  }

  /* ---------- BOARD VIEW (one instance, persistent across game screens) ---------- */
  function ensureBoard() {
    if (board) return board;
    if (!state) return null;
    const host = $('game-board-host');
    host.innerHTML = '';
    board = window.createBoardView(host, {
      cols: state.boardCols,
      rows: state.boardRows,
      players: state.players,
      mode: 'view',
      zoomable: true,
      showLabels: true,
    });
    board.on('cellTap', onBoardCellTap);
    return board;
  }

  function applyBoardForState() {
    if (!state) return;
    const b = ensureBoard();
    if (!b) return;

    const isActive = state.activeName === myName;
    const phase = state.phase;
    const inMarkers = phase === 'markers1' || phase === 'markers2';
    const myPending = (state.pendingMarkers || []).includes(myName);

    let secretCell = null;
    let secretObscured = false;
    let scoreZones = false;
    let showDistanceBadges = false;
    let mode = 'view';

    if (isActive && mySecret) {
      secretCell = { col: mySecret.col, row: mySecret.row };
      if (phase === 'clue1' || phase === 'clue2' || inMarkers) {
        secretObscured = true;
      }
      // distance badges: when there are placed markers and giver might want to calibrate
      if (phase === 'clue2' || inMarkers) {
        showDistanceBadges = true;
      }
    }

    if (phase === 'reveal' && state.revealCell) {
      secretCell = { col: state.revealCell.col, row: state.revealCell.row };
      secretObscured = false;
      scoreZones = true;
    }

    if (inMarkers && myPending) {
      mode = 'mark';
    }

    const me = state.players.find(p => p.name === myName);
    const selfColor = me?.color || '#ffffff';

    b.update({
      cols: state.boardCols,
      rows: state.boardRows,
      players: state.players,
      markers: state.markers || {},
      secretCell,
      secretObscured,
      scoreZones,
      showDistanceBadges,
      pendingPick,
      selfColor,
      mode,
    });
  }

  function onBoardCellTap(col, row) {
    if (!state) return;
    if (state.phase !== 'markers1' && state.phase !== 'markers2') return;
    if (!(state.pendingMarkers || []).includes(myName)) return;

    if (pendingPick && pendingPick.col === col && pendingPick.row === row) {
      const markerIndex = state.phase === 'markers1' ? 1 : 2;
      socket.emit('place_marker', { playerName: myName, col, row, markerIndex });
      vibrate(40);
      beep(720, 90, 'sine', 0.06);
      pendingPick = null;
      updatePendingUI();
      applyBoardForState();
      return;
    }

    pendingPick = { col, row };
    updatePendingUI();
    applyBoardForState();
    beep(440, 50, 'sine', 0.04);
    vibrate(15);
  }

  function updatePendingUI() {
    const pm = $('pm-selected');
    if (pendingPick) {
      pm.classList.add('has-pick');
      pm.textContent = `Selecionado: ${coordOf(pendingPick)} — toque novamente para confirmar`;
      $('pm-confirm').disabled = false;
    } else {
      pm.classList.remove('has-pick');
      pm.textContent = 'Selecione uma cor…';
      $('pm-confirm').disabled = true;
    }
  }

  $('pm-confirm').addEventListener('click', () => {
    if (!pendingPick || !state) return;
    if (state.phase !== 'markers1' && state.phase !== 'markers2') return;
    if (!(state.pendingMarkers || []).includes(myName)) return;
    const markerIndex = state.phase === 'markers1' ? 1 : 2;
    socket.emit('place_marker', { playerName: myName, col: pendingPick.col, row: pendingPick.row, markerIndex });
    vibrate(40);
    beep(720, 90, 'sine', 0.06);
    pendingPick = null;
    updatePendingUI();
    applyBoardForState();
  });

  /* ---------- VIEW-COLOR OVERLAY (press-and-hold) ---------- */
  const viewColorBtn = $('view-color-btn');
  const colorRevealOverlay = $('color-reveal-overlay');
  const colorRevealId = $('color-reveal-id');

  function startColorReveal(e) {
    if (!mySecret) return;
    colorRevealOverlay.style.background = mySecret.hsl;
    colorRevealId.textContent = coordOf(mySecret);
    colorRevealOverlay.classList.remove('hidden');
    if (e && e.cancelable) e.preventDefault();
  }
  function endColorReveal() {
    colorRevealOverlay.classList.add('hidden');
  }
  viewColorBtn.addEventListener('pointerdown', startColorReveal);
  viewColorBtn.addEventListener('pointerup', endColorReveal);
  viewColorBtn.addEventListener('pointercancel', endColorReveal);
  viewColorBtn.addEventListener('pointerleave', endColorReveal);
  viewColorBtn.addEventListener('contextmenu', (e) => e.preventDefault());

  /* ---------- SECRET (clue giver) ---------- */
  const clueLabel = $('clue-label');
  const clueInput = $('clue-input');
  const clueSend = $('clue-send');
  const clueSkip = $('clue-skip');
  const clueError = $('clue-error');

  function renderSecret() {
    if (!mySecret) return;
    $('secret-coords').textContent = coordOf(mySecret);
    const round = state.phase === 'clue1' ? 1 : 2;
    clueLabel.textContent = round === 1 ? 'Dê a 1ª dica (1 palavra):' : 'Dê a 2ª dica (até 2 palavras):';
    clueInput.placeholder = round === 1 ? 'ex: oceano' : 'ex: oceano profundo';
    clueInput.value = '';
    clueError.textContent = '';
    clueSend.disabled = false;
    clueSkip.disabled = false;

    const hint = $('secret-partial-hint');
    if (state.phase === 'clue2') {
      hint.classList.remove('hidden');
      $('secret-partial').textContent = '+' + computeActivePartialScore();
    } else {
      hint.classList.add('hidden');
    }
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
    if (round === 1 && words.length !== 1) { clueError.textContent = 'Use exatamente 1 palavra.'; return; }
    if (round === 2 && (words.length < 1 || words.length > 2)) { clueError.textContent = 'Use até 2 palavras.'; return; }
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

  function computeActivePartialScore() {
    if (!mySecret || !state) return 0;
    const cols = state.boardCols;
    let pts = 0;
    Object.entries(state.markers || {}).forEach(([name, mks]) => {
      if (name === myName) return;
      [1, 2].forEach(idx => {
        const m = mks[idx];
        if (!m) return;
        if (G.chebyshevWrap(m, mySecret, cols) <= 1) pts += 1;
      });
    });
    return Math.min(9, pts);
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
    if (value) { el.textContent = value; el.classList.remove('skipped'); }
    else if (afterFlag) { el.textContent = '(pulou)'; el.classList.add('skipped'); }
    else { el.textContent = '—'; el.classList.remove('skipped'); }
  }

  /* ---------- PLACE MARKER content ---------- */
  function renderPlaceMarker() {
    setClueLine($('pm-clue-1'), state.clue1, ['markers1', 'clue2', 'markers2', 'reveal', 'end'].includes(state.phase));
    setClueLine($('pm-clue-2'), state.clue2, ['markers2', 'reveal', 'end'].includes(state.phase));
    $('pm-hint').textContent = state.phase === 'markers1'
      ? 'Toque uma cor no tabuleiro acima para selecionar, toque de novo para confirmar.'
      : 'Toque para adicionar o segundo marcador, toque de novo para confirmar.';
    updatePendingUI();
  }

  /* ---------- REVEAL content ---------- */
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
    const isActive = state.activeName === myName;
    const waitMsg = $('reveal-wait-msg');
    if (isActive) {
      nextRoundBtn.classList.remove('hidden');
      nextRoundBtn.textContent = isLast ? 'Ver Placar Final' : 'Próxima Rodada';
      nextRoundBtn.disabled = false;
      waitMsg.classList.add('hidden');
    } else {
      nextRoundBtn.classList.add('hidden');
      waitMsg.classList.remove('hidden');
      waitMsg.textContent = isLast
        ? `Aguardando ${state.activeName} ver o placar final…`
        : `Aguardando ${state.activeName} passar a vez…`;
    }
  }

  /* ---------- END ---------- */
  $('end-play-again-btn').addEventListener('click', () => socket.emit('reset_game'));

  let endRendered = false;
  let confettiAnim = null;

  function renderEnd() {
    if (endRendered) return;
    endRendered = true;
    const finals = state.finalScores || state.players.map(p => ({ name: p.name, color: p.color, score: p.score }));
    const sorted = [...finals].sort((a, b) => b.score - a.score);
    const list = $('end-list');
    list.innerHTML = '';
    const myIdx = sorted.findIndex(p => p.name === myName);

    const winner = sorted[0];
    const banner = $('end-winner-banner');
    if (winner) {
      $('end-winner-name').textContent = winner.name === myName ? 'Você venceu!' : `${winner.name} venceu!`;
      banner.classList.remove('hidden');
    } else {
      banner.classList.add('hidden');
    }

    sorted.forEach((p, i) => {
      const li = document.createElement('li');
      li.style.borderLeftColor = p.color;
      li.style.animationDelay = (0.4 + i * 0.18) + 's';
      if (p.name === myName) li.classList.add('me');
      if (i === 0) li.classList.add('first');
      const posCls = i === 0 ? 'gold' : i === 1 ? 'silver' : i === 2 ? 'bronze' : '';
      li.innerHTML = `
        <span class="rank-pos ${posCls}">#${i + 1}</span>
        <span class="rank-name">${escapeHtml(p.name)}${p.name === myName ? '<span class="you-tag">você</span>' : ''}</span>
        <span class="rank-score">${p.score}</span>
      `;
      list.appendChild(li);
    });

    $('end-rank').textContent = myIdx >= 0
      ? (myIdx === 0 ? '🎉 Você é o(a) campeão(ã)!' : `Sua colocação: #${myIdx + 1}`)
      : '';

    startPlayerConfetti(winner && winner.name === myName);
  }

  function startPlayerConfetti(extra) {
    const cnv = $('player-confetti');
    if (!cnv) return;
    const ctx = cnv.getContext('2d');
    function resize() { cnv.width = cnv.clientWidth; cnv.height = cnv.clientHeight; }
    resize();
    window.addEventListener('resize', resize);
    const colors = ['#ff5e5e', '#ffb84a', '#62d36b', '#5cb8ff', '#b478ff', '#ffd54a', '#f2a6b5', '#a8d8a8'];
    const count = extra ? 160 : 90;
    const parts = [];
    for (let i = 0; i < count; i++) {
      parts.push({
        x: Math.random() * cnv.width,
        y: -Math.random() * cnv.height,
        vy: 2 + Math.random() * 3.5,
        vx: (Math.random() - 0.5) * 2,
        size: 5 + Math.random() * 6,
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
  function stopPlayerConfetti() {
    if (confettiAnim) cancelAnimationFrame(confettiAnim);
    confettiAnim = null;
    const cnv = $('player-confetti');
    if (!cnv) return;
    const ctx = cnv.getContext('2d');
    ctx.clearRect(0, 0, cnv.width, cnv.height);
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
    $('mini-round-cur').textContent = state.currentRound;
    $('mini-round-tot').textContent = state.rounds;
    $('mini-turn-cur').textContent = Math.min(state.turnsTaken + 1, state.totalTurns);
    $('mini-turn-tot').textContent = state.totalTurns;
  }

  /* ---------- TIMER (ring around the current action target + observer chip) ---------- */
  const rings = {}; // map screen -> ring instance lazily created
  let activeRingScope = null;
  let timerChipRaf = null;

  function getRing(scope) {
    if (rings[scope]) return rings[scope];
    let target = null;
    if (scope === 'secret') target = $('clue-send');
    else if (scope === 'wait-turn') target = $('wt-partial');
    else if (scope === 'place-marker') target = $('pm-confirm');
    else if (scope === 'reveal') target = $('next-round-btn');
    if (!target || !window.createTimerRing) return null;
    rings[scope] = window.createTimerRing(target);
    return rings[scope];
  }

  function stopAllRings(except) {
    Object.entries(rings).forEach(([scope, r]) => {
      if (scope !== except) r.stop();
    });
  }

  function pickRingScope() {
    if (!state || state.status !== 'playing') return null;
    if (!state.phaseDeadline) return null;
    const isActive = state.activeName === myName;
    const phase = state.phase;
    if ((phase === 'clue1' || phase === 'clue2') && isActive) return 'secret';
    if ((phase === 'markers1' || phase === 'markers2')) {
      if (isActive) return 'wait-turn';
      if ((state.pendingMarkers || []).includes(myName)) return 'place-marker';
    }
    if (phase === 'reveal' && isActive) return 'reveal';
    return null;
  }

  function applyTimer() {
    const chip = $('mini-timer-chip');
    const value = $('mini-timer-value');
    const extendBtn = $('extend-timer-btn');

    if (!state || state.status !== 'playing' || !state.phaseDeadline) {
      chip.classList.add('hidden');
      extendBtn.classList.add('hidden');
      stopAllRings();
      activeRingScope = null;
      if (timerChipRaf) cancelAnimationFrame(timerChipRaf);
      return;
    }

    // Observer chip: anyone sees the seconds left
    chip.classList.remove('hidden');
    function tickChip() {
      const remaining = state.phaseDeadline - Date.now();
      const secLeft = Math.max(0, Math.ceil(remaining / 1000));
      const ratio = remaining / (state.timerSeconds * 1000);
      value.textContent = `${secLeft}s`;
      chip.classList.toggle('warn', ratio < 0.5 && ratio >= 0.2);
      chip.classList.toggle('danger', ratio < 0.2);
      if (remaining > 0) timerChipRaf = requestAnimationFrame(tickChip);
    }
    if (timerChipRaf) cancelAnimationFrame(timerChipRaf);
    tickChip();

    // Extend button: visible while a timer is active and not yet used this turn
    if (state.turnExtended) {
      extendBtn.classList.add('hidden');
    } else {
      extendBtn.classList.remove('hidden');
      extendBtn.disabled = false;
    }

    // Ring around the target element for whoever needs to act
    const scope = pickRingScope();
    if (scope !== activeRingScope) stopAllRings(scope);
    activeRingScope = scope;
    if (scope) {
      const ring = getRing(scope);
      if (ring) {
        ring.start(state.phaseDeadline, state.timerSeconds, {});
      }
    }
  }

  $('extend-timer-btn').addEventListener('click', () => {
    socket.emit('extend_timer');
    $('extend-timer-btn').disabled = true;
    vibrate(20);
  });

  /* ---------- ROUTER ---------- */
  let prevPhase = null;
  let prevActive = null;
  let prevWasPending = false;

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
      showScreen('end');
      renderEnd();
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
    applyBoardForState();
    applyTimer();

    const myPending = (state.pendingMarkers || []).includes(myName);
    const turnChanged = prevActive !== state.activeName || prevPhase !== phase;

    if (phase === 'clue1' || phase === 'clue2') {
      if (isActive) {
        showScreen('secret');
        renderSecret();
        if (turnChanged) notifyMyTurn('clue');
      } else {
        showScreen('wait-turn');
        renderWaitTurn();
      }
    } else if (phase === 'markers1' || phase === 'markers2') {
      if (isActive) {
        showScreen('wait-turn');
        renderWaitTurn();
      } else if (myPending) {
        showScreen('place-marker');
        renderPlaceMarker();
        if (!prevWasPending) notifyMyTurn('mark');
      } else {
        showScreen('wait-turn');
        renderWaitTurn();
        const remaining = (state.pendingMarkers || []).length;
        $('wt-hint').textContent = remaining > 0
          ? `Você já marcou. Aguardando ${remaining} jogador${remaining > 1 ? 'es' : ''}…`
          : 'Todos marcaram! Aguardando…';
      }
    } else if (phase === 'reveal') {
      showScreen('reveal');
      renderReveal();
    }

    prevPhase = phase;
    prevActive = state.activeName;
    prevWasPending = myPending;
  }

  /* ---------- SOCKET ---------- */
  socket.on('connect', () => {
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
    const prev = state;
    state = s;
    if (prev) {
      if (prev.activeName !== s.activeName || prev.phase !== s.phase) {
        pendingPick = null;
        updatePendingUI();
      }
      if (prev.boardCols !== s.boardCols || prev.boardRows !== s.boardRows) {
        if (board) { board = null; $('game-board-host').innerHTML = ''; }
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
    if (state && state.activeName === myName) {
      const phase = state.phase;
      if (phase === 'clue1' || phase === 'clue2') renderSecret();
      else if (phase === 'markers1' || phase === 'markers2') renderWaitTurn();
      applyBoardForState();
    }
  });

  socket.on('join_accepted', (d) => {
    myName = d.playerName;
    sessionStorage.setItem('ccd:name', myName);
    joinAttempted = false;
    loginStatus.textContent = '';
    joinBtn.disabled = false;
  });

  socket.on('join_rejected', (d) => {
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

  socket.on('reveal', () => { vibrate(80); });
  socket.on('game_over', () => { vibrate([60, 60, 60]); });
})();
