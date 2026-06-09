import { Routes } from '@angular/router';
import { DashboardComponent } from './features/dashboard/dashboard.component';
import { LoginComponent } from './features/login/login.component';
import { AuthGuard } from './core/guards/auth.guard';
import { CpeDetailsComponent } from './features/dashboard/components/cpe-details/cpe-details.component';
const routes: Routes = [
  // A raiz manda para o dashboard (o Guard vai interceptar se não tiver logado)
  { path: '', redirectTo: '/dashboard', pathMatch: 'full' },

  // Rota pública de login
  { path: 'login', component: LoginComponent },

  // Rota protegida do Dashboard (Adicionando o canActivate)
  { path: 'dashboard', component: DashboardComponent, canActivate: [AuthGuard] },

  // 2. NOVA ROTA: O ':serial' é o parâmetro dinâmico
  { path: 'dashboard/cpe/:serial', component: CpeDetailsComponent, canActivate: [AuthGuard] },

  // Rota fallback
  { path: '**', redirectTo: '/dashboard' }
];

export { routes };


