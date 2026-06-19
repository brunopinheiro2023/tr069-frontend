import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';

/**
 * Guard funcional para rotas públicas (como Login).
 * Verifica se o usuário JÁ está logado. Se estiver, redireciona
 * para o dashboard em vez de mostrar a tela de login novamente.
 */
export const guestGuard: CanActivateFn = (route, state) => {
  const authService = inject(AuthService);
  const router = inject(Router);

  if (authService.getToken()) {
    return router.createUrlTree(['/dashboard']); // Já está logado, manda pro dashboard
  }

  return true; // Não está logado, permite acessar a tela de login
};
