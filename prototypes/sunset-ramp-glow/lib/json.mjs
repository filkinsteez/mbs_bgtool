/** JSON with arrays of numbers/strings (and arrays of those) kept on one line. */
export function formatJson(value, indent = '') {
  const inner = indent + '  ';
  const flat = (v) => v === null || typeof v !== 'object' || (Array.isArray(v) && v.every(flat));
  if (Array.isArray(value)) {
    if (value.every(flat)) return JSON.stringify(value).replace(/,/g, ', ');
    return '[\n' + value.map((v) => inner + formatJson(v, inner)).join(',\n') + '\n' + indent + ']';
  }
  if (value && typeof value === 'object') {
    const keys = Object.keys(value);
    if (!keys.length) return '{}';
    return (
      '{\n' + keys.map((k) => `${inner}${JSON.stringify(k)}: ${formatJson(value[k], inner)}`).join(',\n') + '\n' + indent + '}'
    );
  }
  return JSON.stringify(value);
}
