import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';

/**
 * Guard funcional que protege rotas exigindo autenticação.
 * Verifica se há um token armazenado; caso não haja, bloqueia o acesso
 * e redireciona o usuário para a página de login.
 */
export const authGuard: CanActivateFn = (route, state) => {
  const authService = inject(AuthService);
  const router = inject(Router);

  if (authService.getToken()) {
    return true; // Permite o acesso
  }

  // Bloqueia e redireciona criando uma UrlTree para a rota de login
  return router.createUrlTree(['/login']);
};
