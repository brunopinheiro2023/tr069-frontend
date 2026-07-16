import {
  Component,
  Input,
  Output,
  EventEmitter,
  ChangeDetectionStrategy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ButtonComponent } from '@app/core/components/button/button.component';
import {
  NON_OVERLAPPING_2G,
  PREFERRED_5G_NO_DFS,
  CHANNEL_RANGE,
} from '@app/core/constants/wifi.constants';
import { sanitizeNumber } from '@app/core/utils/sanitize';
import {
  ChannelSaturationBand as BandSaturation,
  ChannelEntry,
  ChannelSuggestion,
  RadioQuality,
  WifiInsight,
} from '@app/core/models';

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

export interface NeighborScanResult {
  serialNumber?: string;
  neighboringWiFiResultCount?: number;
  channelSaturation?: ChannelSaturation;
  bands?: WifiBands;
  summary?: WifiSummary;
  timestamp?: string;
  // Metadata do último scan (data/hora real da coleta + origem on-demand/periódica)
  lastScanInfo?: {
    timestamp: string;
    scanSource: 'scheduler' | 'on-demand' | null;
    triggeredBy: string | null;
    neighborCount: number;
  } | null;
}

@Component({
  selector: 'app-neighbor-scan-card',
  standalone: true,
  imports: [CommonModule, ButtonComponent],
  templateUrl: './neighbor-scan-card.component.html',
  styleUrls: ['./neighbor-scan-card.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NeighborScanCardComponent {
  @Input() serialNumber: string = '';
  @Input() readOnly: boolean = false;
  @Input() isSupported: boolean = true;
  @Input() isRunning: boolean = false;
  @Input() history: NeighborScanResult[] = [];
  /** Insights actionable vindos do wifi-analysis-tab (sugestões de otimização). */
  @Input() insights: WifiInsight[] = [];
  /** Estado de loading do apply (desabilita botões durante envio). */
  @Input() applyInProgress: boolean = false;
  /** Emite quando o usuário clica em "Aplicar" numa sugestão. */
  @Output() applyRecommendation = new EventEmitter<WifiInsight>();

  // Setter memoiza channels e radioQuality quando result muda — evita recálculo a cada CD cycle
  private _result: NeighborScanResult | null = null;
  private _channels2g: ChannelEntry[] = [];
  private _channels5g: ChannelEntry[] = [];
  private _radioQuality2g: RadioQuality = this.emptyRadioQuality();
  private _radioQuality5g: RadioQuality = this.emptyRadioQuality();

  @Input() set result(value: NeighborScanResult | null) {
    this._result = value;
    this.recomputeMemoizedFields();
  }
  get result(): NeighborScanResult | null {
    return this._result;
  }

  @Output() runScan = new EventEmitter<void>();

  /** Recalcula campos memoizados a partir do novo _result. Chamado apenas no setter. */
  private recomputeMemoizedFields(): void {
    const cs = this._result?.channelSaturation;
    this._channels2g = this.extractChannels(cs, '2.4GHz');
    this._channels5g = this.extractChannels(cs, '5GHz');
    this._radioQuality2g = this.buildRadioQuality('2.4GHz');
    this._radioQuality5g = this.buildRadioQuality('5GHz');
  }

  /** Extrai e ordena canais de uma banda a partir do channelSaturation. */
  private extractChannels(
    cs: ChannelSaturation | null | undefined,
    band: '2.4GHz' | '5GHz',
  ): ChannelEntry[] {
    const channels = cs?.bands?.[band]?.channels;
    if (!channels || typeof channels !== 'object') return [];
    return Object.values(channels)
      .filter(
        (c): c is ChannelEntry =>
          !!c && typeof c === 'object' && typeof c.channel === 'number',
      )
      .sort((a, b) => a.channel - b.channel);
  }

  get hasRealData(): boolean {
    // Segurança: verifica se result existe e isRealData é estritamente true
    return this._result?.channelSaturation?.isRealData === true;
  }

  get neighborCount(): number {
    // Segurança: sanitiza para garantir número não negativo
    const count = this._result?.neighboringWiFiResultCount;
    return typeof count === 'number' && count >= 0 ? count : 0;
  }

  get hasSaturationData(): boolean {
    // Segurança: valida que channelSaturation é um objeto válido
    return !!(
      this._result?.channelSaturation &&
      typeof this._result.channelSaturation === 'object'
    );
  }

  get channelSaturation(): ChannelSaturation | null {
    // Segurança: retorna null se não for um objeto válido
    if (
      !this._result?.channelSaturation ||
      typeof this._result.channelSaturation !== 'object'
    ) {
      return null;
    }
    return this._result.channelSaturation;
  }

  /**
   * Canais 2.4GHz memoizados no setter de result — não recalcula a cada CD cycle.
   * Estrutura real do backend: result.channelSaturation.bands['2.4GHz'].channels
   */
  get channels2g(): ChannelEntry[] {
    return this._channels2g;
  }

  /**
   * Canais 5GHz memoizados no setter de result — não recalcula a cada CD cycle.
   * Estrutura real do backend: result.channelSaturation.bands['5GHz'].channels
   */
  get channels5g(): ChannelEntry[] {
    return this._channels5g;
  }

  /**
   * Canais 5GHz para exibição no grid — filtra canais completamente vazios
   * (sem vizinhos E sem interferência) para evitar exibir 25 barras ociosas.
   * Mantém sempre: canais com neighborCount > 0, canais com interferenceScore > 0,
   * canais não-sobrepostos (UNII-1/3) e o canal atual.
   */
  get displayChannels5g(): ChannelEntry[] {
    const currentCh = this.suggestion5g?.currentChannel;
    return this._channels5g.filter((c) => {
      if (c.neighborCount > 0) return true;
      if (c.interferenceScore && c.interferenceScore > 0) return true;
      if (this.isNonOverlappingChannel(c.channel, '5GHz')) return true;
      if (c.channel === currentCh) return true;
      return false;
    });
  }

  /**
   * Resumo da banda 2.4GHz para exibição no header do gráfico:
   * total de redes vizinhas, pior canal (maior score) e melhor canal (menor score).
   */
  get bandSummary2g(): {
    totalNeighbors: number;
    worstChannel: number | null;
    bestChannel: number | null;
  } {
    return this.buildBandSummary(this._channels2g);
  }

  /** Resumo da banda 5GHz (mesma lógica do bandSummary2g). */
  get bandSummary5g(): {
    totalNeighbors: number;
    worstChannel: number | null;
    bestChannel: number | null;
  } {
    return this.buildBandSummary(this.displayChannels5g);
  }

  /**
   * Constrói resumo de uma lista de canais: soma de redes vizinhas,
   * canal com maior interferência (pior) e menor interferência (melhor).
   */
  private buildBandSummary(channels: ChannelEntry[]): {
    totalNeighbors: number;
    worstChannel: number | null;
    bestChannel: number | null;
  } {
    if (!channels || channels.length === 0) {
      return { totalNeighbors: 0, worstChannel: null, bestChannel: null };
    }
    const totalNeighbors = channels.reduce(
      (sum, c) => sum + (c.neighborCount || 0),
      0,
    );
    let worst = channels[0];
    let best = channels[0];
    for (const c of channels) {
      const score = c.interferenceScore ?? 0;
      if (score > (worst.interferenceScore ?? 0)) worst = c;
      if (score < (best.interferenceScore ?? Infinity)) best = c;
    }
    return {
      totalNeighbors,
      worstChannel: worst.channel,
      bestChannel: best.channel,
    };
  }

  get suggestion2g(): ChannelSuggestion | null {
    // Segurança: valida que suggestion é um objeto válido
    const suggestion = this.channelSaturation?.bands?.['2.4GHz']?.suggestion;
    return suggestion && typeof suggestion === 'object' ? suggestion : null;
  }

  get suggestion5g(): ChannelSuggestion | null {
    // Segurança: valida que suggestion é um objeto válido
    const suggestion = this.channelSaturation?.bands?.['5GHz']?.suggestion;
    return suggestion && typeof suggestion === 'object' ? suggestion : null;
  }

  get totalClients2g(): number {
    // Segurança: sanitiza para garantir número não negativo
    const clients = this._result?.bands?.['2.4GHz']?.totalClients;
    return typeof clients === 'number' && clients >= 0 ? clients : 0;
  }

  get totalClients5g(): number {
    // Segurança: sanitiza para garantir número não negativo
    const clients = this._result?.bands?.['5GHz']?.totalClients;
    return typeof clients === 'number' && clients >= 0 ? clients : 0;
  }

  get hasCongestion(): boolean {
    // summary está na raiz da resposta (result.summary), não dentro de channelSaturation
    return this._result?.summary?.hasCongestion === true;
  }

  get criticalClients(): number {
    // Segurança: sanitiza para garantir número não negativo
    const clients = this._result?.summary?.criticalClients;
    return typeof clients === 'number' && clients >= 0 ? clients : 0;
  }

  get lastScanTimestamp(): string {
    // Prioriza lastScanInfo.timestamp (data/hora real do scan de vizinhança)
    // sobre timestamp genérico (momento da chamada do endpoint — menos preciso).
    const scanTs = this._result?.lastScanInfo?.timestamp;
    if (typeof scanTs === 'string' && scanTs.length > 0) return scanTs;
    // Fallback: timestamp genérico da análise (compatibilidade com respostas sem lastScanInfo)
    const ts = this._result?.timestamp;
    return typeof ts === 'string' && ts.length > 0 ? ts : '';
  }

  /**
   * Rótulo legível da origem do scan: 'Automática' (scheduler) ou 'Manual' (on-demand).
   * Retorna string vazia se lastScanInfo não estiver disponível.
   */
  get scanSourceLabel(): string {
    const source = this._result?.lastScanInfo?.scanSource;
    if (source === 'scheduler') return 'Automática';
    if (source === 'on-demand') return 'Manual';
    return '';
  }

  /**
   * Dados de qualidade do rádio 2.4GHz memoizados no setter de result.
   * Fonte: result.bands['2.4GHz'].radio (via wifiCollectorService → extractRadioDataTr181)
   */
  get radioQuality2g(): RadioQuality {
    return this._radioQuality2g;
  }

  /**
   * Dados de qualidade do rádio 5GHz memoizados no setter de result.
   * Fonte: result.bands['5GHz'].radio (via wifiCollectorService → extractRadioDataTr181)
   */
  get radioQuality5g(): RadioQuality {
    return this._radioQuality5g;
  }

  /**
   * Verifica se há dados de qualidade de rádio disponíveis (ao menos uma banda).
   */
  get hasRadioQualityData(): boolean {
    const r2 = this._result?.bands?.['2.4GHz']?.radio;
    const r5 = this._result?.bands?.['5GHz']?.radio;
    return !!(r2 && typeof r2 === 'object') || !!(r5 && typeof r5 === 'object');
  }

  /** Retorna um RadioQuality vazio para inicialização. */
  private emptyRadioQuality(): RadioQuality {
    return {
      bandwidth: null,
      snr: null,
      noise: null,
      utilization: null,
      txPower: null,
      channel: null,
      autoChannelEnable: null,
      rssi: null,
      bandwidthSuggestion: null,
      bandwidthSuggestionReason: null,
    };
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
    const radio = this._result?.bands?.[band]?.radio;

    if (!radio || typeof radio !== 'object') {
      return {
        bandwidth: null,
        snr: null,
        noise: null,
        utilization: null,
        txPower: null,
        channel: null,
        autoChannelEnable: null,
        rssi: null,
        bandwidthSuggestion: null,
        bandwidthSuggestionReason: null,
      };
    }

    const bandwidth =
      typeof radio.bandwidth === 'string' && radio.bandwidth.length > 0
        ? radio.bandwidth
        : null;

    // AutoChannelEnable: true quando a CPE gerencia o canal (modo automático)
    const autoChannelEnable =
      typeof radio.autoChannelEnable === 'boolean'
        ? radio.autoChannelEnable
        : null;

    // SNR: CPEs TP-Link retornam "0" quando X_TP_SNR não é suportado pelo firmware.
    // SNR 0 dB (sinal = ruído) é fisicamente impossível num rádio funcional — descarta como inválido.
    const snrRaw = Number(radio.snr);
    const snr =
      radio.snr != null && !isNaN(snrRaw) && snrRaw > 0
        ? sanitizeNumber(snrRaw, 1, 60)
        : null;

    // Noise: CPEs retornam "0" quando Stats.Noise não é suportado.
    // Valores válidos de ruído de fundo ficam tipicamente entre -100 e -50 dBm.
    // 0 ou positivo indica parâmetro não suportado — descarta.
    const noiseRaw = Number(radio.noise);
    const noise =
      radio.noise != null && !isNaN(noiseRaw) && noiseRaw < -10
        ? sanitizeNumber(noiseRaw, -120, -10)
        : null;

    const utilization =
      radio.utilization != null
        ? sanitizeNumber(radio.utilization, 0, 100)
        : null;
    const txPower =
      radio.txPower != null && Number(radio.txPower) > 0
        ? sanitizeNumber(radio.txPower, 1, 100)
        : null;

    // Canal: 0 em auto mode (AutoChannelEnable=true) é válido — manter 0.
    // 0 sem auto mode = parâmetro não preenchido — descarta (null).
    // Ranges centralizados em wifi.constants.ts (CHANNEL_RANGE).
    const channelRaw = Number(radio.channel);
    const range = CHANNEL_RANGE[band] || CHANNEL_RANGE['2.4GHz'];
    const channelMin = range.min;
    const channelMax = range.max;
    let channel: number | null = null;
    if (radio.channel != null && !isNaN(channelRaw)) {
      if (channelRaw === 0 && autoChannelEnable === true) {
        channel = 0; // auto mode — manter 0
      } else if (channelRaw >= channelMin) {
        channel = sanitizeNumber(channelRaw, channelMin, channelMax);
      }
    }

    const rssiRaw = Number(radio.rssi);
    const rssi =
      radio.rssi != null && !isNaN(rssiRaw) && rssiRaw < 0
        ? sanitizeNumber(rssiRaw, -120, -1)
        : null;

    // Sugestão de largura de banda: lê diretamente do payload do backend
    // (wifiNeighborScanService.collectChannelSaturation → bands[band].bandwidthSuggestion).
    // Antes esta lógica era duplicada no frontend — agora o backend é a fonte única.
    const channelSatBand = this.channelSaturation?.bands?.[band];
    const bandwidthSuggestion = channelSatBand?.bandwidthSuggestion ?? null;
    const bandwidthSuggestionReason =
      channelSatBand?.bandwidthSuggestionReason ?? null;

    return {
      bandwidth,
      snr,
      noise,
      utilization,
      txPower,
      channel,
      autoChannelEnable,
      rssi,
      bandwidthSuggestion,
      bandwidthSuggestionReason,
    };
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
      case 'excellent':
        return 'Excelente';
      case 'good':
        return 'Bom';
      case 'fair':
        return 'Regular';
      case 'poor':
        return 'Ruim';
      default:
        return 'N/D';
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
      case 'poor':
        return 'Saturado';
      case 'fair':
        return 'Moderado';
      case 'good':
        return 'Normal';
      default:
        return 'N/D';
    }
  }

  onRunScan(): void {
    // Segurança: não emite se readOnly está true
    if (!this.readOnly) {
      this.runScan.emit();
    }
  }

  /**
   * Insights vindos do backend, filtrados para exibir apenas diagnósticos de CANAL e
   * SATURAÇÃO (não de hosts conectados).
   *
   * Categorias host-specific ('sinal', 'qoe') são filtradas — o backend continua gerando
   * esses insights para análise interna, mas o frontend não os exibe como sugestões ao
   * técnico. Os dados de hosts permanecem acessíveis via aba "Dispositivos" para consulta.
   *
   * Categorias exibidas: 'canal', 'saturacao', 'congestionamento', 'configuracao'.
   * Ordenação: critical primeiro, depois warning, depois info.
   * Dentro da mesma severidade, actionable primeiro (botão Aplicar tem prioridade visual).
   */
  private static readonly HOST_CATEGORIES = ['sinal', 'qoe'];

  get allInsights(): WifiInsight[] {
    const order = { critical: 0, warning: 1, info: 2 };
    return (this.insights || [])
      .filter(
        (i) => !NeighborScanCardComponent.HOST_CATEGORIES.includes(i.category),
      )
      .slice()
      .sort((a, b) => {
        const sa = order[a.severity] ?? 9;
        const sb = order[b.severity] ?? 9;
        if (sa !== sb) return sa - sb;
        // Dentro da mesma severidade, actionable primeiro
        const aa = a.actionable ? 0 : 1;
        const ab = b.actionable ? 0 : 1;
        return aa - ab;
      });
  }

  /** Apenas insights actionable (com botão "Aplicar"). */
  get actionableInsights(): WifiInsight[] {
    return this.allInsights.filter((i) => i?.actionable === true && i?.action);
  }

  /** Insights críticos (severity === 'critical'). */
  get criticalInsights(): WifiInsight[] {
    return this.allInsights.filter((i) => i.severity === 'critical');
  }

  /** True quando há pelo menos 1 insight — expande o status-dashboard. */
  get hasInsights(): boolean {
    return this.allInsights.length > 0;
  }

  /** True quando há pelo menos 1 insight actionable. */
  get hasActionableInsights(): boolean {
    return this.actionableInsights.length > 0;
  }

  /** True quando há pelo menos 1 insight crítico. */
  get hasCriticalInsights(): boolean {
    return this.criticalInsights.length > 0;
  }

  /** Contagem total de insights — exibida no badge do status. */
  get insightsCount(): number {
    return this.allInsights.length;
  }

  /**
   * Status dinâmico do card:
   * - Com insights críticos → "Atenção Necessária" (vermelho)
   * - Com insights actionable (sem críticos) → "Otimizações Disponíveis" (azul)
   * - Com insights (só diagnósticos warning) → "Diagnósticos Wi-Fi" (amarelo)
   * - Sem insights mas com congestionamento → "Congestionamento Detectado"
   * - Sem insights e sem congestionamento → "Rede Otimizada"
   */
  get statusTitle(): string {
    if (this.hasCriticalInsights) return 'Atenção Necessária';
    if (this.hasActionableInsights) return 'Otimizações Disponíveis';
    if (this.hasInsights) return 'Diagnósticos Wi-Fi';
    return this.hasCongestion ? 'Congestionamento Detectado' : 'Rede Otimizada';
  }

  get statusSubtitle(): string {
    if (this.hasCriticalInsights) {
      const crit = this.criticalInsights.length;
      const act = this.actionableInsights.length;
      if (act > 0)
        return `${crit} alerta${crit > 1 ? 's' : ''} crítico${crit > 1 ? 's' : ''} e ${act} otimização${act > 1 ? 'ões' : ''} aplicável${act > 1 ? 'eis' : ''}`;
      return `${crit} alerta${crit > 1 ? 's' : ''} crítico${crit > 1 ? 's' : ''} detectado${crit > 1 ? 's' : ''}`;
    }
    if (this.hasActionableInsights) {
      const act = this.actionableInsights.length;
      const total = this.insightsCount;
      if (act === total)
        return `${act} otimização${act > 1 ? 'ões' : ''} aplicável${act > 1 ? 'eis' : ''}`;
      return `${act} otimização${act > 1 ? 'ões' : ''} aplicável${act > 1 ? 'eis' : ''} em ${total} diagnóstico${total > 1 ? 's' : ''}`;
    }
    if (this.hasInsights) {
      const n = this.insightsCount;
      return `${n} diagnóstico${n > 1 ? 's' : ''} disponível${n > 1 ? 'veis' : ''}`;
    }
    return this.hasCongestion
      ? 'Recomenda-se ajuste de canal'
      : 'Nenhuma ação necessária';
  }

  /** Ícone Material Symbols do status (substitui emojis). */
  get statusIcon(): string {
    if (this.hasCriticalInsights) return 'error';
    if (this.hasActionableInsights) return 'tune';
    if (this.hasInsights) return 'tips_and_updates';
    return this.hasCongestion ? 'warning' : 'check_circle';
  }

  /** Classe CSS do status-item baseada no estado. */
  get statusClass(): string {
    if (this.hasCriticalInsights) return 'status-critical';
    if (this.hasActionableInsights) return 'status-action';
    if (this.hasInsights) return 'status-warning';
    return this.hasCongestion ? 'status-warning' : 'status-ok';
  }

  /** Emite o insight para o componente pai aplicar a otimização. */
  onApplyRecommendation(insight: WifiInsight, event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    if (this.applyInProgress) return;
    this.applyRecommendation.emit(insight);
  }

  /** Classe CSS do card de insight por severidade. */
  insightSeverityClass(severity: string): string {
    if (severity === 'critical') return 'insight-critical';
    if (severity === 'warning') return 'insight-warning';
    return 'insight-info';
  }

  /** Ícone Material Symbols do insight por severidade (sem emojis). */
  insightIcon(severity: string): string {
    if (severity === 'critical') return 'error';
    if (severity === 'warning') return 'warning';
    return 'info';
  }

  /** Label legível para a categoria do insight (PT-BR, sem underscores). */
  insightCategoryLabel(category: string): string {
    const labels: Record<string, string> = {
      sinal: 'Sinal',
      saturacao: 'Saturação',
      congestionamento: 'Congestionamento',
      configuracao: 'Configuração',
      qoe: 'QoE',
      throughput: 'Throughput',
    };
    return labels[category] || category || 'Info';
  }

  /** Texto curto da ação a ser aplicada (para o botão/detalhe). */
  insightActionLabel(insight: WifiInsight): string {
    const a = insight?.action;
    if (!a) return '';
    switch (a.type) {
      case 'change_channel':
        return `Canal ${a.band} → ${a.value}`;
      case 'adjust_power':
        return `Potência ${a.band} → ${a.value}%`;
      case 'set_bandwidth':
        return `Largura ${a.band} → ${a.value}`;
      default:
        return `${a.band}: ${a.value}`;
    }
  }

  /**
   * Nível de saturação baseado no score de interferência PONDERADO do backend.
   * Limiares idênticos ao classifyCongestionByScore() do wifiNeighborScanService.js:
   *   Alto  > 3.0 | Médio > 1.0 | Baixo ≤ 1.0
   * Também aceita contagem simples (demo data sem score).
   */
  getCongestionLevel(countOrScore: number): string {
    const val = sanitizeNumber(countOrScore, 0, 1000);
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
      case 'empty':
        return 'Livre';
      case 'low':
        return 'Baixa';
      case 'medium':
        return 'Média';
      case 'high':
        return 'Alta';
      default:
        return '';
    }
  }

  getCongestionColor(level: string): string {
    // Segurança: valida que level é uma string válida
    if (typeof level !== 'string') return '#64748b';

    switch (level) {
      case 'empty':
        return '#e2e8f0';
      case 'low':
        return '#22c55e';
      case 'medium':
        return '#f59e0b';
      case 'high':
        return '#ef4444';
      default:
        return '#64748b';
    }
  }

  /**
   * Gradiente CSS para a barra de saturação — visual moderno e elegante com
   * múltiplas paradas: highlight no topo (brilho), cor vibrante no meio e
   * tom escuro na base (profundidade). Ângulo 165deg para efeito diagonal sutil.
   * Usado no [style.background] do col-bar-fill no template.
   */
  getCongestionGradient(level: string): string {
    if (typeof level !== 'string') {
      return 'linear-gradient(165deg, #cbd5e1 0%, #94a3b8 45%, #64748b 100%)';
    }

    switch (level) {
      case 'empty':
        // Cinza neutro com leve brilho
        return 'linear-gradient(165deg, #f8fafc 0%, #e2e8f0 45%, #cbd5e1 100%)';
      case 'low':
        // Verde esmeralda: brilho claro → verde vibrante → verde escuro
        return 'linear-gradient(165deg, #86efac 0%, #22c55e 40%, #15803d 100%)';
      case 'medium':
        // Ambar dourado: brilho → laranja vibrante → ambar escuro
        return 'linear-gradient(165deg, #fcd34d 0%, #f59e0b 40%, #b45309 100%)';
      case 'high':
        // Vermelho coral: brilho → vermelho vibrante → vermelho escuro
        return 'linear-gradient(165deg, #fca5a5 0%, #ef4444 40%, #b91c1c 100%)';
      default:
        return 'linear-gradient(165deg, #cbd5e1 0%, #94a3b8 45%, #64748b 100%)';
    }
  }

  /**
   * Altura proporcional da barra vertical usando o interferenceScore real (max útil = 5.0).
   * Aplica escala não-linear (raiz cúbica) para ampliar barras baixas — assim o
   * gradiente ocupa mais espaço dentro da coluna mesmo com scores baixos, mantendo
   * a proporção relativa entre canais. Altura mínima de 12% garante que qualquer
   * canal com interferência seja visível.
   * Para dados demo sem score, usa neighborCount com max = 10.
   */
  getCongestionWidth(score: number, max: number = 5): number {
    const sanitizedScore = sanitizeNumber(score, 0, 1000);
    const sanitizedMax = sanitizeNumber(max, 1, 1000);
    if (sanitizedMax === 0) return 0;
    const ratio = sanitizedScore / sanitizedMax;
    // Escala raiz cúbica: amplia valores baixos, comprime valores altos
    // score=0 → 0%, score=0.5 → 50%, score=1 → 58%, score=3 → 84%, score=5 → 100%
    const scaled = Math.cbrt(ratio) * 100;
    // Mínimo de 12% quando há qualquer interferência (score > 0)
    const withFloor = sanitizedScore > 0 ? Math.max(scaled, 12) : 0;
    return Math.min(withFloor, 100);
  }

  /**
   * Determina se o label "Baixa/Média/Alta/Livre" deve aparecer dentro da barra.
   * Mostra sempre — mesmo canais sem interferência (score=0) exibem "Livre"
   * para o técnico saber que aquele canal está disponível.
   * Só não mostra quando não há dados do canal (null/undefined).
   */
  shouldShowBarLabel(channel: ChannelEntry): boolean {
    if (!channel || typeof channel !== 'object') return false;
    // Sempre mostra: canal com interferência → "Baixa/Média/Alta"
    // Canal sem interferência → "Livre"
    return true;
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

    const suggestion =
      band === '2.4GHz' ? this.suggestion2g : this.suggestion5g;
    if (!suggestion) return 'Sem dados para recomendação (acione a varredura)';

    // Estrutura real do backend: { bestChannel, currentChannel, currentScore, bestScore,
    //                               improvement, shouldChange, reason, parameterPath }
    if (suggestion.shouldChange === false) {
      const currentChannel = sanitizeNumber(suggestion.currentChannel, 1, 165);
      const currentScore = sanitizeNumber(suggestion.currentScore, 0, 1000);
      return `Canal ${currentChannel} já é o melhor disponível (score ${currentScore.toFixed(1)})`;
    }

    // Sanitiza e usa o campo reason do backend se disponível (string já formatada)
    if (
      typeof suggestion.reason === 'string' &&
      suggestion.reason.length > 0 &&
      suggestion.reason.length < 200
    ) {
      return suggestion.reason;
    }

    // Fallback com campos individuais sanitizados
    const bestChannel = sanitizeNumber(suggestion.bestChannel, 1, 165);
    const currentChannel = sanitizeNumber(suggestion.currentChannel, 1, 165);
    const bestScore = sanitizeNumber(suggestion.bestScore, 0, 1000);
    const improvement = sanitizeNumber(suggestion.improvement, 0, 1000);

    return `Mudar canal ${currentChannel} → ${bestChannel} (redução de ${improvement.toFixed(1)} no score, de ${sanitizeNumber(suggestion.currentScore, 0, 1000).toFixed(1)} para ${bestScore.toFixed(1)})`;
  }

  getNonOverlappingChannels(band: string): number[] {
    // Fonte única no frontend: @app/core/constants/wifi.constants
    // (espelho do backend src/utils/wifiConstants.js)
    if (band === '2.4GHz') {
      return NON_OVERLAPPING_2G;
    } else if (band === '5GHz') {
      return PREFERRED_5G_NO_DFS;
    }

    // Segurança: retorna array vazio para banda inválida
    return [];
  }

  isNonOverlappingChannel(channel: number, band: string): boolean {
    // Segurança: valida channel e band antes de processar
    const sanitizedChannel = sanitizeNumber(channel, 1, 165);
    const validChannels = this.getNonOverlappingChannels(band);

    return validChannels.includes(sanitizedChannel);
  }

  /**
   * Verifica se um canal é o canal sugerido pelo backend (bestChannel da suggestion).
   * Usado para destacar visualmente o canal recomendado no grid de saturação.
   */
  isSuggestedChannel(channel: number, band: string): boolean {
    const suggestion =
      band === '2.4GHz' ? this.suggestion2g : this.suggestion5g;
    return (
      suggestion?.bestChannel === channel && suggestion?.shouldChange === true
    );
  }
}
