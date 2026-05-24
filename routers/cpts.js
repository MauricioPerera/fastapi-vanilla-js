const { APIRouter } = require('../lib/fastapi');
const { getCurrentUser } = require('../dependencies/auth');
const db = require('../dependencies/db');
const { Table } = require('../lib/js-doc-store');

const cptRouter = new APIRouter({
    prefix: '/cpts',
    tags: ['CPTs'],
    dependencies: { user: getCurrentUser } // Enforce authentication for all endpoints
});

// Helper helper to get all registered schemas dynamically from the metadata collection
const getSchemas = () => {
    const schemaCol = db.collection('_cpt_schemas');
    return schemaCol.find({}).toArray();
};

// 1. List all active schemas/CPTs
cptRouter.get('/schemas', (req, res, deps) => {
    try {
        const schemas = getSchemas();
        return {
            mensaje: "Listado de CPTs obtenido exitosamente",
            cpts: schemas
        };
    } catch (err) {
        return res.json({ detail: "Error al listar CPTs", mensaje: err.message }, 500);
    }
});

// 2. Create/Register a new CPT (Schema definition)
cptRouter.post('/schemas', (req, res, deps) => {
    const { name, columns } = req.body;
    if (!name || !Array.isArray(columns)) {
        return res.json({ detail: "Campos 'name' y 'columns' son obligatorios" }, 400);
    }
    
    // Clean name to be an alphanumeric collection name
    const cleanName = name.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');
    if (!cleanName) {
        return res.json({ detail: "Nombre de CPT inválido" }, 400);
    }

    try {
        const schemaCol = db.collection('_cpt_schemas');
        
        // Upsert the schema document using cleanName as _id
        const existing = schemaCol.findById(cleanName);
        if (existing) {
            schemaCol.removeById(cleanName);
        }
        
        schemaCol.insert({
            _id: cleanName,
            name: cleanName,
            columns
        });
        try {
            schemaCol.flush();
        } catch (flushErr) {
            return res.json({ detail: "Error al persistir el esquema en disco", mensaje: flushErr.message }, 500);
        }

        return {
            mensaje: `CPT '${cleanName}' registrado y guardado con éxito`,
            cpt: {
                name: cleanName,
                columns
            }
        };
    } catch (err) {
        return res.json({ detail: "Error al crear el CPT", mensaje: err.message }, 500);
    }
}, {
    body: {
        name: { type: 'string', required: true },
        columns: { type: 'array', required: true }
    }
});

// 3. Get all documents in a CPT (optionally expanding relations)
cptRouter.get('/:collection', (req, res, deps) => {
    const { collection } = req.params;
    const expand = req.query.expand === 'true';

    try {
        // Verify schema exists
        const schemaCol = db.collection('_cpt_schemas');
        const schemaDoc = schemaCol.findById(collection);
        if (!schemaDoc) {
            return res.json({ detail: `El CPT '${collection}' no está registrado.` }, 404);
        }

        const table = new Table(db, collection, { columns: schemaDoc.columns });
        const col = db.collection(collection);
        let docs = col.find({}).toArray();

        if (expand) {
            docs = docs.map(doc => table.expandRelations(doc));
        }

        return {
            mensaje: `Documentos obtenidos del CPT '${collection}'`,
            conteo: docs.length,
            documentos: docs,
            columns: schemaDoc.columns
        };
    } catch (err) {
        return res.json({ detail: "Error al leer documentos", mensaje: err.message }, 500);
    }
});

