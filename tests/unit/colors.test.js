const colors = require('../../public/js/colors');

describe('colors', () => {
  describe('generateBoard', () => {
    test('uses default dimensions when none provided', () => {
      const board = colors.generateBoard();
      expect(board).toHaveLength(colors.COLS * colors.ROWS);
    });

    test('honors custom dimensions', () => {
      const board = colors.generateBoard(15, 9);
      expect(board).toHaveLength(135);
    });

    test('every cell has id, col, row, h, s, l', () => {
      const board = colors.generateBoard(5, 3);
      for (const c of board) {
        expect(c).toEqual(expect.objectContaining({
          id: expect.any(String),
          col: expect.any(Number),
          row: expect.any(Number),
          h: expect.any(Number),
          s: expect.any(Number),
          l: expect.any(Number),
        }));
        expect(c.id).toBe(`C${c.col}-R${c.row}`);
      }
    });

    test('hue spans 0–360', () => {
      const board = colors.generateBoard(15, 9);
      const hues = board.map(c => c.h);
      expect(Math.min(...hues)).toBe(0);
      expect(Math.max(...hues)).toBeLessThan(360);
    });

    test('saturation stays inside [20,100]', () => {
      const board = colors.generateBoard(15, 9);
      for (const c of board) {
        expect(c.s).toBeGreaterThanOrEqual(20);
        expect(c.s).toBeLessThanOrEqual(100);
      }
    });

    test('handles single-row boards without dividing by zero', () => {
      const board = colors.generateBoard(5, 1);
      expect(board).toHaveLength(5);
      expect(board.every(c => Number.isFinite(c.l))).toBe(true);
    });
  });

  describe('cellHsl', () => {
    test('returns CSS hsl() string', () => {
      expect(colors.cellHsl({ h: 120, s: 80, l: 50 })).toBe('hsl(120, 80%, 50%)');
    });
  });

  describe('chebyshev', () => {
    test('zero for identical cells', () => {
      expect(colors.chebyshev({ col: 3, row: 4 }, { col: 3, row: 4 })).toBe(0);
    });

    test('takes the max of |dx|, |dy|', () => {
      expect(colors.chebyshev({ col: 0, row: 0 }, { col: 3, row: 7 })).toBe(7);
      expect(colors.chebyshev({ col: 5, row: 5 }, { col: 6, row: 5 })).toBe(1);
    });
  });

  describe('colDistance', () => {
    test('returns plain distance when smaller than wrap', () => {
      expect(colors.colDistance(3, 5, 15)).toBe(2);
      expect(colors.colDistance(7, 8, 15)).toBe(1);
    });

    test('wraps around when the other side is shorter', () => {
      expect(colors.colDistance(0, 14, 15)).toBe(1);
      expect(colors.colDistance(14, 0, 15)).toBe(1);
      expect(colors.colDistance(1, 13, 15)).toBe(3);
    });
  });

  describe('chebyshevWrap', () => {
    test('uses wrap for cols and plain for rows', () => {
      expect(colors.chebyshevWrap({ col: 0, row: 4 }, { col: 14, row: 5 }, 15)).toBe(1);
      expect(colors.chebyshevWrap({ col: 0, row: 4 }, { col: 1, row: 4 }, 15)).toBe(1);
      expect(colors.chebyshevWrap({ col: 0, row: 0 }, { col: 7, row: 0 }, 15)).toBe(7);
    });

    test('row diff dominates when bigger than wrapped col', () => {
      expect(colors.chebyshevWrap({ col: 0, row: 0 }, { col: 1, row: 5 }, 15)).toBe(5);
    });
  });
});
