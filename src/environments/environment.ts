export const environment = {
  production: true,
  // Em produção, o Nginx ou outro reverse proxy servirá o frontend e o backend
  // sob o mesmo domínio, então a URL relativa (vazia) continua correta.
  apiUrl: '',
  wsUrl: '' // Em produção, o WebSocket também será relativo ao domínio principal.
};
