// =============================================================================
// CAMINHO DO ARQUIVO: frontend/src/app/core/interceptors/auth.interceptor.ts
// =============================================================================
// Interceptor de autenticação funcional (Angular 17+).
// Injeta o token JWT em todas as requisições e intercepta erros de resposta,
// notificando o técnico via Toastr em caso de sessão expirada ou servidor
// indisponível.
// =============================================================================

import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { AuthService } from '../services/auth.service';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { ToastrService } from 'ngx-toastr';

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
    catchError((error) => {
      try {
        if (error.status === 401) {
          // Sessão expirada ou token inválido
          toastr.error('Sessão expirada. Faça login novamente.', 'Autenticação');
          authService.logout();
          router.navigate(['/login']);
        } else if (error.status === 403) {
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
