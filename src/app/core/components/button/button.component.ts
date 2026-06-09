import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';

/**
 * Botão global do Design System (standalone).
 *
 * Funcionalidades:
 *  - Variantes visuais: 'primary' | 'secondary' | 'danger' | 'ghost'
 *  - Tamanhos: 'sm' | 'md' | 'lg'
 *  - Estado de loading: exibe spinner CSS embutido e aplica disabled + aria-busy
 *  - Ícone opcional (posição left ou right)
 *  - 100% responsivo: em mobile, preenche a largura disponível quando `block` é true
 *
 * Uso:
 *   <app-button variant="primary" [loading]="isSaving" (click)="save()">
 *     Salvar Configuração
 *   </app-button>
 */
@Component({
  selector: 'app-button',
  standalone: true,
  imports: [CommonModule],
  template: `
    <button
      [type]="type"
      class="app-btn"
      [class.app-btn--primary]="variant === 'primary'"
      [class.app-btn--secondary]="variant === 'secondary'"
      [class.app-btn--danger]="variant === 'danger'"
      [class.app-btn--ghost]="variant === 'ghost'"
      [class.app-btn--sm]="size === 'sm'"
      [class.app-btn--lg]="size === 'lg'"
      [class.app-btn--block]="block"
      [disabled]="disabled || loading"
      [attr.aria-busy]="loading"
      (click)="onClick($event)"
    >
      <span
        *ngIf="loading"
        class="app-btn__spinner"
        aria-hidden="true"
      ></span>

      <span
        *ngIf="iconLeft && !loading"
        class="app-btn__icon app-btn__icon--left material-symbols-rounded"
        aria-hidden="true"
      >
        {{ iconLeft }}
      </span>

      <span class="app-btn__label" [class.visually-hidden]="loading && hideLabelWhenLoading">
        <ng-content></ng-content>
      </span>

      <span
        *ngIf="iconRight && !loading"
        class="app-btn__icon app-btn__icon--right material-symbols-rounded"
        aria-hidden="true"
      >
        {{ iconRight }}
      </span>
    </button>
  `,
  styles: [`
    /* =============================================================================
       CAMINHO DO ARQUIVO: frontend/src/app/core/components/button/button.component.ts
       Estilos encapsulados no componente (SCSS-like com nesting via CSS).
       ============================================================================= */

    .app-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: var(--space-2);
      font-family: var(--font-family-base);
      font-weight: var(--font-semibold);
      font-size: var(--text-sm);
      line-height: var(--leading-tight);
      border: 1px solid transparent;
      border-radius: var(--radius-md);
      padding: var(--space-3) var(--space-5);
      cursor: pointer;
      transition: all var(--transition-fast);
      white-space: nowrap;
      user-select: none;
      position: relative;
      overflow: hidden;

      /* Acessibilidade: foco visível */
      &:focus-visible {
        outline: none;
        box-shadow: 0 0 0 3px var(--accent-light);
      }

      /* Estado disabled */
      &:disabled,
      &[aria-busy="true"] {
        opacity: 0.65;
        cursor: not-allowed;
        pointer-events: none;
      }
    }

    /* ---------------------------------------------------------------------------
       VARIANTES
       --------------------------------------------------------------------------- */
    .app-btn--primary {
      background-color: var(--accent-color);
      color: var(--text-on-accent);
      box-shadow: var(--shadow-sm);

      &:hover:not(:disabled) {
        background-color: var(--accent-hover);
        box-shadow: var(--shadow-md);
        transform: translateY(-1px);
      }

      &:active:not(:disabled) {
        transform: translateY(0);
        box-shadow: var(--shadow-xs);
      }
    }

    .app-btn--secondary {
      background-color: var(--bg-surface);
      color: var(--accent-color);
      border-color: var(--border-color);
      box-shadow: var(--shadow-xs);

      &:hover:not(:disabled) {
        background-color: var(--accent-light);
        border-color: var(--accent-color);
      }
    }

    .app-btn--danger {
      background-color: var(--accent-danger);
      color: var(--text-on-accent);
      box-shadow: var(--shadow-sm);

      &:hover:not(:disabled) {
        background-color: var(--accent-danger-hover);
        box-shadow: var(--shadow-md);
      }
    }

    .app-btn--ghost {
      background-color: transparent;
      color: var(--text-secondary);
      border-color: transparent;

      &:hover:not(:disabled) {
        background-color: var(--bg-body);
        color: var(--text-primary);
      }
    }

    /* ---------------------------------------------------------------------------
       TAMANHOS
       --------------------------------------------------------------------------- */
    .app-btn--sm {
      padding: var(--space-2) var(--space-3);
      font-size: var(--text-xs);
    }

    .app-btn--lg {
      padding: var(--space-4) var(--space-6);
      font-size: var(--text-base);
    }

    /* ---------------------------------------------------------------------------
       LARGURA TOTAL (mobile-friendly)
       --------------------------------------------------------------------------- */
    .app-btn--block {
      width: 100%;
    }

    /* ---------------------------------------------------------------------------
       SPINNER EMBUTIDO
       --------------------------------------------------------------------------- */
    .app-btn__spinner {
      display: inline-block;
      width: 1em;
      height: 1em;
      border: 2px solid currentColor;
      border-right-color: transparent;
      border-radius: 50%;
      animation: btn-spin 0.7s linear infinite;
      flex-shrink: 0;
    }

    @keyframes btn-spin {
      to { transform: rotate(360deg); }
    }

    /* ---------------------------------------------------------------------------
       ÍCONES
       --------------------------------------------------------------------------- */
    .app-btn__icon {
      font-size: 1.25em;
      line-height: 1;
      flex-shrink: 0;
    }

    .app-btn__label {
      display: inline-block;
    }

    .visually-hidden {
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
      border: 0;
    }
  `]
})
export class ButtonComponent {
  @Input() variant: 'primary' | 'secondary' | 'danger' | 'ghost' = 'primary';
  @Input() size: 'sm' | 'md' | 'lg' = 'md';
  @Input() type: 'button' | 'submit' | 'reset' = 'button';
  @Input() disabled = false;
  @Input() loading = false;
  @Input() block = false;
  @Input() iconLeft?: string;
  @Input() iconRight?: string;
  @Input() hideLabelWhenLoading = false;

  @Output() clicked = new EventEmitter<MouseEvent>();

  onClick(event: MouseEvent): void {
    if (!this.disabled && !this.loading) {
      this.clicked.emit(event);
    }
  }
}
