import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ButtonComponent } from '@app/core/components/button/button.component';

export interface NeighborScanResult {
  serialNumber?: string;
  neighboringWiFiResultCount?: number;
  channelSaturation?: ChannelSaturation;
  bands?: WifiBands;
  summary?: WifiSummary;
  timestamp?: string;
}

/** Estrutura de saturação de canal retornada pelo backend (wifiNeighborScanService). */
export interface ChannelSaturation {
  serialNumber?: string;
  manufacturer?: string;
  profile?: string;
  isRealData?: boolean;
  timestamp?: string;
  bands?: {
    '2.4GHz'?: BandSaturation;
    '5GHz'?: BandSaturation;
    [key: string]: BandSaturation | undefined;
  };
}

/** Saturação de uma banda (2.4GHz ou 5GHz). */
export interface BandSaturation {
  band: string;
  channels: Record<number, ChannelEntry>;
  totalNeighbors?: number;
  timestamp?: string;
  demo?: boolean;
  suggestion?: ChannelSuggestion;
  maxInterferenceScore?: number;
  bandwidthSuggestion?: string | null;
  bandwidthSuggestionReason?: string | null;
}

/** Entrada de canal na tabela de saturação. */
export interface ChannelEntry {
  channel: number;
  neighborCount: number;
  interferenceScore?: number;
  avgRssi?: number | null;
  noiseLevel?: number;
  congestionLevel?: string;
}

/** Sugestão de mudança de canal. */
export interface ChannelSuggestion {
  bestChannel: number;
  currentChannel: number;
  currentScore: number;
  bestScore: number;
  improvement: number;
  shouldChange: boolean;
  reason: string;
  parameterPath?: string;
}

/** Dados de bandas Wi-Fi do wifiAnalyzerService. */
export interface WifiBands {
  '2.4GHz'?: BandData;
  '5GHz'?: BandData;
  [key: string]: BandData | undefined;
}

/** Dados de uma banda do wifiAnalyzerService. */
export interface BandData {
  radio?: RadioData;
  congestion?: CongestionData;
  channelSuggestion?: {
    shouldChange: boolean;
    currentChannel: number;
    suggestedChannel: number;
    reason: string;
    source: string;
  };
  clientAnalysis?: ClientAnalysisEntry[];
  qualityDistribution?: Record<string, number>;
  totalClients?: number;
}

/** Dados de rádio brutos da CPE. */
export interface RadioData {
  channel?: number | null;
  status?: string | null;
  rssi?: number | null;
  snr?: number | null;
  noise?: number | null;
  utilization?: number | null;
  bandwidth?: string | null;
  autoChannelEnable?: boolean | null;
  txRate?: number | null;
  rxRate?: number | null;
  txPower?: number | null;
  bytesSent?: number | null;
  bytesReceived?: number | null;
  packetsSent?: number | null;
  packetsReceived?: number | null;
  errorsSent?: number | null;
  errorsReceived?: number | null;
  discardSent?: number | null;
  discardReceived?: number | null;
}

/** Dados de congestionamento de canal. */
export interface CongestionData {
  isCongested: boolean;
  severity: string;
  errorRate: number;
  discardRate: number;
  message: string;
}

/** Entrada de análise de cliente. */
export interface ClientAnalysisEntry {
  macAddress: string | null;
  ipAddress: string | null;
  quality: string;
  rssi: number | null;
  recommendation: string;
}

/** Sumário de diagnóstico Wi-Fi. */
export interface WifiSummary {
  totalClients?: number;
  hasCongestion?: boolean;
  criticalClients?: number;
}

/**
 * Dados de qualidade de rádio estruturados para exibição.
 * Todos os campos são opcionais pois dependem das capacidades do firmware.
 */
export interface RadioQuality {
  bandwidth: string | null;       // OperatingChannelBandwidth: ex. "20MHz", "80MHz", "Auto"
  snr: number | null;             // SNR em dB (proprietary X_TP_SNR - TP-Link)
  noise: number | null;           // Ruído de fundo em dBm
  utilization: number | null;     // Utilização do canal em % (X_TP_Utilization - TP-Link)
  txPower: number | null;         // Potência de transmissão em %
  channel: number | null;         // Canal atual (0 = auto mode)
  autoChannelEnable: boolean | null; // true quando CPE gerencia canal (modo automático)
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
               txPower: null, channel: null, autoChannelEnable: null, rssi: null,
               bandwidthSuggestion: null, bandwidthSuggestionReason: null };
    }

    const bandwidth    = typeof radio.bandwidth === 'string' && radio.bandwidth.length > 0 ? radio.bandwidth : null;

    // AutoChannelEnable: true quando a CPE gerencia o canal (modo automático)
    const autoChannelEnable = typeof radio.autoChannelEnable === 'boolean' ? radio.autoChannelEnable : null;

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

    // Canal: 0 em auto mode (AutoChannelEnable=true) é válido — manter 0.
    // 0 sem auto mode = parâmetro não preenchido — descarta (null).
    // Para 5GHz o menor canal válido é 36; para 2.4GHz é 1.
    const channelRaw = Number(radio.channel);
    const channelMin = band === '5GHz' ? 36 : 1;
    const channelMax = band === '5GHz' ? 165 : 13;
    let channel: number | null = null;
    if (radio.channel != null && !isNaN(channelRaw)) {
      if (channelRaw === 0 && autoChannelEnable === true) {
        channel = 0; // auto mode — manter 0
      } else if (channelRaw >= channelMin) {
        channel = this.sanitizeNumber(channelRaw, channelMin, channelMax);
      }
    }

    const rssiRaw = Number(radio.rssi);
    const rssi = (radio.rssi != null && !isNaN(rssiRaw) && rssiRaw < 0) ? this.sanitizeNumber(rssiRaw, -120, -1) : null;

    // Sugestão de largura de banda: lê diretamente do payload do backend
    // (wifiNeighborScanService.collectChannelSaturation → bands[band].bandwidthSuggestion).
    // Antes esta lógica era duplicada no frontend — agora o backend é a fonte única.
    const channelSatBand = this.channelSaturation?.bands?.[band];
    const bandwidthSuggestion = channelSatBand?.bandwidthSuggestion ?? null;
    const bandwidthSuggestionReason = channelSatBand?.bandwidthSuggestionReason ?? null;

    return { bandwidth, snr, noise, utilization, txPower, channel, autoChannelEnable, rssi,
             bandwidthSuggestion, bandwidthSuggestionReason };
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
      // Canais não sobrepostos em 2.4GHz (IEEE 802.11-2020, espaçamento 25 MHz)
      return [1, 6, 11];
    } else if (band === '5GHz') {
      // Canais preferenciais SEM DFS (UNII-1 + UNII-3) — mesma lista do backend
      // (wifiConstants.js PREFERRED_5G_NO_DFS). Canal 165 incluído (UNII-3, sem DFS).
      // Antes esta lista era [36, 44, 52, 60, 149, 157] — divergia do backend e
      // incluía canais DFS (52, 60) que o backend evita.
      return [36, 40, 44, 48, 149, 153, 157, 161, 165];
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
