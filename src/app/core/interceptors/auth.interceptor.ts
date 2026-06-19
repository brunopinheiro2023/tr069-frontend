// =============================================================================
// CAMINHO DO ARQUIVO: frontend/src/app/core/interceptors/auth.interceptor.ts
// =============================================================================
// Interceptor de autenticação funcional (Angular 17+).
// Injeta o token JWT em todas as requisições e intercepta erros de resposta,
// notificando o técnico via Toastr em caso de sessão expirada ou servidor
// indisponível.
// =============================================================================

import { HttpInterceptorFn, HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { AuthService } from '../services/auth.service';
import { Router } from '@angular/router';
import { BehaviorSubject, catchError, filter, switchMap, take, throwError } from 'rxjs';
import { ToastrService } from 'ngx-toastr';

let isRefreshing = false;
let refreshTokenSubject = new BehaviorSubject<string | null>(null);

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const authService = inject(AuthService);
  const router = inject(Router);
  const toastr = inject(ToastrService);

  const token = authService.getToken();

  // Injeta o token JWT no cabeçalho Authorization se existir
  if (token) {
    req = req.clone({
      setHeaders: {
        Authorization: `Bearer ${token}`
      }
    });
  }

  // Passa a requisição adiante e intercepta erros de resposta
  return next(req).pipe(
    catchError((error: HttpErrorResponse) => {

      // Lógica de Renovação de Token (Refresh Token) invisível
      if (error.status === 401 && !req.url.includes('/auth/login') && !req.url.includes('/auth/refresh')) {
        if (!isRefreshing) {
          isRefreshing = true;
          refreshTokenSubject.next(null);

          return authService.refreshToken().pipe(
            switchMap((response: any) => {
              isRefreshing = false;
              const newToken = response.token;
              authService.setToken(newToken);
              refreshTokenSubject.next(newToken);

              // Refaz a requisição original com o novo token
              const retryReq = req.clone({ setHeaders: { Authorization: `Bearer ${newToken}` } });
              return next(retryReq);
            }),
            catchError((refreshError) => {
              isRefreshing = false;
              // Libera requests em fila com null para que não fiquem travados
              refreshTokenSubject.next(null);
              toastr.error('Sessão expirada. Faça login novamente.', 'Autenticação');
              authService.logout();
              router.navigate(['/login']);
              return throwError(() => refreshError);
            })
          );
        } else {
          // Se já estiver renovando, aguarda o novo token na fila (Subject) e tenta novamente
          return refreshTokenSubject.pipe(
            filter(token => token !== null),
            take(1),
            switchMap(token => next(req.clone({ setHeaders: { Authorization: `Bearer ${token}` } })))
          );
        }
      }

      try {
        if (error.status === 403) {
          // Token válido mas sem permissão para o recurso
          toastr.warning('Você não tem permissão para esta ação.', 'Acesso Negado');
        } else if (error.status === 0) {
          // Erro de rede / servidor indisponível (CORS ou backend fora)
          toastr.error('Servidor indisponível. Verifique a conexão.', 'Erro de Rede');
        } else if (error.status >= 500) {
          // Erros internos do servidor
          toastr.error('Erro interno do servidor. Tente novamente mais tarde.', 'Erro do Servidor');
        }
      } catch (toastrErr) {
        console.error('[authInterceptor] Falha ao exibir notificação:', toastrErr);
      }
      return throwError(() => error);
    })
  );
};
