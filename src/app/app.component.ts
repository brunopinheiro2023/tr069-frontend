import { Component } from '@angular/core';
import { Router, RouterOutlet } from '@angular/router';
import { CommonModule } from '@angular/common';
import { SidebarComponent } from './core/components/sidebar/sidebar.component';
import { HeaderComponent } from './core/components/header/header.component';
import { LoadingService } from './core/services/loading.service';
import { ToastContainerComponent } from './core/components/toast/toast-container.component';
import { Observable, filter } from 'rxjs';
import { SwUpdate, VersionReadyEvent, UnrecoverableStateEvent } from '@angular/service-worker';
import { ToastService } from './core/services/toast.service';
import { ConnectionService } from './core/services/connection.service';

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

  constructor(
    public router: Router,
    private loading: LoadingService,
    private swUpdate: SwUpdate,
    private toastService: ToastService,
    private connectionService: ConnectionService // Instancia e inicia o monitoramento de rede
  ) {
    this.globalLoading$ = this.loading.global$;
    this.checkForUpdates();
  }

  /**
   * Verifica se há atualizações do Service Worker disponíveis.
   */
  private checkForUpdates(): void {
    if (this.swUpdate.isEnabled) {
      this.swUpdate.versionUpdates.pipe(
        filter((evt): evt is VersionReadyEvent => evt.type === 'VERSION_READY')
      ).subscribe(() => {
        this.toastService.info('Nova versão do sistema disponível. A página será recarregada em instantes.');
        setTimeout(() => window.location.reload(), 4000);
      });

      this.swUpdate.unrecoverable.subscribe((event: UnrecoverableStateEvent) => {
        this.toastService.error(`Estado irrecuperável do cache: ${event.reason}. Forçando recarregamento do sistema...`);
        setTimeout(() => window.location.reload(), 2500);
      });
    }
  }
}
