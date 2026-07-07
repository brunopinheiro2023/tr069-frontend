// Caminho do arquivo: frontend/src/app/core/components/icon-tooltip/icon-tooltip.component.ts

import { Component, Input, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';

/**
 * Tooltip de ícone com explicação ao passar o mouse.
 * Padrão utilizado nos botões de coleta do cpe-info-tab.
 *
 * Uso:
 *   <app-icon-tooltip
 *     icon="help_outline"
 *     title="Título do tooltip"
 *     description="Texto explicativo...">
 *   </app-icon-tooltip>
 *
 *   Ou com conteúdo customizado:
 *   <app-icon-tooltip icon="info" title="Título">
 *     <p>Conteúdo HTML...</p>
 *   </app-icon-tooltip>
 */
@Component({
  selector: 'app-icon-tooltip',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="icon-tooltip" role="tooltip" [attr.aria-label]="title">
      <span class="icon-tooltip__trigger material-symbols-rounded">
        {{ icon }}
      </span>
      <div class="icon-tooltip__panel">
        <p class="icon-tooltip__title">{{ title }}</p>
        <p *ngIf="description" class="icon-tooltip__description">{{ description }}</p>
        <div *ngIf="!description" class="icon-tooltip__description">
          <ng-content></ng-content>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .icon-tooltip {
      position: relative;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }

    .icon-tooltip__trigger {
      font-size: 18px;
      color: var(--text-muted, #94a3b8);
      cursor: help;
      user-select: none;
      transition: color var(--transition-fast, 150ms ease);
    }

    .icon-tooltip__trigger:hover {
      color: var(--accent-color, #6366f1);
    }

    .icon-tooltip__panel {
      position: absolute;
      left: 50%;
      bottom: calc(100% + 8px);
      transform: translateX(-50%);
      z-index: 50;
      width: 280px;
      max-width: 90vw;
      padding: var(--space-3, 12px);
      background-color: var(--bg-surface-raised, #1e293b);
      border: 1px solid var(--border-color, rgba(148, 163, 184, 0.15));
      border-radius: var(--radius-lg, 12px);
      box-shadow: var(--shadow-lg, 0 8px 24px rgba(0, 0, 0, 0.3));
      opacity: 0;
      visibility: hidden;
      pointer-events: none;
      transition: opacity var(--transition-fast, 150ms ease), visibility var(--transition-fast, 150ms ease);
    }

    .icon-tooltip:hover .icon-tooltip__panel,
    .icon-tooltip:focus-within .icon-tooltip__panel {
      opacity: 1;
      visibility: visible;
    }

    .icon-tooltip__panel::after {
      content: '';
      position: absolute;
      top: 100%;
      left: 50%;
      transform: translateX(-50%);
      border-width: 6px;
      border-style: solid;
      border-color: var(--bg-surface-raised, #1e293b) transparent transparent transparent;
    }

    .icon-tooltip__title {
      margin: 0 0 var(--space-1, 4px) 0;
      font-size: var(--text-sm, 14px);
      font-weight: var(--font-semibold, 600);
      color: var(--text-primary, #f8fafc);
      line-height: var(--leading-tight, 1.25);
    }

    .icon-tooltip__description {
      margin: 0;
      font-size: var(--text-xs, 12px);
      color: var(--text-secondary, #94a3b8);
      line-height: var(--leading-relaxed, 1.6);
    }

    .icon-tooltip__description ::ng-deep p {
      margin: 0 0 var(--space-2, 8px) 0;
    }

    .icon-tooltip__description ::ng-deep p:last-child {
      margin-bottom: 0;
    }
  `]
})
export class IconTooltipComponent {
  @Input() icon: string = 'help';
  @Input() title: string = '';
  @Input() description?: string;
}
