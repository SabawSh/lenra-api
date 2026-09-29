# lenra-api image. Content-import loads dictionary helpers that import
# /lenra-content-pipeline/src/difficulty/constants (vendored under vendor/).
#
# CI / single-repo:  docker build -t lenra-api:tag .
# Local:  cd lenra-api && docker build -t lenra-api:tag .

ARG API_DIR=.

FROM node:20-bookworm-slim

ARG API_DIR=.

WORKDIR /app

COPY ${API_DIR}/package.json ${API_DIR}/package-lock.json ./

RUN npm ci

COPY ${API_DIR}/tsconfig.json ./
COPY ${API_DIR}/shim ./shim
COPY ${API_DIR}/src ./src
COPY ${API_DIR}/scripts ./scripts

# Default: vendored slice (CI). Monorepo build may pass PIPELINE_DIR=lenra-content-pipeline.
COPY ${API_DIR}/vendor/lenra-content-pipeline /lenra-content-pipeline

ENV NODE_ENV=production

EXPOSE 4000

CMD ["npm", "start"]
