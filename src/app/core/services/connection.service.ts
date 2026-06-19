import { Injectable, OnDestroy, Inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { BehaviorSubject, fromEvent, merge, Subscription } from 'rxjs';
import { ToastService } from './toast.service';

/**
 * Serviço responsável por monitorar o status da conexão de internet
 * e notificar a interface sobre quedas ou restaurações na rede.
 */
@Injectable({
  providedIn: 'root'
})
export class ConnectionService implements OnDestroy {
  private isOnlineStatus = new BehaviorSubject<boolean>(true);
  public isOnline$ = this.isOnlineStatus.asObservable();
  private sub = new Subscription();

  constructor(
    private toastService: ToastService,
    @Inject(PLATFORM_ID) private platformId: Object
  ) {
    // Garante que o navigator.onLine só seja acessado no navegador (prevenção SSR)
    if (isPlatformBrowser(this.platformId)) {
      this.isOnlineStatus.next(navigator.onLine);
      this.monitorConnection();
    }
  }

  private monitorConnection(): void {
    const online$ = fromEvent(window, 'online');
    const offline$ = fromEvent(window, 'offline');

    this.sub.add(
      merge(online$, offline$).subscribe((event: Event) => {
        const isOnline = event.type === 'online';
        this.isOnlineStatus.next(isOnline);

        if (isOnline) {
          this.toastService.success('Conexão com a Internet restaurada. Sistema operante.');
        } else {
          this.toastService.error('Sem conexão com a Internet. O sistema pode apresentar instabilidade.');
        }
      })
    );
  }

  ngOnDestroy(): void {
    this.sub.unsubscribe();
  }
}
