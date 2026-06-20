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

// Constraints escalares y de longitud. Devuelve un array de errores {path,message}.
function _checkConstraints(value, schema, path) {
  const errors = [];
  if (schema.enum && !schema.enum.includes(value)) {
    errors.push({ path, message: 'valor fuera de enum' });
  }
  if (schema.minimum !== undefined && value < schema.minimum) {
    errors.push({ path, message: `menor que minimum ${schema.minimum}` });
  }
  if (schema.maximum !== undefined && value > schema.maximum) {
    errors.push({ path, message: `mayor que maximum ${schema.maximum}` });
  }
  const len = (typeof value === 'string' || Array.isArray(value)) ? value.length : null;
  if (len !== null && schema.minLength !== undefined && len < schema.minLength) {
    errors.push({ path, message: `longitud menor que minLength ${schema.minLength}` });
  }
  if (len !== null && schema.maxLength !== undefined && len > schema.maxLength) {
    errors.push({ path, message: `longitud mayor que maxLength ${schema.maxLength}` });
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

module.exports = { validate, serialize };
