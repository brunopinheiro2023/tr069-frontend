// Caminho do arquivo: frontend/src/app/core/components/help-toggle/help-toggle.component.ts

import { Component, Input, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IconTooltipComponent } from '../icon-tooltip/icon-tooltip.component';

/**
 * Componente padronizado para toggles com título e descrição em tooltip.
 * Ícone de ajuda aparece ao lado do título; ao passar o mouse, a descrição é exibida.
 *
 * Uso:
 *   <app-help-toggle
 *     title="Airtime Fairness (ATF)"
 *     description="Distribui o tempo de transmissão de forma justa entre os clientes.">
 *   </app-help-toggle>
 */
@Component({
  selector: 'app-help-toggle',
  standalone: true,
  imports: [CommonModule, IconTooltipComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="help-toggle">
      <span class="help-toggle__title">{{ title }}</span>
      <app-icon-tooltip
        class="help-toggle__tooltip"
        icon="help"
        [title]="title"
        [description]="description">
      </app-icon-tooltip>
    </div>
  `,
  styles: [`
    .help-toggle {
      display: inline-flex;
      align-items: center;
      gap: var(--space-1, 4px);
    }

    .help-toggle__title {
      font-weight: var(--font-medium, 500);
      color: var(--text-primary, #f8fafc);
      font-size: var(--text-sm, 14px);
    }

    .help-toggle__tooltip {
      display: inline-flex;
      align-items: center;
    }
  `]
})
export class HelpToggleComponent {
  @Input() title: string = '';
  @Input() description: string = '';
}
