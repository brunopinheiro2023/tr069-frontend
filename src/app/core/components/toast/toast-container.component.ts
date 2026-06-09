import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Observable } from 'rxjs';
import { ToastService, Toast } from '../../services/toast.service';

/**
 * Container global de notificações toast.
 * Deve ser incluído UMA VEZ no app.component.html (fora do router-outlet).
 * Renderiza todos os toasts ativos gerenciados pelo ToastService.
 */
@Component({
  selector: 'app-toast-container',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="toast-container" aria-live="polite" aria-atomic="false">
      @for (toast of toasts$ | async; track toast.id) {
        <div
          class="toast-box"
          [class]="toast.type"
          role="alert"
          (click)="dismiss(toast.id)"
          title="Clique para fechar"
        >
          <div class="toast-content">
            @switch (toast.type) {
              @case ('success') {
                <span class="material-symbols-rounded icon">check_circle</span>
              }
              @case ('warning') {
                <span class="material-symbols-rounded icon">warning</span>
              }
              @case ('error') {
                <span class="material-symbols-rounded icon">error</span>
              }
              @default {
                <span class="material-symbols-rounded icon">swap_horizontal_circle</span>
              }
            }
            <span class="toast-message">{{ toast.message }}</span>
            <button class="toast-close" (click)="dismiss(toast.id); $event.stopPropagation()" aria-label="Fechar">
              <span class="material-symbols-rounded">close</span>
            </button>
          </div>
        </div>
      }
    </div>
  `,
  styles: [`
    .toast-container {
      position: fixed;
      bottom: 24px;
      right: 24px;
      z-index: 9999;
      display: flex;
      flex-direction: column;
      gap: 10px;
      max-width: 420px;
      pointer-events: none;
    }

    .toast-box {
      pointer-events: all;
      background: var(--bg-surface-elevated);
      border-radius: var(--radius-md);
      box-shadow: 0 8px 24px rgba(0,0,0,0.15);
      border-left: 4px solid var(--border-color);
      animation: toast-slide-in 0.25s ease;
      cursor: pointer;
      transition: opacity 0.2s;

      &:hover { opacity: 0.92; }

      &.success { border-left-color: var(--accent-success); }
      &.error   { border-left-color: var(--accent-danger); }
      &.warning { border-left-color: var(--accent-warning); }
      &.info    { border-left-color: var(--accent-color); }
    }

    .toast-content {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 12px 14px;
    }

    .icon {
      font-size: 20px;
      flex-shrink: 0;
      .success & { color: var(--accent-success); }
      .error &   { color: var(--accent-danger); }
      .warning & { color: var(--accent-warning); }
      .info &    { color: var(--accent-color); }
    }

    .toast-message {
      flex: 1;
      font-size: 13px;
      line-height: 1.4;
      color: var(--text-primary);
    }

    .toast-close {
      background: none;
      border: none;
      cursor: pointer;
      padding: 0;
      color: var(--text-muted);
      display: flex;
      align-items: center;
      span { font-size: 16px; }
      &:hover { color: var(--text-primary); }
    }

    @keyframes toast-slide-in {
      from { transform: translateX(110%); opacity: 0; }
      to   { transform: translateX(0);    opacity: 1; }
    }
  `]
})
export class ToastContainerComponent {
  readonly toasts$: Observable<Toast[]>;

  constructor(private toastService: ToastService) {
    this.toasts$ = this.toastService.toasts$;
  }

  dismiss(id: number): void {
    this.toastService.dismiss(id);
  }
}
