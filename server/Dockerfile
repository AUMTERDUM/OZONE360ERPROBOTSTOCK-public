FROM node:20-alpine

WORKDIR /app

# Build tools required for native modules (sqlite3 uses node-gyp)
RUN apk add --no-cache python3 make g++ su-exec

COPY package*.json ./
COPY prisma ./prisma/
COPY prisma.config.ts ./

RUN npm ci

RUN npx prisma generate

COPY . .

# Create required directories and set ownership to the built-in 'node' user
RUN mkdir -p uploads backups data && chown -R node:node /app

EXPOSE 3001

# Fix volume ownership at runtime (volumes may be created as root),
# then drop to 'node' for security
# Use migrate deploy in production (safe, no data loss). Falls back to db push only if no migrations folder.
CMD ["sh", "-c", "chown -R node:node /app/data /app/uploads /app/backups && exec su-exec node sh -c 'if [ -d prisma/migrations ]; then npx prisma migrate deploy; else npx prisma db push; fi && npm run start'"]
