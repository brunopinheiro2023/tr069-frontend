import { HttpInterceptorFn, HttpErrorResponse } from '@angular/common/http';
import { throwError, timer } from 'rxjs';
import { retry } from 'rxjs/operators';

/**
 * Interceptor para tentativas automáticas (retries) em caso de falhas no servidor (5xx).
 * Utiliza a estratégia de Exponential Backoff para não sobrecarregar o backend.
 */
export const retryInterceptor: HttpInterceptorFn = (req, next) => {
  const MAX_RETRIES = 2;
  const INITIAL_DELAY_MS = 1000; // Base do cálculo para o delay

  // OTIMIZAÇÃO (Idempotência): Apenas requisições de leitura (GET) sofrem retry.
  // Impede a duplicação de dados e acionamentos acidentais em rotas POST/PUT/DELETE.
  if (req.method !== 'GET') {
    return next(req);
  }

  return next(req).pipe(
    retry({
      count: MAX_RETRIES,
      delay: (error: HttpErrorResponse, retryCount: number) => {
        // Tenta reenviar apenas se for um erro na faixa 500-599 (Server Error)
        if (error.status >= 500 && error.status < 600) {
          // Delay Exponencial: 1ª tentativa = 2s, 2ª tentativa = 4s
          const delayTime = Math.pow(2, retryCount) * INITIAL_DELAY_MS;
          console.warn(`[Retry Interceptor] Falha na requisição (${error.status}). Tentativa ${retryCount} de ${MAX_RETRIES} em ${delayTime}ms...`);
          return timer(delayTime);
        }

        // Repassa imediatamente erros 4xx (Client Error) ou outros
        return throwError(() => error);
      }
    })
  );
};
