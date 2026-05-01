(function (root) {
  const COLS = 30;
  const ROWS = 18;

  function generateBoard() {
    const cells = [];
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        const hue = (col / COLS) * 360;
        const tRow = ROWS === 1 ? 0 : row / (ROWS - 1);

        const lightness = 95 - tRow * 87;

        const distFromMid = Math.abs(tRow - 0.5) * 2;
        let saturation = 95 - Math.pow(distFromMid, 1.4) * 80;
        saturation = Math.max(0, Math.min(100, saturation));

        cells.push({
          col,
          row,
          id: `C${col}-R${row}`,
          h: +hue.toFixed(2),
          s: +saturation.toFixed(2),
          l: +Math.max(0, Math.min(100, lightness)).toFixed(2)
        });
      }
    }
    return cells;
  }

  function cellHsl(c) {
    return `hsl(${c.h}, ${c.s}%, ${c.l}%)`;
  }

  function chebyshev(a, b) {
    return Math.max(Math.abs(a.col - b.col), Math.abs(a.row - b.row));
  }

  const api = { COLS, ROWS, generateBoard, cellHsl, chebyshev };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.GameColors = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
