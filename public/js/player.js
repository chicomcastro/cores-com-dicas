(function () {
  const socket = io();
  const $ = (id) => document.getElementById(id);

  let state = null;
  let myName = sessionStorage.getItem('ccd:name') || null;
  let mySecret = null;

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function showScreen(name) {
    ['loading', 'login', 'waiting', 'secret', 'wait-turn', 'place-tablet', 'reveal', 'end'].forEach(s => {
      const el = document.getElementById(s);
      if (s === name) el.classList.add('active'); else el.classList.remove('active');
    });
  }

  function vibrate(ms) {
    if (navigator.vibrate) navigator.vibrate(ms);
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
    socket.emit('join', { playerName: name });
    loginStatus.textContent = 'Entrando…';
    joinBtn.disabled = true;
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

  function renderWaiting() {
    $('waiting-name').textContent = myName || '';
    const dots = $('connected-dots');
    dots.innerHTML = '';
    const conn = state?.lobbyConnected || {};
    (state?.lobbyPlayers || []).forEach(name => {
      const player = state.players.find(p => p.name === name);
      const isConnected = player ? player.connected : !!conn[name];
      const d = document.createElement('div');
      d.className = 'dot' + (isConnected ? ' on' : '');
      d.title = name;
      dots.appendChild(d);
    });
  }

  /* ---------- SECRET ---------- */
  const secretColor = $('secret-color');
  const secretIdEl = $('secret-id');
  const clueLabel = $('clue-label');
  const clueInput = $('clue-input');
  const clueSend = $('clue-send');
  const clueError = $('clue-error');

  function renderSecret() {
    if (!mySecret) return;
    secretColor.style.background = mySecret.hsl;
    secretIdEl.textContent = mySecret.id;
    const round = state.phase === 'clue1' ? 1 : 2;
    clueLabel.textContent = round === 1
      ? 'Dê a 1ª dica (1 palavra):'
      : 'Dê a 2ª dica (até 2 palavras):';
    clueInput.placeholder = round === 1 ? 'ex: oceano' : 'ex: oceano profundo';
    clueInput.value = '';
    clueError.textContent = '';
    clueSend.disabled = false;
  }

  clueSend.addEventListener('click', sendClue);
  clueInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendClue(); });

  function sendClue() {
    const v = clueInput.value.trim();
    if (!v) { clueError.textContent = 'Digite uma dica.'; return; }
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
    socket.emit('submit_clue', { clue: v, round });
    vibrate(20);
  }

  /* ---------- WAIT TURN ---------- */
  function renderWaitTurn() {
    $('wt-active').textContent = state.activeName || '—';
    $('wt-clue-1').textContent = state.clue1 || '—';
    $('wt-clue-2').textContent = state.clue2 || '—';
    const hint = $('wt-hint');
    if (state.phase === 'clue1') hint.textContent = 'Esperando a primeira dica…';
    else if (state.phase === 'clue2') hint.textContent = 'Esperando a segunda dica…';
    else hint.textContent = '';
  }

  /* ---------- REVEAL ---------- */
  function renderReveal() {
    const me = state.players.find(p => p.name === myName);
    const delta = state.roundScores ? (state.roundScores[myName] || 0) : 0;
    $('score-big').textContent = (delta >= 0 ? '+' : '') + delta;
    $('total-score').textContent = me ? me.score : 0;
    if (state.turnsTaken + 1 >= state.totalTurns) {
      $('reveal-hint').textContent = 'Quase lá! Aguarde o placar final…';
    } else {
      $('reveal-hint').textContent = 'Aguarde a próxima rodada…';
    }
  }

  /* ---------- END ---------- */
  function renderEnd() {
    const me = state.players.find(p => p.name === myName);
    $('end-score').textContent = me ? me.score : 0;
    const idx = (state.finalScores || []).findIndex(p => p.name === myName);
    $('end-rank').textContent = idx >= 0 ? `Sua colocação: #${idx + 1}` : '';
  }

  /* ---------- ROUTER ---------- */
  function route() {
    if (!state) { showScreen('loading'); return; }

    if (!myName) { showScreen('login'); return; }

    const myPlayer = state.players.find(p => p.name === myName);

    if (state.status === 'lobby') {
      if (!myPlayer && !state.lobbyPlayers.includes(myName)) {
        myName = null;
        sessionStorage.removeItem('ccd:name');
        showScreen('login');
        return;
      }
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
      showScreen('login');
      return;
    }

    const isActive = state.activeName === myName;
    const phase = state.phase;

    if (phase === 'clue1' || phase === 'clue2') {
      if (isActive) {
        showScreen('secret');
        renderSecret();
      } else {
        showScreen('wait-turn');
        renderWaitTurn();
      }
      return;
    }

    if (phase === 'markers1' || phase === 'markers2') {
      if (isActive) {
        showScreen('wait-turn');
        renderWaitTurn();
        $('wt-hint').textContent = 'Os outros jogadores estão marcando…';
      } else {
        const pending = state.pendingMarkers || [];
        if (pending[0] === myName) {
          showScreen('place-tablet');
          $('place-hint').textContent = phase === 'markers1'
            ? 'Toque na cor que você acha que é a secreta.'
            : 'Mova seu marcador ou adicione um segundo.';
          vibrate(40);
        } else if (pending.includes(myName)) {
          showScreen('wait-turn');
          renderWaitTurn();
          $('wt-hint').textContent = `Aguarde sua vez (${pending.indexOf(myName) + 1}º da fila).`;
        } else {
          showScreen('wait-turn');
          renderWaitTurn();
          $('wt-hint').textContent = 'Você já marcou. Esperando os outros…';
        }
      }
      return;
    }

    if (phase === 'reveal') {
      renderReveal();
      showScreen('reveal');
      return;
    }
  }

  /* ---------- SOCKET ---------- */
  socket.on('connect', () => {
    if (myName) socket.emit('join', { playerName: myName });
  });

  socket.on('game_state', (s) => {
    state = s;
    route();
  });

  socket.on('your_secret', (s) => {
    mySecret = s;
    if (state && (state.phase === 'clue1' || state.phase === 'clue2')) {
      if (state.activeName === myName) renderSecret();
    }
  });

  socket.on('join_accepted', (d) => {
    myName = d.playerName;
    sessionStorage.setItem('ccd:name', myName);
    loginStatus.textContent = '';
    joinBtn.disabled = false;
  });

  socket.on('join_rejected', (d) => {
    loginStatus.textContent = d?.reason || 'Erro ao entrar.';
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

  socket.on('clue_rejected', (d) => {
    clueError.textContent = d?.reason || 'Dica inválida.';
    clueSend.disabled = false;
    vibrate(60);
  });

  socket.on('reveal', () => {
    vibrate(80);
  });

  socket.on('game_over', () => {
    vibrate([60, 60, 60]);
  });
})();
