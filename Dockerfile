# Usar una imagen Alpine de Node.js ultra-ligera
FROM node:18-alpine

# Definir directorio de trabajo en el contenedor
WORKDIR /usr/src/app

# Copiar el package.json
COPY package.json ./

# Copiar directorios lógicos y archivos
COPY index.js ./
COPY lib/ ./lib/
COPY schemas/ ./schemas/
COPY dependencies/ ./dependencies/
COPY routers/ ./routers/

# Exponer el puerto del microframework
EXPOSE 8000

# Variables de entorno recomendadas para producción
ENV NODE_ENV=production

# Ejecutar el servidor sin dependencias externas
CMD ["node", "index.js"]
