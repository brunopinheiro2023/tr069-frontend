// Caminho: src/app/features/dashboard/components/cpe-details/components/
//           cpe-diagnostics-tab/wifi-saturation-chart/wifi-saturation-chart.component.ts

import { Component, Input, Output, EventEmitter, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ChannelSaturationBand, ChannelEntry, ChannelSuggestion } from '../../../../../../../core/models';

/**
 * Ponto de dado para renderização de uma barra no gráfico SVG.
 */
interface SaturationBar {
  channel: number;          // número do canal (1–13 para 2.4GHz; 36–161 para 5GHz)
  neighborCount: number;    // quantidade de redes vizinhas detectadas
  congestionLevel: string;  // 'Alto' | 'Médio' | 'Baixo'
  heightPercent: number;    // altura relativa da barra (0–100%)
  cssClass: string;         // classe CSS baseada no nível de congestionamento
  x: number;                // posição X no SVG (calculada dinamicamente)
  barWidth: number;         // largura da barra no SVG
}

/**
 * COMPONENTE DE GRÁFICO DE SATURAÇÃO DE CANAIS WI-FI (PILAR 4)
 *
 * Renderiza um gráfico de barras SVG mostrando o número de redes vizinhas por canal.
 * A altura de cada barra representa a densidade de redes no canal,
 * com coloração: verde (Baixo), amarelo (Médio), vermelho (Alto).
 *
 * Quando isDemo=true, exibe um banner de aviso indicando dados simulados.
 * O canal atual é destacado com uma borda e label especial.
 *
 * @example
 * <app-wifi-saturation-chart
 *   [saturationBand]="report.channelSaturation.bands['2.4GHz']"
 *   [currentChannel]="report.bands['2.4GHz'].channelSuggestion.currentChannel"
 *   [bandLabel]="'2.4 GHz'" />
 */
@Component({
  selector: 'app-wifi-saturation-chart',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './wifi-saturation-chart.component.html',
})
export class WifiSaturationChartComponent implements OnChanges {

  /** Dados de saturação para uma banda específica (2.4GHz ou 5GHz). */
  @Input() saturationBand: ChannelSaturationBand | null = null;

  /** Canal atualmente configurado no rádio (para destaque visual). */
  @Input() currentChannel: number | null = null;

  /** Label da banda para exibição no título (ex: '2.4 GHz', '5 GHz'). */
  @Input() bandLabel = '';

  /** True enquanto uma aplicação de canal está em andamento para esta banda. */
  @Input() isApplying = false;

  /** Emite quando o usuário confirma a aplicação automática de canal. */
  @Output() applyChannel = new EventEmitter<{ channel: number; parameterPath: string; band: string }>();

  /** Barras processadas prontas para renderização no template SVG. */
  bars: SaturationBar[] = [];

  /** Valor máximo de vizinhos para normalização das barras. */
  maxNeighborCount = 1;

  /** True se os dados são simulados (demo=true no backend). */
  isDemo = false;

  /** Dimensões fixas do SVG — permite cálculo preciso das posições X. */
  readonly SVG_WIDTH = 600;
  readonly SVG_HEIGHT = 160;
  readonly BAR_PADDING = 4; // px de espaço entre barras

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['saturationBand'] || changes['currentChannel']) {
      this.buildBars();
    }
  }

  /**
   * Processa os dados do backend e calcula as posições/alturas das barras SVG.
   * Chamado sempre que saturationBand ou currentChannel mudam.
   */
  private buildBars(): void {
    this.bars = [];

    if (!this.saturationBand || !this.saturationBand.channels) {
      return;
    }

    this.isDemo = this.saturationBand.demo === true;

    // Extrai e ordena os canais numericamente
    const channelEntries: ChannelEntry[] = Object.values(this.saturationBand.channels)
      .sort((a, b) => a.channel - b.channel);

    if (channelEntries.length === 0) return;

    // Calcula o máximo de vizinhos para normalizar as alturas (mínimo 1 para evitar div/0)
    this.maxNeighborCount = Math.max(1, ...channelEntries.map(c => c.neighborCount));

    // Distribui as barras uniformemente na largura do SVG
    const totalBars = channelEntries.length;
    const barWidth = Math.max(8, Math.floor((this.SVG_WIDTH - BAR_PADDING_TOTAL(totalBars)) / totalBars));

    this.bars = channelEntries.map((entry, index): SaturationBar => {
      const heightPercent = Math.max(5, (entry.neighborCount / this.maxNeighborCount) * 100);
      const x = index * (barWidth + this.BAR_PADDING);

      return {
        channel:       entry.channel,
        neighborCount: entry.neighborCount,
        congestionLevel: entry.congestionLevel,
        heightPercent,
        cssClass:      this.getCssClass(entry.congestionLevel, entry.channel),
        x,
        barWidth,
      };
    });
  }

  /**
   * Retorna a classe CSS de cor baseada no nível de congestionamento e se é o canal atual.
   * @param level 'Alto' | 'Médio' | 'Baixo'
   * @param channel número do canal
   */
  getCssClass(level: string, channel: number): string {
    const isCurrent = this.currentChannel === channel;
    if (isCurrent) return 'bar-current';
    if (level === 'Alto')  return 'bar-high';
    if (level === 'Médio') return 'bar-medium';
    return 'bar-low';
  }

  /**
   * Calcula a altura em pixels da barra no SVG (máximo 80% da altura para deixar espaço ao label).
   * @param heightPercent porcentagem relativa calculada em buildBars()
   */
  getBarHeightPx(heightPercent: number): number {
    return Math.floor((heightPercent / 100) * (this.SVG_HEIGHT * 0.8));
  }

  /**
   * Calcula a posição Y (topo) da barra no SVG para renderização de baixo para cima.
   * SVG cresce de cima para baixo, então invertemos.
   * @param heightPercent porcentagem relativa
   */
  getBarY(heightPercent: number): number {
    const heightPx = this.getBarHeightPx(heightPercent);
    return this.SVG_HEIGHT - heightPx - 20;
  }

  onApplyChannel(suggestion: ChannelSuggestion): void {
    this.applyChannel.emit({
      channel:       suggestion.bestChannel,
      parameterPath: suggestion.parameterPath,
      band:          this.saturationBand?.band ?? '',
    });
  }
}

/** Função auxiliar: calcula o total de padding para N barras. */
function BAR_PADDING_TOTAL(n: number): number {
  return (n - 1) * 4; // 4px entre cada barra
}
