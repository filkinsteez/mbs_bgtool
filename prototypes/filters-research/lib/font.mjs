// A 5x7 pixel font for the ASCII ramp, drawn in a 6x9 cell (1 px gap right, 1 px top, 1 px bottom).
// Rows top to bottom, 5 columns each, '#' = ink.
const GLYPHS = {
  ' ': ['.....', '.....', '.....', '.....', '.....', '.....', '.....'],
  '.': ['.....', '.....', '.....', '.....', '.....', '.##..', '.##..'],
  '-': ['.....', '.....', '.....', '#####', '.....', '.....', '.....'],
  ':': ['.....', '.##..', '.##..', '.....', '.##..', '.##..', '.....'],
  '+': ['.....', '..#..', '..#..', '#####', '..#..', '..#..', '.....'],
  '=': ['.....', '.....', '#####', '.....', '#####', '.....', '.....'],
  '*': ['.....', '..#..', '#.#.#', '.###.', '#.#.#', '..#..', '.....'],
  '%': ['##...', '##..#', '...#.', '..#..', '.#...', '#..##', '...##'],
  '#': ['.#.#.', '.#.#.', '#####', '.#.#.', '#####', '.#.#.', '.#.#.'],
  '@': ['.###.', '#...#', '#.###', '#.#.#', '#.###', '#....', '.####'],
}

export const CELL_COLS = 6
export const CELL_ROWS = 9

/** Glyphs sorted by ink coverage of the 6x9 cell, lightest first. */
export const RAMP = Object.entries(GLYPHS)
  .map(([ch, rows]) => ({ ch, rows, coverage: rows.join('').split('').filter((c) => c === '#').length / (CELL_COLS * CELL_ROWS) }))
  .sort((a, b) => a.coverage - b.coverage)

/** Ink at font-space point (fx, fy) in cell units (0..6, 0..9). */
export function glyphInk(glyph, fx, fy) {
  const col = Math.floor(fx - 0.5)
  const row = Math.floor(fy - 1)
  if (row < 0 || row > 6 || col < 0 || col > 4) return 0
  return glyph.rows[row][col] === '#' ? 1 : 0
}
