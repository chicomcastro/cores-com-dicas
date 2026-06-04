(function (root) {
  /**
   * createTimerRing — wraps an existing element with a SVG ring that hugs the
   * element's actual rounded-rect shape. The ring drains as the deadline
   * approaches and shifts green → yellow → red. The ring matches the target's
   * computed border-radius and resizes with it via ResizeObserver.
   *
   *   const ring = createTimerRing(targetEl);
   *   ring.start(deadlineMs, totalSeconds);
   *   ring.stop();
   *   ring.destroy();
   */
  function createTimerRing(target) {
    if (!target) throw new Error('createTimerRing: target element required');

    const STROKE_WIDTH = 2.5;
    const OUTSET = 1; // visual gap between the button's border and the ring

    // Wrap the target so the ring overlays it without affecting layout.
    const parent = target.parentNode;
    const wrap = document.createElement('span');
    wrap.className = 'timer-ring-wrap';
    parent.insertBefore(wrap, target);
    wrap.appendChild(target);

    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('class', 'timer-ring');
    svg.setAttribute('aria-hidden', 'true');
    const rect = document.createElementNS(svgNS, 'rect');
    rect.setAttribute('fill', 'none');
    rect.setAttribute('stroke-linecap', 'round');
    rect.setAttribute('pathLength', '1');
    rect.setAttribute('stroke-dasharray', '1 1');
    rect.setAttribute('stroke-dashoffset', '0');
    rect.setAttribute('stroke-width', String(STROKE_WIDTH));
    svg.appendChild(rect);
    wrap.appendChild(svg);

    const label = document.createElement('span');
    label.className = 'timer-ring-label';
    label.setAttribute('aria-hidden', 'true');
    wrap.appendChild(label);

    function syncDimensions() {
      const r = target.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return;
      const w = r.width + OUTSET * 2;
      const h = r.height + OUTSET * 2;
      svg.setAttribute('width', String(w));
      svg.setAttribute('height', String(h));
      svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
      svg.style.left = `-${OUTSET}px`;
      svg.style.top = `-${OUTSET}px`;
      // Stroke sits centered on the rect's path, so inset by half-stroke to
      // avoid clipping at the SVG edges.
      const half = STROKE_WIDTH / 2;
      rect.setAttribute('x', String(half));
      rect.setAttribute('y', String(half));
      rect.setAttribute('width', String(w - STROKE_WIDTH));
      rect.setAttribute('height', String(h - STROKE_WIDTH));
      // Match the target's border-radius, slightly grown by the outset so the
      // ring curves around the button rather than cutting across it.
      const cs = root.getComputedStyle ? root.getComputedStyle(target) : null;
      const cssRadius = cs ? parseFloat(cs.borderRadius) : 0;
      const baseRadius = Number.isFinite(cssRadius) && cssRadius > 0 ? cssRadius : 16;
      const rx = Math.max(2, baseRadius + OUTSET);
      rect.setAttribute('rx', String(rx));
      rect.setAttribute('ry', String(rx));
    }

    let resizeObserver = null;
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(syncDimensions);
      resizeObserver.observe(target);
    } else {
      root.addEventListener && root.addEventListener('resize', syncDimensions);
    }
    syncDimensions();

    let raf = null;
    let deadlineMs = 0;
    let totalMs = 0;
    let onExpire = null;
    let warnedFive = false;
    let active = false;

    function setColorClass(remainingRatio) {
      wrap.classList.toggle('warn', remainingRatio < 0.5 && remainingRatio >= 0.2);
      wrap.classList.toggle('danger', remainingRatio < 0.2);
    }

    function tick() {
      if (!active) return;
      const remaining = deadlineMs - Date.now();
      const ratio = Math.max(0, Math.min(1, remaining / totalMs));
      rect.setAttribute('stroke-dashoffset', String(1 - ratio));
      setColorClass(ratio);
      const secLeft = Math.max(0, Math.ceil(remaining / 1000));
      label.textContent = secLeft > 0 ? `${secLeft}s` : '';
      if (remaining > 5000) warnedFive = false;
      if (remaining <= 5000 && !warnedFive) {
        warnedFive = true;
        wrap.classList.add('about-to-expire');
      }
      if (remaining <= 0) {
        stop();
        if (onExpire) onExpire();
        return;
      }
      raf = requestAnimationFrame(tick);
    }

    function start(deadline, totalSeconds, opts) {
      stop();
      deadlineMs = deadline;
      totalMs = Math.max(1, totalSeconds) * 1000;
      onExpire = opts && opts.onExpire || null;
      warnedFive = false;
      wrap.classList.add('active');
      wrap.classList.remove('about-to-expire');
      active = true;
      syncDimensions();
      tick();
    }

    function stop() {
      active = false;
      if (raf) cancelAnimationFrame(raf);
      raf = null;
      wrap.classList.remove('active', 'warn', 'danger', 'about-to-expire');
      label.textContent = '';
      rect.setAttribute('stroke-dashoffset', '1');
    }

    function destroy() {
      stop();
      if (resizeObserver) { try { resizeObserver.disconnect(); } catch (e) {} }
      const grandparent = wrap.parentNode;
      if (grandparent) {
        grandparent.insertBefore(target, wrap);
        grandparent.removeChild(wrap);
      }
    }

    return { start, stop, destroy, wrap, refresh: syncDimensions };
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { createTimerRing };
  else root.createTimerRing = createTimerRing;
})(typeof window !== 'undefined' ? window : globalThis);
