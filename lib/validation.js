/**
 * Motor de validación tipado + serialización por esquema (estilo Pydantic / response_model).
 * Zero dependencias. Implementado y verificado con el gate determinista CCDD
 * (ver ccdd/validation/ y ccdd/serialize/).
 */

// ---------------------------------------------------------------------------
// VALIDACIÓN TIPADA  (contrato: validate-value-against-schema)
// ---------------------------------------------------------------------------

const TYPE_CHECKS = {
  string:  v => typeof v === 'string',
  number:  v => typeof v === 'number' && Number.isFinite(v),
  integer: v => Number.isInteger(v),
  boolean: v => typeof v === 'boolean',
  array:   v => Array.isArray(v),
  object:  v => v !== null && typeof v === 'object' && !Array.isArray(v),
};

// Tabla de constraints: cada una se evalúa si su clave está declarada en el esquema.
// `fails(value, schema, len)` devuelve true si la constraint NO se cumple.
const CONSTRAINTS = [
  { key: 'enum',      fails: (v, s)      => Array.isArray(s.enum) && !s.enum.includes(v), msg: ()  => 'valor fuera de enum' },
  { key: 'minimum',   fails: (v, s)      => v < s.minimum,                            msg: (s) => `menor que minimum ${s.minimum}` },
  { key: 'maximum',   fails: (v, s)      => v > s.maximum,                            msg: (s) => `mayor que maximum ${s.maximum}` },
  { key: 'minLength', fails: (v, s, len) => len !== null && len < s.minLength,        msg: (s) => `longitud menor que minLength ${s.minLength}` },
  { key: 'maxLength', fails: (v, s, len) => len !== null && len > s.maxLength,        msg: (s) => `longitud mayor que maxLength ${s.maxLength}` },
];

// Constraints escalares y de longitud. Devuelve un array de errores {path,message}.
function _checkConstraints(value, schema, path) {
  const errors = [];
  const len = (typeof value === 'string' || Array.isArray(value)) ? value.length : null;
  for (const c of CONSTRAINTS) {
    if (schema[c.key] !== undefined && c.fails(value, schema, len)) {
      errors.push({ path, message: c.msg(schema) });
    }
  }
  return errors;
}

// Recursión sobre hijos: properties (object) e items (array).
function _checkChildren(value, schema, path) {
  const errors = [];
  if (schema.type === 'object' && schema.properties) {
    for (const key of Object.keys(schema.properties)) {
      const childPath = path ? `${path}.${key}` : key;
      errors.push(...validate(value[key], schema.properties[key], childPath).errors);
    }
  } else if (schema.type === 'array' && schema.items) {
    value.forEach((item, i) => {
      errors.push(...validate(item, schema.items, `${path}[${i}]`).errors);
    });
  }
  return errors;
}

/**
 * Valida un valor contra un esquema declarativo recursivo.
 * @returns {{ valid: boolean, errors: Array<{ path: string, message: string }> }}
 */
function validate(value, schema, path = '') {
  if (value === undefined || value === null) {
    const errors = schema.required ? [{ path, message: 'campo requerido' }] : [];
    return { valid: errors.length === 0, errors };
  }
  const checker = TYPE_CHECKS[schema.type];
  if (checker && !checker(value)) {
    return { valid: false, errors: [{ path, message: `se esperaba ${schema.type}` }] };
  }
  const errors = [
    ..._checkConstraints(value, schema, path),
    ..._checkChildren(value, schema, path),
  ];
  return { valid: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// SERIALIZACIÓN POR response_model  (contrato: serialize-value-by-response-model)
// ---------------------------------------------------------------------------

/**
 * Proyecta un valor dejando solo los campos declarados por el esquema (recursivo).
 * Equivale al response_model de FastAPI: no expone campos no declarados.
 */
function serialize(value, schema) {
  if (value == null) return value; // null/undefined pasan sin proyectar (evita {} espurio)
  if (schema.type === 'object' && schema.properties) {
    const out = {};
    for (const key of Object.keys(schema.properties)) {
      if (value != null && key in value) {
        out[key] = serialize(value[key], schema.properties[key]);
      }
    }
    return out;
  }
  if (schema.type === 'array' && schema.items && Array.isArray(value)) {
    return value.map(item => serialize(item, schema.items));
  }
  return value;
}

// ---------------------------------------------------------------------------
// COERCIÓN DE TIPOS  (contrato: coerce-value-to-schema-types)
// ---------------------------------------------------------------------------

const COERCERS = {
  number:  v => { const n = Number(v); return (typeof v === 'string' && v.trim() !== '' && !isNaN(n)) ? n : v; },
  integer: v => { const n = Number(v); return (typeof v === 'string' && v.trim() !== '' && Number.isInteger(n)) ? n : v; },
  boolean: v => {
    if (v === 'true' || v === '1' || v === 1) return true;
    if (v === 'false' || v === '0' || v === 0) return false;
    return v;
  },
  string:  v => (typeof v === 'number' || typeof v === 'boolean') ? String(v) : v,
};

// Coerciona las propiedades declaradas de un objeto; si value no es objeto, lo devuelve igual
// (preserva el tipo original para que la validación posterior falle correctamente).
function _coerceObject(value, schema) {
  if (typeof value !== 'object' || Array.isArray(value)) return value;
  const out = { ...value };
  for (const key of Object.keys(schema.properties)) {
    if (key in out) out[key] = coerce(out[key], schema.properties[key]);
  }
  return out;
}

/**
 * Coerciona un valor a los tipos declarados por el esquema (recursivo, no mutante).
 * Lo no coercible se devuelve sin cambios (la validación posterior lo marca).
 */
function coerce(value, schema) {
  if (value == null) return value;
  if (schema.type === 'object' && schema.properties) return _coerceObject(value, schema);
  if (schema.type === 'array' && schema.items && Array.isArray(value)) {
    return value.map(item => coerce(item, schema.items));
  }
  const fn = COERCERS[schema.type];
  return fn ? fn(value) : value;
}

module.exports = { validate, serialize, coerce };
