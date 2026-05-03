(function (root) {
  const COLS = 30;
  const ROWS = 18;

  function generateBoard(cols, rows) {
    cols = cols || COLS;
    rows = rows || ROWS;
    const cells = [];
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const hue = (col / cols) * 360;
        const tRow = rows === 1 ? 0 : row / (rows - 1);

        const lightness = 85 - tRow * 65;

        const distFromMid = Math.abs(tRow - 0.5) * 2;
        let saturation = 100 - Math.pow(distFromMid, 1.6) * 55;
        saturation = Math.max(20, Math.min(100, saturation));

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

  function colDistance(c1, c2, cols) {
    const d = Math.abs(c1 - c2);
    return Math.min(d, cols - d);
  }

  function chebyshevWrap(a, b, cols) {
    return Math.max(colDistance(a.col, b.col, cols), Math.abs(a.row - b.row));
  }

  const api = { COLS, ROWS, generateBoard, cellHsl, chebyshev, colDistance, chebyshevWrap };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.GameColors = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
