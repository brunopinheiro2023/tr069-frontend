import { Routes } from '@angular/router';
import { authGuard } from './core/guards/auth.guard';
import { guestGuard } from './core/guards/guest.guard';
const routes: Routes = [
  // A raiz manda para o dashboard (o Guard vai interceptar se não tiver logado)
  { path: '', redirectTo: '/dashboard', pathMatch: 'full' },

  // Rota pública de login
  {
    path: 'login',
    loadComponent: () => import('./features/login/login.component').then(m => m.LoginComponent),
    canActivate: [guestGuard]
  },

  // Rota protegida do Dashboard (Adicionando o canActivate)
  {
    path: 'dashboard',
    loadComponent: () => import('./features/dashboard/dashboard.component').then(m => m.DashboardComponent),
    canActivate: [authGuard]
  },

  // 2. NOVA ROTA: O ':serial' é o parâmetro dinâmico
  {
    path: 'dashboard/cpe/:serial',
    loadComponent: () => import('./features/dashboard/components/cpe-details/cpe-details.component').then(m => m.CpeDetailsComponent),
    canActivate: [authGuard]
  },

  // Rota de configurações do provedor (EP43)
  {
    path: 'provider-config',
    loadComponent: () =>
      import('./features/provider-config/provider-config.component')
        .then(m => m.ProviderConfigComponent),
    canActivate: [authGuard],
  },

  // Diagnósticos periódicos — destinos cadastrados pelo admin
  {
    path: 'diagnostic-targets',
    loadComponent: () =>
      import('./features/diagnostic-targets/diagnostic-targets.component')
        .then(m => m.DiagnosticTargetsComponent),
    canActivate: [authGuard],
  },

  // Rota fallback
  { path: '**', redirectTo: '/dashboard' }
];

export { routes };
