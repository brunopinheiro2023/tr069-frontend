// Caminho do arquivo: frontend/src/environments/environment.production.ts

export const environment = {
  production: true,
  // Em produção com Docker, o nginx faz proxy das rotas /api, /auth, /acs para o backend.
  // URL vazia = requisições relativas ao mesmo host (ex: /api/cpes → nginx → backend:3000)
  apiUrl: '',
  // Socket.IO conecta ao mesmo host/porta, o nginx faz o upgrade WebSocket automaticamente.
  wsUrl: ''
};
