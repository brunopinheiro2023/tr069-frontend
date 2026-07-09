import { Component, Input, Output, EventEmitter, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormGroup } from '@angular/forms';
import { ButtonComponent } from '../../../../../../../core/components/button/button.component';
import { HelpToggleComponent } from '../../../../../../../core/components/help-toggle/help-toggle.component';
import { RADIO_CONSTANTS, WifiBand } from '../radio-constants';

/**
 * Card de configuração de rádio para uma banda (2.4GHz ou 5GHz).
 * Componente dumb — recebe o FormGroup pronto do parent e emite eventos.
 *
 * Inputs:
 *   - bandForm: FormGroup com os campos enable, channel, bandwidth, power + paths
 *   - band: '2.4GHz' | '5GHz'
 *   - isTR181: true = TP-Link TR-181 (potência % CPE-defined) | false = TR-098 (lista estática)
 *   - isSaving: estado de loading propagado pelo parent
 *   - txPowerSupported: CSV reportado pela CPE (ex: "25,50,100") — null até o 1º GPV
 *
 * Outputs:
 *   - save: emite quando o técnico clica em "Salvar Rádio"
 */
@Component({
  selector: 'app-radio-band-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, ReactiveFormsModule, ButtonComponent, HelpToggleComponent],
  templateUrl: './radio-band-card.component.html',
  styleUrls: ['./radio-band-card.component.scss'],
})
export class RadioBandCardComponent {
  @Input() bandForm!: FormGroup;
  @Input() band: WifiBand = '2.4GHz';
  @Input() isTR181 = true;
  @Input() isSaving = false;
  /** CSV com valores aceitos pela CPE, ex: "25,50,100". Null = usar fallback estático. */
  @Input() txPowerSupported: string | undefined = undefined;
  /** CPE está offline — bloqueia salvar config de rádio. */
  @Input() isCpeOffline: boolean = false;
  @Output() save = new EventEmitter<WifiBand>();

  /** Opções de canais conforme a banda */
  get channelOptions(): readonly number[] {
    return this.band === '2.4GHz' ? RADIO_CONSTANTS.CHANNELS_2G : RADIO_CONSTANTS.CHANNELS_5G;
  }

  /** Opções de largura de banda conforme a banda */
  get bandwidthOptions(): readonly string[] {
    return this.band === '2.4GHz' ? RADIO_CONSTANTS.BANDWIDTH_2G : RADIO_CONSTANTS.BANDWIDTH_5G;
  }

  /**
   * Opções de potência — dinâmicas quando TransmitPowerSupported foi coletado da CPE,
   * fallback estático caso contrário.
   */
  get powerOptions(): readonly string[] {
    if (this.isTR181 && this.txPowerSupported) {
      const dynamic = this.txPowerSupported
        .split(',')
        .map(v => v.trim())
        .filter(v => v !== '' && !isNaN(Number(v)));
      if (dynamic.length > 0) return dynamic;
    }
    return this.isTR181 ? RADIO_CONSTANTS.POWER_TR181 : RADIO_CONSTANTS.POWER_TR098;
  }

  /** Potência em percentual para ambos os protocolos */
  get powerUnit(): string {
    return '%';
  }

  /** Rótulo de banda para exibição */
  get bandLabel(): string {
    return RADIO_CONSTANTS.BAND_LABELS[this.band];
  }

  /** Ícone Material Symbols para a banda */
  get bandIcon(): string {
    return RADIO_CONSTANTS.BAND_ICONS[this.band];
  }

  /** Status do rádio (Up/Down) */
  get status(): string {
    return this.bandForm.get('status')?.value || 'Unknown';
  }

  /** Se o rádio está habilitado */
  get isEnabled(): boolean {
    return this.bandForm.get('enable')?.value ?? false;
  }

  /** Se há mudanças não salvas nesta banda (form dirty) */
  get hasChanges(): boolean {
    return this.bandForm.dirty;
  }

  /** Label do protocolo */
  get protocolLabel(): string {
    return this.isTR181 ? 'TR-181' : 'TR-098';
  }

  onSave(): void {
    this.save.emit(this.band);
  }
}
