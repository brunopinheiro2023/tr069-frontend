// Caminho do arquivo: frontend/src/environments/environment.ts

export const environment = {
  production: false,
  // URL base para as requisições HTTP (API REST e Auth)
  // Em desenvolvimento, a API está rodando localmente na porta 3000. Certifique-se de que o backend esteja configurado para aceitar requisições CORS dessa origem.
  apiUrl: 'http://localhost:3000',
  // URL para a conexão do WebSocket (Tempo Real)
  // Em desenvolvimento, o WebSocket também está rodando localmente na porta 3000. Certifique-se de que o backend esteja configurado para aceitar conexões WebSocket dessa origem.
  wsUrl: 'http://localhost:3000'
};
