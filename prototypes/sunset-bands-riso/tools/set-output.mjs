// Copies a preset and replaces scene.output with JSON from a file.
// Usage: node tools/set-output.mjs <in.json> <output.json> <out.json>
import { readFileSync, writeFileSync } from 'node:fs';

const [, , inPath, outputPath, outPath] = process.argv;
const preset = JSON.parse(readFileSync(inPath, 'utf8'));
preset.scene.output = JSON.parse(readFileSync(outputPath, 'utf8'));
writeFileSync(outPath, JSON.stringify(preset, null, 2));
console.log('wrote', outPath);
