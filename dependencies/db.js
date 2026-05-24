const { DocStore, FileStorageAdapter } = require('../lib/js-doc-store');
const path = require('path');

// Inicializar base de datos persistente en disco en la carpeta '.data/'
const dbPath = path.resolve(__dirname, '..', '.data');
const db = new DocStore(new FileStorageAdapter(dbPath));

module.exports = db;
