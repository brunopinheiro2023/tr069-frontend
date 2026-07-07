// Caminho do arquivo: frontend/src/app/core/components/info-tooltip/info-tooltip.component.ts

import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

/**
 * Tooltip informativo padronizado do Design System.
 *
 * Modelo: card escuro com ícone moderno, título e descrição.
 * Uso:
 *   <app-info-tooltip
 *     icon="help"
 *     title="Como funcionam as coletas"
 *     description="Texto explicativo...">
 *   </app-info-tooltip>
 *
 *   Ou com projeção de conteúdo:
 *   <app-info-tooltip icon="info" title="Título">
 *     <p>Descrição customizada.</p>
 *   </app-info-tooltip>
 */
@Component({
  selector: 'app-info-tooltip',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="info-tooltip" role="note" [attr.aria-label]="title">
      <span class="info-tooltip__icon material-symbols-rounded" aria-hidden="true">
        {{ icon }}
      </span>
      <div class="info-tooltip__content">
        <h4 class="info-tooltip__title">{{ title }}</h4>
        <p *ngIf="description" class="info-tooltip__description">{{ description }}</p>
        <div *ngIf="!description" class="info-tooltip__description">
          <ng-content></ng-content>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .info-tooltip {
      display: flex;
      align-items: flex-start;
      gap: var(--space-3);
      padding: var(--space-4);
      background-color: var(--bg-surface-raised, rgba(30, 41, 59, 0.7));
      border: 1px solid var(--border-color, rgba(148, 163, 184, 0.15));
      border-radius: var(--radius-lg, 12px);
      box-shadow: var(--shadow-md, 0 4px 12px rgba(0, 0, 0, 0.25));
      backdrop-filter: blur(8px);
      transition: transform var(--transition-fast), box-shadow var(--transition-fast);
    }

    .info-tooltip:hover {
      transform: translateY(-1px);
      box-shadow: var(--shadow-lg, 0 8px 24px rgba(0, 0, 0, 0.3));
    }

    .info-tooltip__icon {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      width: 32px;
      height: 32px;
      font-size: 18px;
      color: var(--accent-color, #6366f1);
      background: linear-gradient(135deg, var(--accent-light, rgba(99, 102, 241, 0.15)) 0%, transparent 100%);
      border-radius: var(--radius-md, 8px);
    }

    .info-tooltip__content {
      display: flex;
      flex-direction: column;
      gap: var(--space-1);
      min-width: 0;
    }

    .info-tooltip__title {
      margin: 0;
      font-size: var(--text-sm, 14px);
      font-weight: var(--font-semibold, 600);
      color: var(--text-primary, #f8fafc);
      line-height: var(--leading-tight, 1.25);
    }

    .info-tooltip__description {
      margin: 0;
      font-size: var(--text-xs, 12px);
      color: var(--text-secondary, #94a3b8);
      line-height: var(--leading-relaxed, 1.6);
    }

    .info-tooltip__description ::ng-deep p {
      margin: 0 0 var(--space-2) 0;
    }

    .info-tooltip__description ::ng-deep p:last-child {
      margin-bottom: 0;
    }
  `]
})
export class InfoTooltipComponent {
  @Input() icon: string = 'info';
  @Input() title: string = '';
  @Input() description?: string;
}
