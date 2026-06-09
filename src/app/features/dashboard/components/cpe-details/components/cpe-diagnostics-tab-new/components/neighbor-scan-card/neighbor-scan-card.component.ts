import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ButtonComponent } from '@app/core/components/button/button.component';

export interface NeighborScanResult {
  serialNumber?: string;
  neighboringWiFiResultCount?: number;
  channelSaturation?: any;
  bands?: any;
  summary?: any;
  timestamp?: string;
}

/**
 * Dados de qualidade de rádio estruturados para exibição.
 * Todos os campos são opcionais pois dependem das capacidades do firmware.
 */
export interface RadioQuality {
  bandwidth: string | null;       // OperatingChannelBandwidth: ex. "20MHz", "80MHz"
  snr: number | null;             // SNR em dB (proprietary X_TP_SNR - TP-Link)
  noise: number | null;           // Ruído de fundo em dBm
  utilization: number | null;     // Utilização do canal em % (X_TP_Utilization - TP-Link)
  txPower: number | null;         // Potência de transmissão em %
  channel: number | null;         // Canal atual
  rssi: number | null;            // RSSI do rádio
  bandwidthSuggestion: string | null;  // Sugestão de largura de banda baseada em dados reais
  bandwidthSuggestionReason: string | null;  // Razão da sugestão
}

@Component({
  selector: 'app-neighbor-scan-card',
  standalone: true,
  imports: [CommonModule, ButtonComponent],
  templateUrl: './neighbor-scan-card.component.html',
  styleUrls: ['./neighbor-scan-card.component.scss']
})
export class NeighborScanCardComponent {
  @Input() serialNumber: string = '';
  @Input() readOnly: boolean = false;
  @Input() isSupported: boolean = true;
  @Input() isRunning: boolean = false;
  @Input() result: NeighborScanResult | null = null;
  @Input() history: any[] = [];

  @Output() runScan = new EventEmitter<void>();

  get hasRealData(): boolean {
    // Segurança: verifica se result existe e isRealData é estritamente true
    return this.result?.channelSaturation?.isRealData === true;
  }

  get neighborCount(): number {
    // Segurança: sanitiza para garantir número não negativo
    const count = this.result?.neighboringWiFiResultCount;
    return typeof count === 'number' && count >= 0 ? count : 0;
  }

  get hasSaturationData(): boolean {
    // Segurança: valida que channelSaturation é um objeto válido
    return !!(this.result?.channelSaturation && typeof this.result.channelSaturation === 'object');
  }

  get channelSaturation(): any {
    // Segurança: retorna null se não for um objeto válido
    if (!this.result?.channelSaturation || typeof this.result.channelSaturation !== 'object') {
      return null;
    }
    return this.result.channelSaturation;
  }

  /**
   * Estrutura real do backend: result.channelSaturation.bands['2.4GHz'].channels
   * channels é um OBJETO com chave = número do canal, valor = dados do canal.
   * Ordena por canal para exibição consistente.
   */
  get channels2g(): any[] {
    const channels = this.channelSaturation?.bands?.['2.4GHz']?.channels;
    if (!channels || typeof channels !== 'object') return [];
    return (Object.values(channels) as any[])
      .filter(c => c && typeof c === 'object' && typeof c.channel === 'number')
      .sort((a, b) => a.channel - b.channel);
  }

  /**
   * Estrutura real do backend: result.channelSaturation.bands['5GHz'].channels
   * channels é um OBJETO com chave = número do canal, valor = dados do canal.
   * Ordena por canal para exibição consistente.
   */
  get channels5g(): any[] {
    const channels = this.channelSaturation?.bands?.['5GHz']?.channels;
    if (!channels || typeof channels !== 'object') return [];
    return (Object.values(channels) as any[])
      .filter(c => c && typeof c === 'object' && typeof c.channel === 'number')
      .sort((a, b) => a.channel - b.channel);
  }

  get suggestion2g(): any {
    // Segurança: valida que suggestion é um objeto válido
    const suggestion = this.channelSaturation?.bands?.['2.4GHz']?.suggestion;
    return suggestion && typeof suggestion === 'object' ? suggestion : null;
  }

  get suggestion5g(): any {
    // Segurança: valida que suggestion é um objeto válido
    const suggestion = this.channelSaturation?.bands?.['5GHz']?.suggestion;
    return suggestion && typeof suggestion === 'object' ? suggestion : null;
  }

