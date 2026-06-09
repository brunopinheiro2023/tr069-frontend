# ═══════════════════════════════════════════════════════════════
# STAGE 1: BUILD — Compila o Angular em produção
# ═══════════════════════════════════════════════════════════════
FROM node:20-alpine AS builder

WORKDIR /app

# Copia dependências primeiro para aproveitar cache de layers
COPY package*.json ./
RUN npm install

# Copia todo o código-fonte e compila em modo produção
# O angular.json troca environment.ts por environment.production.ts
COPY . .
RUN npm run build

# ═══════════════════════════════════════════════════════════════
# STAGE 2: SERVE — Nginx serve os arquivos estáticos
# ═══════════════════════════════════════════════════════════════
FROM nginx:1.27-alpine

# Remove a configuração padrão do nginx
RUN rm /etc/nginx/conf.d/default.conf

# Copia a configuração customizada (proxy para backend + SPA routing)
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Angular 17 com o builder 'application' gera os arquivos em dist/<projeto>/browser/
COPY --from=builder /app/dist/tr069/browser /usr/share/nginx/html

# Porta HTTP
EXPOSE 80

# Nginx roda em foreground (necessário para Docker)
CMD ["nginx", "-g", "daemon off;"]
