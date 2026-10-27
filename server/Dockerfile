FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src
COPY public ./public

RUN mkdir -p /app/data && chown -R node:node /app
USER node

ENV PORT=8787
ENV NODE_ENV=production

EXPOSE 8787

VOLUME ["/app/data"]

CMD ["node", "src/index.js"]