  get totalClients2g(): number {
    // Segurança: sanitiza para garantir número não negativo
    const clients = this.result?.bands?.['2.4GHz']?.totalClients;
    return typeof clients === 'number' && clients >= 0 ? clients : 0;
  }

  get totalClients5g(): number {
    // Segurança: sanitiza para garantir número não negativo
    const clients = this.result?.bands?.['5GHz']?.totalClients;
    return typeof clients === 'number' && clients >= 0 ? clients : 0;
  }

  get hasCongestion(): boolean {
    // summary está na raiz da resposta (result.summary), não dentro de channelSaturation
    return this.result?.summary?.hasCongestion === true;
  }

  get criticalClients(): number {
    // Segurança: sanitiza para garantir número não negativo
    const clients = this.result?.summary?.criticalClients;
    return typeof clients === 'number' && clients >= 0 ? clients : 0;
  }

  get lastScanTimestamp(): string {
    // Segurança: valida que timestamp é uma string válida
    const timestamp = this.result?.timestamp;
    return typeof timestamp === 'string' && timestamp.length > 0 ? timestamp : '';
  }

  /**
   * Extrai e estrutura os dados de qualidade do rádio 2.4GHz.
   * Fonte: result.bands['2.4GHz'].radio (via wifiCollectorService → extractRadioDataTr181)
   * Campos disponíveis confirmados nos parâmetros reais da CPE.
   */
  get radioQuality2g(): RadioQuality {
    return this.buildRadioQuality('2.4GHz');
  }

  /**
   * Extrai e estrutura os dados de qualidade do rádio 5GHz.
   * Fonte: result.bands['5GHz'].radio (via wifiCollectorService → extractRadioDataTr181)
   */
  get radioQuality5g(): RadioQuality {
    return this.buildRadioQuality('5GHz');
  }

  /**
   * Verifica se há dados de qualidade de rádio disponíveis (ao menos uma banda).
   */
  get hasRadioQualityData(): boolean {
    const r2 = this.result?.bands?.['2.4GHz']?.radio;
    const r5 = this.result?.bands?.['5GHz']?.radio;
    return !!(r2 && typeof r2 === 'object') || !!(r5 && typeof r5 === 'object');
  }

  /**
   * Constrói o objeto RadioQuality para uma banda a partir dos dados reais do backend.
   * Aplica sugestão de largura de banda baseada no score de interferência dos vizinhos.
   *
   * Lógica de sugestão de largura de banda (sem inventar dados):
   *  - 2.4GHz: canais sobrepostos (20MHz obrigatório) vs canais livres (40MHz possível)
   *    • 40MHz em 2.4GHz só é viável se os canais adjacentes estiverem livres (score < 0.3)
   *    • Em ambiente saturado, 20MHz reduz interferência entre-canal
   *  - 5GHz: 80MHz é padrão moderno; 160MHz exige canal limpo (score < 0.5)
   *    • Se score > 3.0: reduzir para 40MHz melhora robustez
   *    • Se score > 1.0: manter 80MHz ou considerar 40MHz
   *    • Se score ≤ 1.0: 80MHz ou 160MHz são adequados
   */
  private buildRadioQuality(band: string): RadioQuality {
    const radio = this.result?.bands?.[band]?.radio;

    if (!radio || typeof radio !== 'object') {
      return { bandwidth: null, snr: null, noise: null, utilization: null,
               txPower: null, channel: null, rssi: null,
               bandwidthSuggestion: null, bandwidthSuggestionReason: null };
    }

    const bandwidth    = typeof radio.bandwidth === 'string' && radio.bandwidth.length > 0 ? radio.bandwidth : null;

    // SNR: CPEs TP-Link retornam "0" quando X_TP_SNR não é suportado pelo firmware.
    // SNR 0 dB (sinal = ruído) é fisicamente impossível num rádio funcional — descarta como inválido.
    const snrRaw = Number(radio.snr);
    const snr = (radio.snr != null && !isNaN(snrRaw) && snrRaw > 0) ? this.sanitizeNumber(snrRaw, 1, 60) : null;

    // Noise: CPEs retornam "0" quando Stats.Noise não é suportado.
    // Valores válidos de ruído de fundo ficam tipicamente entre -100 e -50 dBm.
    // 0 ou positivo indica parâmetro não suportado — descarta.
    const noiseRaw = Number(radio.noise);
    const noise = (radio.noise != null && !isNaN(noiseRaw) && noiseRaw < -10) ? this.sanitizeNumber(noiseRaw, -120, -10) : null;

    const utilization  = radio.utilization != null ? this.sanitizeNumber(radio.utilization, 0, 100) : null;
    const txPower      = (radio.txPower != null && Number(radio.txPower) > 0) ? this.sanitizeNumber(radio.txPower, 1, 100) : null;

    // Canal: 0 significa parâmetro não preenchido pela CPE — descarta.
    // Para 5GHz o menor canal válido é 36; para 2.4GHz é 1.
    const channelRaw = Number(radio.channel);
    const channelMin = band === '5GHz' ? 36 : 1;
    const channelMax = band === '5GHz' ? 165 : 13;
    const channel = (radio.channel != null && !isNaN(channelRaw) && channelRaw >= channelMin) ? this.sanitizeNumber(channelRaw, channelMin, channelMax) : null;

    const rssiRaw = Number(radio.rssi);
    const rssi = (radio.rssi != null && !isNaN(rssiRaw) && rssiRaw < 0) ? this.sanitizeNumber(rssiRaw, -120, -1) : null;

    // Score de interferência máximo desta banda (pior canal) — dados reais da varredura
    const channelSatBand = this.channelSaturation?.bands?.[band];
    const maxScore = this.getMaxInterferenceScore(channelSatBand);
    const hasRealScan = this.hasRealData;

    const { suggestion: bandwidthSuggestion, reason: bandwidthSuggestionReason } =
      this.calcBandwidthSuggestion(band, bandwidth, maxScore, hasRealScan);

    return { bandwidth, snr, noise, utilization, txPower, channel, rssi,
             bandwidthSuggestion, bandwidthSuggestionReason };
  }

