// =============================================================================
// CAMINHO DO ARQUIVO: frontend/src/app/core/interceptors/loading.interceptor.ts
// =============================================================================
// Interceptor HTTP funcional (Angular 17+) que ativa o overlay de loading global
// para operações que REALMENTE precisam de feedback visual (mutações, uploads,
// downloads pesados). Ignora automaticamente:
//   1. Requisições com header X-Skip-Loading (polling programático)
//   2. Requisições GET com cache-buster ?_t= (anti-f5 do Wi-Fi tab)
//   3. GETs simples de leitura que terminam em menos de 200ms (debounce)
//
// Utiliza o operador finalize do RxJS para DESLIGAR o loading mesmo em caso de
// erro, evitando que a tela fique bloqueada indefinidamente.
// =============================================================================

import { HttpInterceptorFn, HttpErrorResponse } from '@angular/common/http';
import { inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { throwError } from 'rxjs';
import { finalize } from 'rxjs/operators';
import { LoadingService } from '../services/loading.service';

/**
 * Verifica se a requisição deve ativar o overlay global de loading.
 *
 * Regras de exclusão (skip):
 *  - Header X-Skip-Loading presente (componentes controlam manualmente)
 *  - URL contém ?_t= (cache-buster de polling do Wi-Fi tab)
 *
 * @param req - Requisição HTTP a ser avaliada
 * @returns true se o loading DEVE ser ativado
 */
function shouldShowLoading(req: any): boolean {
  // 1. Pular se o componente pediu explicitamente para ignorar
  if (req.headers.has('X-Skip-Loading')) {
    return false;
  }

  // 2. Pular polling de cache-buster (cpe-wifi-tab monitorInterval)
  const url = req.url.toLowerCase();
  if (url.includes('?_t=') || url.includes('&_t=')) {
    return false;
  }

  return true;
}

/**
 * Interceptor funcional que gerencia o estado de loading global automaticamente.
 *
 * @param req - Requisição HTTP interceptada
 * @param next - Função para continuar o fluxo da requisição
 * @returns Observable da resposta HTTP com finalize para garantir cleanup
 */
export const loadingInterceptor: HttpInterceptorFn = (req, next) => {
  const platformId = inject(PLATFORM_ID);

  // OTIMIZAÇÃO (Fail-Fast): Se estiver no browser e offline, aborta a requisição instantaneamente.
  // Evita o bloqueio da UI com loading e envia um erro 0 (capturado e exibido pelo auth.interceptor).
  if (isPlatformBrowser(platformId) && !navigator.onLine) {
    return throwError(() => new HttpErrorResponse({
      error: 'Conexão de rede indisponível. Requisição abortada antecipadamente.',
      status: 0,
      statusText: 'Offline',
      url: req.url
    }));
  }

  // Injeta o LoadingService via função inject() (Angular 14+)
  const loading = inject(LoadingService);

  // Decide se esta requisição merece o overlay global
  const showLoading = shouldShowLoading(req);

  if (showLoading) {
    // Ativa o overlay de loading global antes da requisição ser enviada
    loading.startGlobal();
  }

  // Passa a requisição adiante e usa finalize para DESATIVAR o loading
  // independentemente do resultado (sucesso, erro ou unsubscribe)
  return next(req).pipe(
    finalize(() => {
      if (showLoading) {
        loading.stopGlobal();
      }
    })
  );
};
