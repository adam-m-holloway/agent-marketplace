// Minimal JSON Schema subset validator. Zero dependencies.
// Supports: type (incl. integer, array of types), required, properties,
// additionalProperties:false, enum, const, pattern, minLength, maxLength,
// items, minItems, maxItems. Unknown keywords are ignored.

function typeOf(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

function matchesType(t, v) {
  const actual = typeOf(v);
  if (t === 'integer') return Number.isInteger(v);
  if (t === 'number') return actual === 'number';
  return actual === t;
}

const fmt = (v) => JSON.stringify(v);

/**
 * Validate data against schema.
 * @returns {{path:string, message:string}[]} empty when valid. Paths are JSON Pointers ("" = root).
 */
export function validate(schema, data, path = '') {
  const errs = [];
  const err = (message, p = path) => errs.push({ path: p, message });
  if (!schema || typeof schema !== 'object') return errs;

  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((t) => matchesType(t, data))) {
      err(`expected ${types.join('|')}, got ${typeOf(data)}`);
      return errs; // further checks would be noise
    }
  }
  if (schema.const !== undefined && fmt(schema.const) !== fmt(data)) {
    err(`must equal ${fmt(schema.const)}`);
  }
  if (Array.isArray(schema.enum) && !schema.enum.some((e) => fmt(e) === fmt(data))) {
    err(`must be one of ${schema.enum.map(fmt).join(', ')}`);
  }

  if (typeof data === 'string') {
    if (schema.minLength !== undefined && data.length < schema.minLength) {
      err(`must be at least ${schema.minLength} characters`);
    }
    if (schema.maxLength !== undefined && data.length > schema.maxLength) {
      err(`must be at most ${schema.maxLength} characters (got ${data.length})`);
    }
    if (schema.pattern !== undefined && !new RegExp(schema.pattern, 'u').test(data)) {
      err(`must match pattern ${schema.pattern}`);
    }
  }

  if (Array.isArray(data)) {
    if (schema.minItems !== undefined && data.length < schema.minItems) {
      err(`must have at least ${schema.minItems} items`);
    }
    if (schema.maxItems !== undefined && data.length > schema.maxItems) {
      err(`must have at most ${schema.maxItems} items`);
    }
    if (schema.items && typeof schema.items === 'object') {
      data.forEach((item, i) => errs.push(...validate(schema.items, item, `${path}/${i}`)));
    }
  }

  if (typeOf(data) === 'object') {
    const props = schema.properties ?? {};
    for (const key of schema.required ?? []) {
      if (!(key in data)) err('is required', `${path}/${key}`);
    }
    for (const [key, value] of Object.entries(data)) {
      if (key in props) errs.push(...validate(props[key], value, `${path}/${key}`));
      else if (schema.additionalProperties === false) err('is not allowed', `${path}/${key}`);
    }
  }
  return errs;
}
