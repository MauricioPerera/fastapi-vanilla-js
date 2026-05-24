const { VectorStore, QuantizedStore, BinaryQuantizedStore, PolarQuantizedStore, FileStorageAdapter } = require('../lib/js-vector-store');
const path = require('path');

// Almacén vectorial persistente en disco en '.data/vectors'
const vectorPath = path.resolve(__dirname, '..', '.data', 'vectors');
let adapter = new FileStorageAdapter(vectorPath);

// Instanciar almacenes dinámicos
const stores = {
    float32: new VectorStore(adapter, 768),
    int8: new QuantizedStore(adapter, 768),
    binary: new BinaryQuantizedStore(adapter, 768),
    polar: new PolarQuantizedStore(adapter, 768)
};

let isInitialized = false;
let initPromise = null;

const initCrypto = async () => {
    if (isInitialized) return;
    if (initPromise) return initPromise;

    initPromise = (async () => {
        const key = process.env.ENCRYPTION_KEY || null;
        if (key) {
            const { EncryptedStorageAdapter } = require('../lib/js-vector-store');
            adapter = await EncryptedStorageAdapter.create(adapter, key);
            // Vincular el adapter encriptado a las instancias existentes de store
            for (const store of Object.values(stores)) {
                store._adapter = adapter;
            }
        }
        isInitialized = true;
    })();

    return initPromise;
};

// Mantener compatibilidad hacia atrás exportando la instancia por defecto
const defaultStore = stores.float32;
defaultStore.stores = stores;
defaultStore.getStore = (type) => stores[type] || stores.float32;
defaultStore.initCrypto = initCrypto;
defaultStore.flushAll = async () => {
    await initCrypto();
    for (const store of Object.values(stores)) {
        store.flush();
        if (store._adapter && typeof store._adapter.persist === 'function') {
            await store._adapter.persist();
        }
    }
};

module.exports = defaultStore;
