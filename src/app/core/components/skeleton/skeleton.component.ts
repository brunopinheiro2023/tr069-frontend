import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

/**
 * Componente de Skeleton Loader global (standalone).
 *
 * Funcionalidades:
 *  - Suporta múltiplas formas: 'text' | 'circle' | 'rect' | 'card' | 'table-row'
 *  - Largura configurável (px, %, rem) — default 100%
 *  - Altura configurável — default conforme a forma
 *  - Repetição automática (count): útil para simular múltiplas linhas de texto
 *    ou linhas de tabela enquanto os dados carregam.
 *
 * Uso:
 *   <!-- Texto simples -->
 *   <app-skeleton shape="text" width="60%"></app-skeleton>
 *
 *   <!-- Múltiplas linhas (parágrafo) -->
 *   <app-skeleton shape="text" width="100%" [count]="3"></app-skeleton>
 *
 *   <!-- Avatar -->
 *   <app-skeleton shape="circle" width="40px"></app-skeleton>
 *
 *   <!-- Card -->
 *   <app-skeleton shape="card" height="120px"></app-skeleton>
 *
 *   <!-- Linha de tabela -->
 *   <app-skeleton shape="table-row" [count]="5"></app-skeleton>
 */
@Component({
  selector: 'app-skeleton',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div
      class="skeleton-wrapper"
      [class.skeleton-wrapper--inline]="inline"
    >
      <div
        *ngFor="let _ of repeats"
        class="skeleton-item"
        [class.skeleton-item--text]="shape === 'text'"
        [class.skeleton-item--text-lg]="shape === 'text-lg'"
        [class.skeleton-item--circle]="shape === 'circle'"
        [class.skeleton-item--rect]="shape === 'rect'"
        [class.skeleton-item--card]="shape === 'card'"
        [class.skeleton-item--table-row]="shape === 'table-row'"
        [style.width]="width"
        [style.height]="height"
        [attr.aria-hidden]="true"
      ></div>
    </div>
  `,
  styles: [`
    /* =============================================================================
       CAMINHO DO ARQUIVO: frontend/src/app/core/components/skeleton/skeleton.component.ts
       ============================================================================= */

    .skeleton-wrapper {
      display: flex;
      flex-direction: column;
      gap: var(--space-2);
      width: 100%;
    }

    .skeleton-wrapper--inline {
      display: inline-flex;
      flex-direction: row;
      align-items: center;
      gap: var(--space-2);
    }

    .skeleton-item {
      background-color: var(--border-color);
      border-radius: var(--radius-sm);
      position: relative;
      overflow: hidden;
      flex-shrink: 0;
    }

    /* Efeito shimmer pseudo-elemento */
    .skeleton-item::after {
      content: '';
      position: absolute;
      inset: 0;
      background: linear-gradient(
        90deg,
        transparent 0%,
        rgba(255, 255, 255, 0.35) 50%,
        transparent 100%
      );
      transform: translateX(-100%);
      animation: skeleton-shimmer 1.6s infinite;
    }

    @keyframes skeleton-shimmer {
      100% { transform: translateX(100%); }
    }

    /* ---------------------------------------------------------------------------
       Variações de forma
       --------------------------------------------------------------------------- */
    .skeleton-item--text {
      height: 1em;
      border-radius: var(--radius-xs);
    }

    .skeleton-item--text-lg {
      height: 1.5em;
      border-radius: var(--radius-xs);
    }

    .skeleton-item--circle {
      border-radius: 50%;
      aspect-ratio: 1 / 1;
    }

    .skeleton-item--rect {
      border-radius: var(--radius-sm);
      aspect-ratio: 16 / 9;
    }

    .skeleton-item--card {
      border-radius: var(--radius-lg);
      min-height: 120px;
    }

    .skeleton-item--table-row {
      height: 48px;
      border-radius: var(--radius-xs);
    }
  `]
})
export class SkeletonComponent {
  @Input() shape: 'text' | 'text-lg' | 'circle' | 'rect' | 'card' | 'table-row' = 'text';
  @Input() width: string = '100%';
  @Input() height?: string;
  @Input() count = 1;
  @Input() inline = false;

  get repeats(): number[] {
    return Array.from({ length: this.count }, (_, i) => i);
  }
}
