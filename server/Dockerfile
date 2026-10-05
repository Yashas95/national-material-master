# ==============================================================================
# Multi-stage Dockerfile for NUMMF Backend API
# ==============================================================================

# ------------------------------------------------------------------------------
# Stage 1: Base Dependencies
# ------------------------------------------------------------------------------
FROM node:22-alpine AS base

WORKDIR /app

# Install build dependencies if needed
RUN apk add --no-cache libc6-compat

# Copy package descriptors
COPY package*.json ./

# Install all dependencies (including dev for building)
RUN npm ci

# ------------------------------------------------------------------------------
# Stage 2: Development (Hot-Reloading with tsx)
# ------------------------------------------------------------------------------
FROM base AS development

WORKDIR /app

COPY . .

EXPOSE 4000

CMD ["npm", "run", "dev"]

# ------------------------------------------------------------------------------
# Stage 3: Builder
# ------------------------------------------------------------------------------
FROM base AS builder

WORKDIR /app

COPY . .

RUN npm run build

# Prune dev dependencies for lean production container
RUN npm prune --production

# ------------------------------------------------------------------------------
# Stage 4: Production
# ------------------------------------------------------------------------------
FROM node:22-alpine AS production

WORKDIR /app

ENV NODE_ENV=production

# Security: Run as unprivileged node user
USER node

# Copy production dependencies and compiled artifacts
COPY --chown=node:node package*.json ./
COPY --chown=node:node --from=builder /app/node_modules ./node_modules
COPY --chown=node:node --from=builder /app/dist ./dist

EXPOSE 4000

CMD ["node", "dist/index.js"]
