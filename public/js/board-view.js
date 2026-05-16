(function (root) {
  function colLabel(i) {
    let s = '', n = i;
    while (true) { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1; if (n < 0) break; }
    return s;
  }
  function rowLabel(i) { return String(i + 1); }
  function hexToRgba(hex, a) {
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || '');
    if (!m) return `rgba(255,255,255,${a})`;
    return `rgba(${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)},${a})`;
  }

  function createBoardView(host, opts) {
    const G = root.GameColors;
    if (!host) throw new Error('boardView: host required');
    if (!G) throw new Error('boardView: GameColors not loaded');

    const state = {
      cols: opts.cols || 30,
      rows: opts.rows || 18,
      markers: {},
      players: opts.players || [],
      secretCell: null,
      secretObscured: false,
      scoreZones: false,
      showDistanceBadges: false,
      pendingPick: null,
      selfColor: '#ffffff',
      mode: opts.mode || 'view',
    };
    const showLabels = opts.showLabels !== false;
    const zoomable = opts.zoomable !== false;
    const listeners = { cellTap: [] };

    let cellEls = [];
    let zoom = 1, panX = 0, panY = 0;

    host.classList.add('bv-root');
    if (!showLabels) host.classList.add('bv-no-labels');
    host.innerHTML = `
      <div class="bv-viewport">
        <div class="bv-pan">
          <div class="bv-layout">
            <div class="bv-corner"></div>
            <div class="bv-col-labels"></div>
            <div class="bv-row-labels"></div>
            <div class="bv-grid"></div>
          </div>
        </div>
      </div>
    `;
    const viewportEl = host.querySelector('.bv-viewport');
    const panEl = host.querySelector('.bv-pan');
    const colLabelsEl = host.querySelector('.bv-col-labels');
    const rowLabelsEl = host.querySelector('.bv-row-labels');
    const gridEl = host.querySelector('.bv-grid');

    function buildGrid() {
      const { cols, rows } = state;
      const cells = G.generateBoard(cols, rows);
      gridEl.innerHTML = '';
      gridEl.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
      gridEl.style.gridTemplateRows = `repeat(${rows}, 1fr)`;
      cellEls = cells.map(c => {
        const d = document.createElement('div');
        d.className = 'bv-cell';
        d.style.background = G.cellHsl(c);
        d.dataset.col = c.col; d.dataset.row = c.row;
        d.addEventListener('click', () => onCellClick(c));
        gridEl.appendChild(d);
        return d;
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

    function cellEl(col, row) { return cellEls[row * state.cols + col]; }

    function onCellClick(c) {
      if (state.mode !== 'mark') return;
      listeners.cellTap.forEach(fn => fn(c.col, c.row));
    }

    function clearOverlays() {
      cellEls.forEach(el => {
        el.classList.remove('bv-secret', 'bv-obscured', 'bv-score-3x3', 'bv-score-5x5', 'bv-pending', 'bv-revealed');
        el.style.removeProperty('--bv-self-color');
        el.style.removeProperty('--bv-self-glow');
        el.querySelectorAll('.bv-marker, .bv-dist-badge').forEach(n => n.remove());
      });
    }

    function paintScoreZones() {
      if (!state.scoreZones || !state.secretCell) return;
      const { col: sc, row: sr } = state.secretCell;
      const cols = state.cols;
      cellEls.forEach(e => e.classList.add('bv-revealed'));
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const c = ((sc + dc) % cols + cols) % cols;
          const r = sr + dr;
          const e = cellEl(c, r);
          if (!e) continue;
          const d = Math.max(Math.abs(dc), Math.abs(dr));
          if (d === 0) continue;
          if (d <= 1) e.classList.add('bv-score-3x3');
          else e.classList.add('bv-score-5x5');
        }
      }
    }

    function paintMarkers() {
      const { markers, players, secretCell, showDistanceBadges } = state;
      const cols = state.cols;
      Object.entries(markers || {}).forEach(([name, mks]) => {
        const player = players.find(p => p.name === name);
        if (!player) return;
        [1, 2].forEach(idx => {
          const m = mks[idx];
          if (!m) return;
          const el = cellEl(m.col, m.row);
          if (!el) return;
          const dot = document.createElement('div');
          dot.className = 'bv-marker' + (idx === 2 ? ' bv-m2' : '');
          dot.style.background = player.color;
          dot.textContent = name.charAt(0).toUpperCase();
          el.appendChild(dot);
          if (showDistanceBadges && secretCell) {
            const d = G.chebyshevWrap({ col: m.col, row: m.row }, secretCell, cols);
            const badge = document.createElement('div');
            const cls = d === 0 ? 'd0' : d === 1 ? 'd1' : d === 2 ? 'd2' : 'd3';
            badge.className = `bv-dist-badge ${cls}`;
            badge.textContent = d;
            el.appendChild(badge);
          }
        });
      });
    }

    function paintSecret() {
      if (!state.secretCell) return;
      const el = cellEl(state.secretCell.col, state.secretCell.row);
      if (!el) return;
      el.classList.add('bv-secret');
      if (state.secretObscured) el.classList.add('bv-obscured');
    }

    function paintPending() {
      if (!state.pendingPick) return;
      const el = cellEl(state.pendingPick.col, state.pendingPick.row);
      if (!el) return;
      const color = state.selfColor || '#ffffff';
      el.style.setProperty('--bv-self-color', color);
      el.style.setProperty('--bv-self-glow', hexToRgba(color, 0.55));
      el.classList.add('bv-pending');
    }

    function render() {
      clearOverlays();
      paintScoreZones();
      paintMarkers();
      paintSecret();
      paintPending();
    }

    function update(patch) {
      const needsRebuild =
        (patch.cols != null && patch.cols !== state.cols) ||
        (patch.rows != null && patch.rows !== state.rows);
      Object.assign(state, patch);
      if (needsRebuild) buildGrid();
      render();
    }

    /* ---------- pan / zoom ---------- */
    function applyTransform() {
      panEl.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
    }
    function clampPan() {
      const r = viewportEl.getBoundingClientRect();
      const ext = (zoom - 1) / 2;
      panX = Math.max(-r.width * ext, Math.min(r.width * ext, panX));
      panY = Math.max(-r.height * ext, Math.min(r.height * ext, panY));
    }
    function setZoom(z, cx, cy) {
      const newZ = Math.max(1, Math.min(5, z));
      if (cx == null) { zoom = newZ; clampPan(); applyTransform(); return; }
      const r = viewportEl.getBoundingClientRect();
      const mx = cx - r.left, my = cy - r.top;
      const ratio = newZ / zoom;
      panX = mx - (mx - panX) * ratio;
      panY = my - (my - panY) * ratio;
      zoom = newZ;
      clampPan(); applyTransform();
    }
    function resetZoom() { zoom = 1; panX = 0; panY = 0; applyTransform(); }

    if (zoomable) {
      const pointers = new Map();
      let pinchStart = null, panStart = null, movedSinceDown = false, lastTap = 0;
      viewportEl.addEventListener('pointerdown', (e) => {
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        movedSinceDown = false;
        if (pointers.size === 2) {
          const [a, b] = [...pointers.values()];
          pinchStart = { dist: Math.hypot(a.x - b.x, a.y - b.y), zoom };
        } else if (pointers.size === 1 && zoom > 1) {
          panStart = { x: e.clientX, y: e.clientY, panX, panY };
        }
        const now = Date.now();
        if (now - lastTap < 300 && pointers.size === 1) {
          resetZoom();
        }
        lastTap = now;
      });
      viewportEl.addEventListener('pointermove', (e) => {
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
          clampPan(); applyTransform();
        }
      });
      function endPtr(e) {
        pointers.delete(e.pointerId);
        if (pointers.size < 2) pinchStart = null;
        if (pointers.size === 0) panStart = null;
      }
      viewportEl.addEventListener('pointerup', endPtr);
      viewportEl.addEventListener('pointercancel', endPtr);
      viewportEl.addEventListener('pointerleave', endPtr);
      gridEl.addEventListener('click', (e) => {
        if (movedSinceDown) { e.stopPropagation(); e.preventDefault(); movedSinceDown = false; }
      }, true);
      viewportEl.addEventListener('wheel', (e) => {
        e.preventDefault();
        setZoom(zoom + (-Math.sign(e.deltaY) * 0.2), e.clientX, e.clientY);
      }, { passive: false });
    }

    buildGrid();
    render();

    return {
      update,
      on(evt, fn) { (listeners[evt] = listeners[evt] || []).push(fn); },
      cellEl,
      resetZoom,
      zoomIn: () => setZoom(zoom + 0.5),
      zoomOut: () => setZoom(zoom - 0.5),
      getState: () => ({ ...state, zoom, panX, panY }),
    };
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { createBoardView };
  else root.createBoardView = createBoardView;
})(typeof window !== 'undefined' ? window : globalThis);