// 4. Create a document in a CPT, executing column validations
cptRouter.post('/:collection', (req, res, deps) => {
    const { collection } = req.params;
    const docData = req.body;

    try {
        // Verify schema exists
        const schemaCol = db.collection('_cpt_schemas');
        const schemaDoc = schemaCol.findById(collection);
        if (!schemaDoc) {
            return res.json({ detail: `El CPT '${collection}' no está registrado.` }, 404);
        }

        // NOTE: Uso consciente de métodos privados de js-doc-store Table:
        // _applyDefaults, _validate y _col son APIs internas; se usan aquí para
        // acceder al pipeline de validación sin duplicar lógica.
        const table = new Table(db, collection, { columns: schemaDoc.columns });

        // 1. Apply defaults
        const defaultedDoc = table._applyDefaults(docData);

        // 2. Validate columns (throws on invalid data → caught as 400)
        table._validate(defaultedDoc);

        // 3. Insert
        const inserted = table._col.insert(defaultedDoc);

        // 4. Persist (disk/KV errors → 500)
        try {
            table._col.flush();
        } catch (flushErr) {
            return res.json({ detail: "Error al persistir el documento en disco", mensaje: flushErr.message }, 500);
        }

        return {
            mensaje: "Documento insertado con éxito",
            documento: inserted
        };
    } catch (err) {
        return res.json({ detail: "Error de validación o inserción", mensaje: err.message }, 400);
    }
});

// 5. Update/Edit a document by ID
cptRouter.put('/:collection/:id', (req, res, deps) => {
    const { collection, id } = req.params;
    const docData = req.body;

    try {
        const schemaCol = db.collection('_cpt_schemas');
        const schemaDoc = schemaCol.findById(collection);
        if (!schemaDoc) {
            return res.json({ detail: `El CPT '${collection}' no está registrado.` }, 404);
        }

        const col = db.collection(collection);
        const existing = col.findById(id);
        if (!existing) {
            return res.json({ detail: "Documento no encontrado" }, 404);
        }

        const table = new Table(db, collection, { columns: schemaDoc.columns });

        const merged = { ...existing, ...docData, _id: existing._id };
        const defaultedDoc = table._applyDefaults(merged);
        table._validate(defaultedDoc);

        col.update({ _id: id }, { $set: defaultedDoc });

        try {
            col.flush();
        } catch (flushErr) {
            return res.json({ detail: "Error al persistir la actualización en disco", mensaje: flushErr.message }, 500);
        }

        const updated = col.findById(id);
        return {
            mensaje: "Documento actualizado con éxito",
            documento: updated
        };
    } catch (err) {
        return res.json({ detail: "Error de validación o actualización", mensaje: err.message }, 400);
    }
});

// 6. Delete a CPT schema AND all its data
cptRouter.delete('/schemas/:name', (req, res, deps) => {
    const { name } = req.params;

    try {
        const schemaCol = db.collection('_cpt_schemas');
        const schemaDoc = schemaCol.findById(name);
        if (!schemaDoc) {
            return res.json({ detail: `El CPT '${name}' no está registrado.` }, 404);
        }

        schemaCol.removeById(name);
        schemaCol.flush();

        const col = db.collection(name);
        const docs = col.find({}).toArray();
        for (const doc of docs) {
            col.removeById(doc._id);
        }
        col.flush();

        return {
            mensaje: `CPT '${name}' y todos sus documentos eliminados con éxito`
        };
    } catch (err) {
        return res.json({ detail: "Error al eliminar el CPT", mensaje: err.message }, 500);
    }
});

// 7. Delete a document by ID
cptRouter.delete('/:collection/:id', (req, res, deps) => {
    const { collection, id } = req.params;

    try {
        // Verify schema exists
        const schemaCol = db.collection('_cpt_schemas');
        const schemaDoc = schemaCol.findById(collection);
        if (!schemaDoc) {
            return res.json({ detail: `El CPT '${collection}' no está registrado.` }, 404);
        }

        const col = db.collection(collection);
        const deleted = col.removeById(id);
        col.flush();

        if (!deleted) {
            return res.json({ detail: "Documento no encontrado" }, 404);
        }

        return {
            mensaje: "Documento eliminado con éxito",
            id
        };
    } catch (err) {
        return res.json({ detail: "Error al eliminar el documento", mensaje: err.message }, 500);
    }
});

module.exports = cptRouter;
