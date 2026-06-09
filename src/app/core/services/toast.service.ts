import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { ToastNotification } from '../models';

export type ToastType = 'success' | 'info' | 'error' | 'warning';

export interface Toast extends ToastNotification {
  type: ToastType;
  dismissible?: boolean;
}

/**
 * Serviço global de notificações toast.
 * Singleton disponível em toda a aplicação via providedIn: 'root'.
 * Substitui a lógica de toast local do DashboardComponent,
 * permitindo que qualquer componente dispare alertas.
 */
@Injectable({ providedIn: 'root' })
export class ToastService {
  private toastsSubject = new BehaviorSubject<Toast[]>([]);
  private idCounter = 0;

  /** Observable da lista de toasts ativos (para o ToastContainerComponent). */
  readonly toasts$: Observable<Toast[]> = this.toastsSubject.asObservable();

  /**
   * Exibe um toast na tela.
   * @param message  Texto da notificação
   * @param type     Tipo visual: success | info | error | warning
   * @param duration Duração em ms antes de auto-fechar (padrão: 4000ms)
   */
  show(message: string, type: ToastType = 'info', duration = 4000): void {
    const id = this.idCounter++;
    const toast: Toast = { id, message, type };

    this.toastsSubject.next([...this.toastsSubject.value, toast]);

    if (duration > 0) {
      setTimeout(() => this.dismiss(id), duration);
    }
  }

  /** Atalho para mensagens de sucesso. */
  success(message: string, duration = 4000): void {
    this.show(message, 'success', duration);
  }

  /** Atalho para mensagens de erro. */
  error(message: string, duration = 5000): void {
    this.show(message, 'error', duration);
  }

  /** Atalho para alertas (warning, mais duradouro). */
  warning(message: string, duration = 6000): void {
    this.show(message, 'warning', duration);
  }

  /** Atalho para informativos. */
  info(message: string, duration = 4000): void {
    this.show(message, 'info', duration);
  }

  /** Remove um toast específico pelo ID. */
  dismiss(id: number): void {
    this.toastsSubject.next(this.toastsSubject.value.filter(t => t.id !== id));
  }
}