  /**
   * Retorna o maior interferenceScore entre todos os canais de uma banda.
   * Usado para avaliar o ambiente geral da banda, não apenas o canal atual.
   */
  private getMaxInterferenceScore(bandSaturation: any): number {
    if (!bandSaturation?.channels || typeof bandSaturation.channels !== 'object') return 0;
    const scores = Object.values(bandSaturation.channels)
      .map((ch: any) => (typeof ch?.interferenceScore === 'number' ? ch.interferenceScore : 0));
    return scores.length > 0 ? Math.max(...scores) : 0;
  }

  /**
   * Calcula sugestão de largura de banda baseada em dados REAIS.
   * NÃO sugere "automático" — apenas recomendações manuais com justificativa.
   * Retorna null quando não há dados suficientes para recomendar.
   *
   * Fontes dos dados usados:
   *  - bandwidth: OperatingChannelBandwidth (parâmetro TR-181 real da CPE)
   *  - maxScore: score ponderado calculado pelo wifiNeighborScanService (dados reais de scan)
   */
  private calcBandwidthSuggestion(
    band: string, bandwidth: string | null, maxScore: number, hasRealScan: boolean
  ): { suggestion: string | null; reason: string | null } {

    // Sem scan real não temos dados do ambiente para recomendar
    if (!hasRealScan) {
      return { suggestion: null, reason: 'Acione a varredura para obter recomendação de largura de banda' };
    }

    if (band === '2.4GHz') {
      // 2.4GHz: espectro estreito (83,5 MHz total para 11/13 canais)
      if (bandwidth === '40MHz' || bandwidth === '20MHz/40MHz') {
        if (maxScore > 1.0) {
          // 40MHz ocupa 2 canais não sobrepostos (ex: CH1+CH5) — em ambiente saturado é prejudicial
          return {
            suggestion: 'Reduzir para 20MHz',
            reason: `40MHz em 2.4GHz ocupa espectro de 2 canais. Score de interferência do ambiente: ${maxScore.toFixed(1)} — acima de 1.0. Reduzir para 20MHz melhora coexistência com vizinhos.`
          };
        }
        return {
          suggestion: null,
          reason: `40MHz adequado para o ambiente atual (score ${maxScore.toFixed(1)} ≤ 1.0 — baixa interferência).`
        };
      }
      if (bandwidth === '20MHz') {
        if (maxScore <= 0.5) {
          return {
            suggestion: null,
            reason: `20MHz está adequado. Ambiente com pouca interferência (score ${maxScore.toFixed(1)}) — 40MHz poderia ser considerado, mas alterações manuais devem ser avaliadas pelo técnico.`
          };
        }
        return {
          suggestion: null,
          reason: `20MHz correto para este ambiente (score ${maxScore.toFixed(1)} — interferência detectada).`
        };
      }
    }

    if (band === '5GHz') {
      if (bandwidth === '160MHz') {
        if (maxScore > 0.5) {
          return {
            suggestion: 'Reduzir para 80MHz',
            reason: `160MHz requer 8 canais contíguos livres. Score de interferência: ${maxScore.toFixed(1)} — ambiente com vizinhos ativos. 80MHz oferece melhor equilíbrio entre velocidade e estabilidade.`
          };
        }
        return {
          suggestion: null,
          reason: `160MHz adequado — ambiente com baixa interferência (score ${maxScore.toFixed(1)} ≤ 0.5).`
        };
      }
      if (bandwidth === '80MHz' || bandwidth === '40MHz/80MHz') {
        if (maxScore > 3.0) {
          return {
            suggestion: 'Considerar 40MHz',
            reason: `Score de interferência ${maxScore.toFixed(1)} está alto (> 3.0). Em ambientes muito saturados, 40MHz pode oferecer melhor estabilidade. Avalie com o técnico.`
          };
        }
        return {
          suggestion: null,
          reason: `80MHz adequado para o ambiente atual (score ${maxScore.toFixed(1)}).`
        };
      }
      if (bandwidth === '40MHz') {
        if (maxScore <= 1.0) {
          return {
            suggestion: null,
            reason: `40MHz em ambiente com baixa interferência (score ${maxScore.toFixed(1)}). 80MHz poderia ser avaliado pelo técnico para maior throughput.`
          };
        }
        return {
          suggestion: null,
          reason: `40MHz adequado dado o nível de interferência (score ${maxScore.toFixed(1)}).`
        };
      }
      if (bandwidth === '20MHz') {
        return {
          suggestion: null,
          reason: `20MHz em 5GHz limita o throughput significativamente. Avalie ampliar para 40MHz ou 80MHz se o ambiente permitir (score atual: ${maxScore.toFixed(1)}).`
        };
      }
    }

    // Largura de banda desconhecida ou não lida pela CPE
    return { suggestion: null, reason: null };
  }

