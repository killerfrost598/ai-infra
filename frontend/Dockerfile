FROM node:20-alpine AS builder
WORKDIR /app
# BACKEND_INTERNAL_URL must be available at build time so Next.js bakes the
# correct rewrite destination into routes-manifest.json.
ARG BACKEND_INTERNAL_URL=http://backend:8000
ARG NEXT_PUBLIC_INFERIX_API_KEY=
ENV BACKEND_INTERNAL_URL=$BACKEND_INTERNAL_URL
ENV NEXT_PUBLIC_INFERIX_API_KEY=$NEXT_PUBLIC_INFERIX_API_KEY
COPY package.json package-lock.json* ./
RUN --mount=type=cache,target=/root/.npm npm ci --frozen-lockfile
COPY . .
RUN --mount=type=cache,target=/app/.next/cache npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
EXPOSE 3000
CMD ["node", "server.js"]
