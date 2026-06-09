import { Component } from '@angular/core';
import { Router, RouterOutlet } from '@angular/router';
import { CommonModule } from '@angular/common';
import { SidebarComponent } from './core/components/sidebar/sidebar.component';
import { HeaderComponent } from './core/components/header/header.component';
import { LoadingService } from './core/services/loading.service';
import { ToastContainerComponent } from './core/components/toast/toast-container.component';
import { Observable } from 'rxjs';

/**
 * Componente raiz da aplicação.
 * Responsável pelo layout wrapper (sidebar + header + content) e pelo
 * overlay de carregamento global gerenciado pelo LoadingService.
 */
@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    RouterOutlet,
    CommonModule,
    SidebarComponent,
    HeaderComponent,
    ToastContainerComponent,
  ],
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss'],
})
export class AppComponent {
  /** Estado de loading global (overlay em tela cheia) */
  globalLoading$: Observable<boolean>;

  /** Controla a visibilidade da sidebar em mobile */
  sidebarOpen = false;

  constructor(public router: Router, private loading: LoadingService) {
    this.globalLoading$ = this.loading.global$;
  }
}
