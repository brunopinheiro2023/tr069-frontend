import { Component, Input, Output, EventEmitter, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ButtonComponent } from '../button/button.component';

/** Bloqueia UI enquanto uma operação crítica está em curso (apply / collect). */
export type TabLoaderVariant =
  | 'overlay'   // position:fixed fullscreen — bloqueia toda a UI (ex: aplicar config)
  | 'card';     // inline no fluxo da aba   — coleta via CR com progresso e cancelamento

@Component({
  selector: 'app-tab-loader',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, ButtonComponent],
  templateUrl: './tab-loader.component.html',
  styleUrls: ['./tab-loader.component.scss'],
})
export class TabLoaderComponent {
  /** Título principal exibido abaixo do spinner */
  @Input() title = 'Aguarde...';

  /** Subtítulo / mensagem de status dinâmico */
  @Input() subtitle = '';

  /**
   * overlay — posição fixed fullscreen, bloqueia toda a UI (sem cancelamento)
   * card    — inline no fluxo da aba, com barra de progresso e botão cancelar
   */
  @Input() variant: TabLoaderVariant = 'overlay';

  /** Exibe barra de progresso (útil apenas para variant='card') */
  @Input() showProgress = false;

  /** Valor do progresso: 0–100 */
  @Input() progress = 0;

  /** Texto abaixo da barra de progresso */
  @Input() progressHint = '';

  /** Exibe botão Cancelar (útil apenas para variant='card') */
  @Input() cancelable = false;

  /** Emitido ao clicar em Cancelar */
  @Output() cancel = new EventEmitter<void>();

  onCancel(): void {
    this.cancel.emit();
  }
}