  /**
   * Retorna a classe CSS de qualidade baseada no SNR.
   * Limiares baseados em padrões 802.11:
   *  Excelente ≥ 25 dB | Bom ≥ 15 dB | Regular ≥ 10 dB | Ruim < 10 dB
   */
  getSnrQuality(snr: number | null): string {
    if (snr === null) return 'unknown';
    if (snr >= 25) return 'excellent';
    if (snr >= 15) return 'good';
    if (snr >= 10) return 'fair';
    return 'poor';
  }

  getSnrLabel(snr: number | null): string {
    const level = this.getSnrQuality(snr);
    switch (level) {
      case 'excellent': return 'Excelente';
      case 'good':      return 'Bom';
      case 'fair':      return 'Regular';
      case 'poor':      return 'Ruim';
      default:          return 'N/D';
    }
  }

  /**
   * Retorna a classe CSS de qualidade baseada na utilização do canal.
   * > 80% = saturado | > 50% = moderado | ≤ 50% = normal
   */
  getUtilizationQuality(utilization: number | null): string {
    if (utilization === null) return 'unknown';
    if (utilization > 80) return 'poor';
    if (utilization > 50) return 'fair';
    return 'good';
  }

  getUtilizationLabel(utilization: number | null): string {
    const level = this.getUtilizationQuality(utilization);
    switch (level) {
      case 'poor': return 'Saturado';
      case 'fair': return 'Moderado';
      case 'good': return 'Normal';
      default:     return 'N/D';
    }
  }

  /**
   * Valida se um número é válido e está em uma faixa aceitável.
   * Segurança: previne NaN, Infinity e valores fora de faixa.
   */
  private sanitizeNumber(value: any, min: number = 0, max: number = Number.MAX_SAFE_INTEGER): number {
    if (value === null || value === undefined) return min;
    const num = Number(value);
    if (isNaN(num) || !isFinite(num)) return min;
    return Math.max(min, Math.min(max, num));
  }

  onRunScan(): void {
    // Segurança: não emite se readOnly está true
    if (!this.readOnly) {
      this.runScan.emit();
    }
  }

  /**
   * Nível de saturação baseado no score de interferência PONDERADO do backend.
   * Limiares idênticos ao classifyCongestionByScore() do wifiNeighborScanService.js:
   *   Alto  > 3.0 | Médio > 1.0 | Baixo ≤ 1.0
   * Também aceita contagem simples (demo data sem score).
   */
  getCongestionLevel(countOrScore: number): string {
    const val = this.sanitizeNumber(countOrScore, 0, 1000);
    if (val === 0) return 'empty';
    if (val <= 1.0) return 'low';
    if (val <= 3.0) return 'medium';
    return 'high';
  }

