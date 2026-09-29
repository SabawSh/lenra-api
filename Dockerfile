FROM node:20-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./

RUN npm ci

COPY tsconfig.json ./
COPY shim ./shim
COPY src ./src
COPY scripts ./scripts

ENV NODE_ENV=production

EXPOSE 4000

CMD ["npm", "start"]
