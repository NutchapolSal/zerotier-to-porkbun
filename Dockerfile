FROM node:24-bookworm
ENV LANG=C.UTF-8
ENV NODE_ENV=production
ENV DEBIAN_FRONTEND=noninteractive
WORKDIR /app
COPY --link package.json package-lock.json ./
RUN npm ci
COPY --link src ./src
CMD ["node", "src/index.ts"]