(function (root) {
  /**
   * createTimerRing — wraps an existing element with a SVG ring that visualises
   * a deadline countdown. The ring drains from full (deadline far away) to
   * empty (deadline reached). Color shifts green → yellow → red as time runs
   * out. Fires onExpire (locally) once the deadline passes.
   *
   *   const ring = createTimerRing(targetEl);
   *   ring.start(deadlineMs, totalSeconds);
   *   ring.stop();
   *   ring.destroy();
   */
  function createTimerRing(target) {
    if (!target) throw new Error('createTimerRing: target element required');

    // Wrap the target so the ring sits behind/around it without changing layout.
    const parent = target.parentNode;
    const wrap = document.createElement('span');
    wrap.className = 'timer-ring-wrap';
    parent.insertBefore(wrap, target);
    wrap.appendChild(target);

    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('class', 'timer-ring');
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.setAttribute('viewBox', '0 0 100 100');
    svg.setAttribute('aria-hidden', 'true');
    const rect = document.createElementNS(svgNS, 'rect');
    rect.setAttribute('x', '2');
    rect.setAttribute('y', '2');
    rect.setAttribute('width', '96');
    rect.setAttribute('height', '96');
    rect.setAttribute('rx', '18');
    rect.setAttribute('ry', '18');
    rect.setAttribute('fill', 'none');
    rect.setAttribute('stroke-linecap', 'round');
    rect.setAttribute('pathLength', '1');
    rect.setAttribute('stroke-dasharray', '1 1');
    rect.setAttribute('stroke-dashoffset', '0');
    svg.appendChild(rect);
    wrap.appendChild(svg);

    const label = document.createElement('span');
    label.className = 'timer-ring-label';
    label.setAttribute('aria-hidden', 'true');
    wrap.appendChild(label);

    let raf = null;
    let deadlineMs = 0;
    let totalMs = 0;
    let onExpire = null;
    let warnedFive = false;
    let onTickHook = null;
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
      if (onTickHook) onTickHook(remaining);
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
      onTickHook = opts && opts.onTick || null;
      warnedFive = false;
      wrap.classList.add('active');
      wrap.classList.remove('about-to-expire');
      active = true;
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
      // Restore the original DOM: move target back out and remove the wrap
      const grandparent = wrap.parentNode;
      if (grandparent) {
        grandparent.insertBefore(target, wrap);
        grandparent.removeChild(wrap);
      }
    }

    return { start, stop, destroy, wrap };
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { createTimerRing };
  else root.createTimerRing = createTimerRing;
})(typeof window !== 'undefined' ? window : globalThis);
