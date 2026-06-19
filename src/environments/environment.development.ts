export const environment = {
  production: false,
  // A API URL deve ser vazia para que as requisições (ex: /api/cpe)
  // sejam enviadas para o mesmo host do Angular (localhost:4200) e o proxy intercepte.
  apiUrl: '',
  wsUrl: 'http://localhost:4200' // O proxy também cuidará do WebSocket.
};
