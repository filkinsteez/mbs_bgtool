// Rounds numbers in a preset to 4 decimals and writes it with flat inner objects.
// Usage: node tools/tidy-preset.mjs <in.json> <out.json>
import { readFileSync, writeFileSync } from 'node:fs';

const [, , inPath, outPath] = process.argv;
const round = (v) => (typeof v === 'number' ? Math.round(v * 1e4) / 1e4 : v);
const data = JSON.parse(readFileSync(inPath, 'utf8'), (_, v) => round(v));

// Objects and arrays without nested objects go on one line.
function fmt(v, indent) {
  const pad = '  '.repeat(indent);
  const isFlat = (x) => typeof x !== 'object' || x === null || (Array.isArray(x) ? x.every((e) => typeof e !== 'object') : Object.values(x).every((e) => typeof e !== 'object' || (Array.isArray(e) && e.every((n) => typeof n !== 'object'))));
  if (typeof v !== 'object' || v === null) return JSON.stringify(v);
  if (isFlat(v)) return JSON.stringify(v).replace(/,"/g, ', "').replace(/":/g, '": ').replace(/,(?=\d|-|")/g, ', ');
  if (Array.isArray(v)) return `[\n${v.map((e) => pad + '  ' + fmt(e, indent + 1)).join(',\n')}\n${pad}]`;
  return `{\n${Object.entries(v).map(([k, e]) => `${pad}  ${JSON.stringify(k)}: ${fmt(e, indent + 1)}`).join(',\n')}\n${pad}}`;
}
writeFileSync(outPath, fmt(data, 0) + '\n');
console.log('wrote', outPath);
