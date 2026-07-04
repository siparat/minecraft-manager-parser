FROM mcr.microsoft.com/playwright:v1.60.0-noble AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json prisma.config.ts ./
COPY prisma ./prisma
COPY src ./src

ENV FIRST_DATABASE_URL="postgresql://user:pass@localhost:5432/parser"
ENV DATABASE_URL="postgresql://user:pass@localhost:5432/parser"

RUN npm run generate \
	&& npm run build \
	&& npm prune --omit=dev

FROM mcr.microsoft.com/playwright:v1.60.0-noble AS runtime

ENV NODE_ENV=production
ENV BROWSER_HEADLESS=true

WORKDIR /app/data

COPY --from=build /app/package*.json /app/
COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/dist /app/dist
COPY --from=build /app/generated /app/generated
COPY --from=build /app/prisma /app/prisma

CMD ["node", "/app/dist/daemon.js"]

