FROM node:22-bookworm-slim
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile && pnpm typecheck
# Browser control: the worker drives a real headless Chromium. Install the
# matching browser + OS libraries into the image so browser.navigate works
# on a fresh clone with no host setup. Adds build time and image size; a
# dedicated browser pod can split this out later.
RUN cd apps/worker && node ../../node_modules/playwright-core/cli.js install --with-deps chromium
CMD ["pnpm", "dev:api"]
