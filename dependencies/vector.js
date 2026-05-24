const { VectorStore, FileStorageAdapter } = require('../lib/js-vector-store');
const path = require('path');

// Almacén vectorial persistente en disco en '.data/vectors'
const vectorPath = path.resolve(__dirname, '..', '.data', 'vectors');
const vectorDb = new VectorStore(new FileStorageAdapter(vectorPath), 768);

module.exports = vectorDb;
