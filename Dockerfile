# lenra-api image. Requires lenra-content-pipeline at /lenra-content-pipeline (content-import imports).
#
# GitHub Actions (repo root = lenra-api):
#   docker build -t lenra-api:tag .
#   (workflow checks out lenra-content-pipeline beside src/)
#
# Local monorepo:
#   cd .. && docker build -f lenra-api/Dockerfile --build-arg API_DIR=lenra-api -t lenra-api:tag .

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

COPY lenra-content-pipeline /lenra-content-pipeline

ENV NODE_ENV=production

EXPOSE 4000

CMD ["npm", "start"]
