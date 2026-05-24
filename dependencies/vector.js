const { VectorStore, QuantizedStore, BinaryQuantizedStore, PolarQuantizedStore, FileStorageAdapter } = require('../lib/js-vector-store');
const path = require('path');

// Almacén vectorial persistente en disco en '.data/vectors'
const vectorPath = path.resolve(__dirname, '..', '.data', 'vectors');
const adapter = new FileStorageAdapter(vectorPath);

// Instanciar almacenes dinámicos
const stores = {
    float32: new VectorStore(adapter, 768),
    int8: new QuantizedStore(adapter, 768),
    binary: new BinaryQuantizedStore(adapter, 768),
    polar: new PolarQuantizedStore(adapter, 768)
};

// Mantener compatibilidad hacia atrás exportando la instancia por defecto
const defaultStore = stores.float32;
defaultStore.stores = stores;
defaultStore.getStore = (type) => stores[type] || stores.float32;
defaultStore.flushAll = () => {
    for (const store of Object.values(stores)) {
        store.flush();
    }
};

module.exports = defaultStore;