  /**
   * Rótulo textual correspondente ao nível de saturação.
   * Usado para exibir dentro das barras de progresso.
   */
  getCongestionLabel(countOrScore: number): string {
    const level = this.getCongestionLevel(countOrScore);
    switch (level) {
      case 'empty':  return 'Livre';
      case 'low':    return 'Baixa';
      case 'medium': return 'Média';
      case 'high':   return 'Alta';
      default:       return '';
    }
  }

  getCongestionColor(level: string): string {
    // Segurança: valida que level é uma string válida
    if (typeof level !== 'string') return '#64748b';
    
    switch (level) {
      case 'empty':  return '#e2e8f0';
      case 'low':    return '#22c55e';
      case 'medium': return '#f59e0b';
      case 'high':   return '#ef4444';
      default:       return '#64748b';
    }
  }

  /**
   * Largura proporcional da barra usando o interferenceScore real (max útil = 5.0).
   * Para dados demo sem score, usa neighborCount com max = 10.
   */
  getCongestionWidth(score: number, max: number = 5): number {
    const sanitizedScore = this.sanitizeNumber(score, 0, 1000);
    const sanitizedMax   = this.sanitizeNumber(max, 1, 1000);
    if (sanitizedMax === 0) return 0;
    return Math.min((sanitizedScore / sanitizedMax) * 100, 100);
  }

  formatTimestamp(timestamp: string): string {
    // Segurança: valida timestamp antes de criar Date
    if (!timestamp || typeof timestamp !== 'string') return '';
    
    try {
      const date = new Date(timestamp);
      
      // Segurança: valida se a data é válida
      if (isNaN(date.getTime())) return '';
      
      return date.toLocaleString('pt-BR');
    } catch (error) {
      console.error('[NeighborScanCard] Erro ao formatar timestamp:', error);
      return '';
    }
  }

  getChannelRecommendation(band: string): string {
    // Segurança: valida band parameter
    if (typeof band !== 'string' || (band !== '2.4GHz' && band !== '5GHz')) {
      return 'Parâmetro de banda inválido';
    }
    
    const suggestion = band === '2.4GHz' ? this.suggestion2g : this.suggestion5g;
    if (!suggestion) return 'Sem dados para recomendação (acione a varredura)';

    // Estrutura real do backend: { bestChannel, currentChannel, currentScore, bestScore,
    //                               improvement, shouldChange, reason, parameterPath }
    if (suggestion.shouldChange === false) {
      const currentChannel = this.sanitizeNumber(suggestion.currentChannel, 1, 165);
      const currentScore   = this.sanitizeNumber(suggestion.currentScore, 0, 1000);
      return `Canal ${currentChannel} já é o melhor disponível (score ${currentScore.toFixed(1)})`;
    }

    // Sanitiza e usa o campo reason do backend se disponível (string já formatada)
    if (typeof suggestion.reason === 'string' && suggestion.reason.length > 0 && suggestion.reason.length < 200) {
      return suggestion.reason;
    }

    // Fallback com campos individuais sanitizados
    const bestChannel    = this.sanitizeNumber(suggestion.bestChannel, 1, 165);
    const currentChannel = this.sanitizeNumber(suggestion.currentChannel, 1, 165);
    const bestScore      = this.sanitizeNumber(suggestion.bestScore, 0, 1000);
    const improvement    = this.sanitizeNumber(suggestion.improvement, 0, 1000);
    
    return `Mudar canal ${currentChannel} → ${bestChannel} (redução de ${improvement.toFixed(1)} no score, de ${this.sanitizeNumber(suggestion.currentScore, 0, 1000).toFixed(1)} para ${bestScore.toFixed(1)})`;
  }

  getNonOverlappingChannels(band: string): number[] {
    // Segurança: valida band parameter
    if (band === '2.4GHz') {
      return [1, 6, 11]; // Canais não sobrepostos em 2.4GHz
    } else if (band === '5GHz') {
      return [36, 44, 52, 60, 149, 157]; // Canais não sobrepostos em 5GHz (DFS)
    }
    
    // Segurança: retorna array vazio para banda inválida
    return [];
  }

  isNonOverlappingChannel(channel: number, band: string): boolean {
    // Segurança: valida channel e band antes de processar
    const sanitizedChannel = this.sanitizeNumber(channel, 1, 165);
    const validChannels = this.getNonOverlappingChannels(band);
    
    return validChannels.includes(sanitizedChannel);
  }
}
