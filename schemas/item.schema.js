const ItemBodySchema = {
    nombre: { type: 'string', required: true },
    precio: { type: 'number', required: true },
    en_oferta: { type: 'boolean', required: false, default: false }
};

module.exports = {
    ItemBodySchema
};
