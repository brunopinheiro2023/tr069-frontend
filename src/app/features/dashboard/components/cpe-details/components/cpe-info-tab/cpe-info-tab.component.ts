import { Component, Input, OnInit, OnDestroy, OnChanges, SimpleChanges, DestroyRef, inject, ChangeDetectionStrategy, ChangeDetectorRef, NgZone } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { filter, Subscription, interval, Subject, EMPTY, timer, timeout, take } from 'rxjs';
import { exhaustMap, finalize, catchError, bufferTime } from 'rxjs/operators';
import { ChartDataset, ChartOptions } from 'chart.js';
import { NgChartsModule } from 'ng2-charts';
import { CpeDevice, TelemetryAlert, TelemetryAnalysis, TelemetryData, TelemetryMetric, TelemetrySnapshot } from '../../../../../../core/models';
import { CpeService } from '../../../../../../core/services/cpe.service';
import { WebSocketService } from '../../../../../../core/services/websocket.service';
import { ToastService } from '../../../../../../core/services/toast.service';
import { DiagnosticParserService } from '../../../../../../core/services/diagnostic-parser.service';
import { TelemetryCacheService } from '../../../../../../core/services/telemetry-cache.service';
// OTIMIZAÇÃO: Importação dos novos Pipes puros
import { FormatBytesPipe } from '../../../../../../core/pipes/format-bytes.pipe';
import { MetricPipe } from '../../../../../../core/pipes/metric.pipe';

// Interface para snapshots de intervenção (retorno aninhado de getLastIntervention)
interface InterventionSnapshot {
  source: string;
  createdAt: string;
  telemetry?: { optical?: { rxPower?: number }; system?: { cpuUsage?: number }; wan?: Record<string, unknown> };
}

// Interfaces para tipagem de eventos WebSocket
interface ValueChangeEvent {
  serialNumber: string;
  changedParams?: unknown;
  changeType?: string;
}

interface TelemetryUpdateEvent {
  serialNumber: string;
  data: TelemetryData;
  timestamp: string;
  partial?: boolean;
  message?: string;
  source?: string;
  tabContext?: string;
}

// Configuração compartilhada de gráficos (estática para evitar recriação)
const CHART_COMMON_OPTIONS: ChartOptions<'line'> = {
  responsive: true,
  maintainAspectRatio: false,
  animation: false,
  interaction: { mode: 'index', intersect: false },
  plugins: {
    legend: {
      display: true,
      labels: { color: '#94a3b8', font: { size: 12 } }
    },
    tooltip: {
      backgroundColor: 'rgba(15, 18, 39, 0.95)',
      titleColor: '#f8fafc',
      bodyColor: '#e2e8f0',
      borderWidth: 1,
    }
  },
  scales: {
    x: {
      ticks: { color: '#94a3b8', maxTicksLimit: 8 },
      grid: { color: 'rgba(255,255,255,0.05)' }
    },
    y: {
      ticks: { color: '#94a3b8' },
      grid: { color: 'rgba(255,255,255,0.05)' }
    }
  }
};

// Map de suffixos para chaves de destino (estático para evitar recriação)
const PARAM_MAP: ReadonlyArray<[string, string]> = [
  ['cpuusage', 'cpu'],
  ['cpu', 'cpu'], // Mapeamento direto para compatibilidade com backend
  ['memoryfree', 'memFree'],
  ['memorystatus.free', 'memFree'],
  ['memorytotal', 'memTotal'],
  ['memorystatus.total', 'memTotal'],
  ['uptime', 'upTime'],
  ['xponstatus', 'gponStatus'],
  ['rxpower', 'rxPower'],
  ['opticalsignallevel', 'rxPower'],
  ['txpower', 'txPower'],
  ['transceivertemperature', 'temp'],
  ['temperature', 'temp'], // Mapeamento direto para temperatura do SoC
  ['supplyvottage', 'voltage'],
  ['supplyvoltage', 'voltage'],
  ['biascurrent', 'bias'],
  ['bytesreceived', 'bytesRx'],
  ['optical.interface.1.stats.bytesreceived', 'bytesRx'],
  ['bytessent', 'bytesTx'],
  ['optical.interface.1.stats.bytessent', 'bytesTx'],
];

/** Explicações curtas de cada análise técnica — linguagem direta, sem jargão estatístico. */
const ANALYSIS_INFO: Readonly<Record<string, string>> = {
  opticalTrend: 'Mede se o sinal óptico está caindo aos poucos (fibra envelhecendo), usando os últimos 7 dias.',
  rebootStability: 'Conta quantas vezes a CPE reiniciou sozinha nos últimos dias.',
  trafficAnomalies: 'Detecta picos de tráfego fora do padrão normal desta CPE nas últimas 24h.',
  oltComparison: 'Compara o sinal óptico desta CPE com vizinhas na mesma rede — ajuda a saber se o problema é local ou da OLT/fibra compartilhada.',
  thermalCorrelation: 'Verifica se a temperatura alta é por uso intenso (CPU) ou por falta de ventilação.',
  latencyDns: 'Última medição de latência de ping registrada pela CPE (não em tempo real).',
  topDestinations: 'Estimativa de uso (streaming, trabalho, jogos) baseada no horário de pico — não é inspeção real de conteúdo.',
  wanErrors: 'Conta erros físicos na fibra (camada 1/2) — indica problema de cabo ou conector.',
  laserHealth: 'Acompanha o envelhecimento do laser óptico pela corrente de bias.',
  memoryLeak: 'Detecta se o firmware está perdendo memória RAM com o tempo (sinal de que vai travar).',
  powerSupply: 'Verifica se a tensão da fonte de alimentação está estável.',
};

// Configuração base de datasets (estática para evitar recriação)
const hexToRgba = (hex: string, alpha: number): string => {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

const createChartDataset = (label: string, color: string, data: (number | null)[]): ChartDataset<'line'> => ({
  label,
  data,
  borderColor: color,
  backgroundColor: hexToRgba(color, 0.15),
  fill: true,
  tension: 0.3,
  pointRadius: 3,
  pointBackgroundColor: color,
});

/**
 * Aba "Informações Gerais" com telemetria em tempo real + histórico gráfico.
 * Integra:
 *   - Cards de CPU, Memória, Uptime (on-demand + cache 60s)
 *   - Gráfico de linha com últimas 6h (ng2-charts + Chart.js)
 *   - WebSocket 'telemetry_update' para atualização em tempo real
 *   - Indicador "Atualizado há X segundos"
 */
@Component({
  selector: 'app-cpe-info-tab',
  standalone: true,
  imports: [CommonModule, FormsModule, NgChartsModule, FormatBytesPipe, MetricPipe],
  templateUrl: './cpe-info-tab.component.html',
  styleUrls: ['./cpe-info-tab.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush // OTIMIZAÇÃO: Evita re-renderizações globais a cada pulso do WebSocket
})
export class CpeInfoTabComponent implements OnInit, OnDestroy, OnChanges {
  /** Dados da CPE vindo do componente pai. */
  @Input() cpe: CpeDevice | null = null;
  /** Número de série para requisições de telemetria. */
  @Input() serialNumber: string = '';

  private destroyRef = inject(DestroyRef); // Gerenciador de ciclo de vida moderno do Angular 17+
  private cdr = inject(ChangeDetectorRef); // Injetor para disparar atualizações manuais na UI
  private ngZone = inject(NgZone); // Injetor para garantir execução na zona do Angular

  // ── Telemetria em tempo real ─────────────────────────────────────────────
  telemetryData: TelemetryData | null = null;
  lastUpdated: Date | null = null;
  telemetryLoading = false;
  telemetryError: string | null = null;

  // ── Two-Phase UI State (Vitals + Standard) ─────────────────────────────────
  vitalsLoading = false;   // indicador rápido (vitals)
  vitalsReceived = false;   // true após primeiro vitals chegar

  // ── Progresso de coleta por chunk ─────────────────────────────────────────
  telemetryProgress = 0; // 0-100%
  completedChunks = 0;
  totalChunks = 0;
  isPartialCollection = false; // true quando chunk falhou (partial: true)

  // ── Single Driver: Controle de modo View-Only ─────────────────────────────
  isViewOnly = false; // Se true, usuário está em modo de visualização (não é Driver)

  // ── Sincronização de Estado de Semáforo (Lock State Sync) ───────────────────
  isCpeBusy = false; // Se true, CPE está em tráfego CWMP ativo (botão bloqueado)

  // ── Tracking de Viewers ───────────────────────────────────────────────────
  viewers: string[] = []; // Lista de usernames visualizando a CPE

  // ── Fallback UX ───────────────────────────────────────────────────────────
  isStaleData = false; // Se true, dados são de cache MongoDB (Redis offline)
  staleDataTimestamp: Date | null = null; // Timestamp dos dados estagnados
  isPartialResult = false; // true quando a última coleta retornou chunks incompletos

  // ── Getter para debounce do botão (alias de telemetryLoading) ─────────────
  get isLoading(): boolean {
    return this.telemetryLoading;
  }

  // ── Getter para proteção de UI contra duplo clique (idempotência) ─────────
  get isMonitoring(): boolean {
    return this.telemetryLoading;
  }

  // ── Subject para controle de emissão com exhaustMap (prevenção de Efeito Eco) ──
  private monitorTrigger$ = new Subject<void>();

  // ── Histórico para gráficos ──────────────────────────────────────────────
  rawHistory: TelemetrySnapshot[] = [];
  historyLoading = false;
  selectedPeriodHours = 6; // Período padrão
  private historySub?: Subscription; // OTIMIZAÇÃO: Proteção contra Condições de Corrida (Race Conditions)
  private readonly timeFormatter = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }); // OTIMIZAÇÃO: Instância única

  // ── Análise avançada agregada ──────────────────────────────────────────
  analysisData: TelemetryAnalysis | null = null;
  analysisLoading = false;
  analysisError: string | null = null;
  analysisUpdatedAt: Date | null = null;

  // ── Painéis suplementares (Health Score, Alertas, Incidente, Intervenção) ──
  healthScoreBreakdown: { total: number; components: Record<string, { score: number; weight: number }> } | null = null;
  cpeAlerts: TelemetryAlert[] = [];
  incidentStatus: { active: boolean; expiresInSeconds: number | null } = { active: false, expiresInSeconds: null };
  lastIntervention: { found: boolean; before?: InterventionSnapshot; after?: InterventionSnapshot; pending?: boolean } | null = null;

  // Getter para filtrar apenas alertas ativos (status: 'active')
  get activeAlerts(): TelemetryAlert[] {
    return this.cpeAlerts.filter(a => a.status === 'active').slice(0, 10);
  }

  // ── Configuração WAN (EP 26.15 — corrigido) ────────────────────────────
  wanConfigFields = { pppoeUsername: '', dnsServer1: '', dnsServer2: '', mtu: 1492, vlanId: 0 };
  isEditingWanConfig = false;
  wanConfigSaving    = false;

  // ── Configuração do gráfico CPU/Memória ────────────────────────────────
  chartLabels: string[] = [];
  chartDatasets: ChartDataset<'line'>[] = [
    createChartDataset('CPU (%)', '#7c3aed', []),
    createChartDataset('Memória Usada (%)', '#06b6d4', []),
  ];
  chartData = { labels: this.chartLabels, datasets: this.chartDatasets };
  chartOptions: ChartOptions<'line'> = {
    ...CHART_COMMON_OPTIONS,
    plugins: {
      ...CHART_COMMON_OPTIONS.plugins,
      tooltip: {
        ...CHART_COMMON_OPTIONS.plugins!.tooltip,
        borderColor: 'rgba(124, 58, 237, 0.3)',
      }
    },
    scales: {
      x: CHART_COMMON_OPTIONS.scales?.['x'],
      y: {
        ...(CHART_COMMON_OPTIONS.scales?.['y'] as any),
        beginAtZero: true,
        max: 100
      }
    }
  };

  // ── Configuração do gráfico Óptico ─────────────────────────────────────
  opticalChartLabels: string[] = [];
  opticalChartDatasets: ChartDataset<'line'>[] = [
    createChartDataset('RX (dBm)', '#10b981', []),
    createChartDataset('TX (dBm)', '#f59e0b', []),
  ];
  opticalChartData = { labels: this.opticalChartLabels, datasets: this.opticalChartDatasets };
  opticalChartOptions: ChartOptions<'line'> = {
    ...CHART_COMMON_OPTIONS,
    plugins: {
      ...CHART_COMMON_OPTIONS.plugins,
      tooltip: {
        ...CHART_COMMON_OPTIONS.plugins!.tooltip,
        borderColor: 'rgba(16, 185, 129, 0.3)',
      }
    },
    scales: {
      x: CHART_COMMON_OPTIONS.scales?.['x'],
      y: {
        ...(CHART_COMMON_OPTIONS.scales?.['y'] as any),
        title: { display: true, text: 'dBm', color: '#94a3b8' }
      }
    }
  };

  constructor(
    private cpeService: CpeService,
    private wsService: WebSocketService,
    private toastService: ToastService,
    private diagnosticParser: DiagnosticParserService,
    private telemetryCacheService: TelemetryCacheService,
  ) {}

  async ngOnInit(): Promise<void> {
    // ── Setup do barramento reativo com exhaustMap e catchError (prevenção de Efeito Eco) ──
    this.monitorTrigger$.pipe(
      takeUntilDestroyed(this.destroyRef),
      exhaustMap(() => {
        this.telemetryLoading = true; // Feedback visual imediato
        this.vitalsLoading = true;    // Indicador de vitals

        // Retorna o fluxo HTTP
        return this.cpeService.requestTelemetry(this.serialNumber).pipe(
          // CAPTURA INTERNA: Impede que o erro suba e mate o Subject monitorTrigger$
          catchError((err) => {
            this.telemetryLoading = false; // Desliga spinner em caso de erro
            this.vitalsLoading = false;    // Desliga indicador de vitals
            this.toastService.error(err.error?.error || 'Erro ao conectar com a CPE.');
            return EMPTY; // Retorna um fluxo vazio e finalizado de forma segura
          })
        );
      })
    ).subscribe({
      next: (response: any) => {
        // Source 'cache' ou 'mongodb_stale' = dado imediato, fecha spinner
        if (response?.source === 'cache' || response?.source === 'mongodb_stale') {
          this.telemetryLoading = false;
          this.vitalsLoading = false;
          if (response.telemetry || response.data) {
            this.telemetryData = response.telemetry || response.data;
          }
          const msg = response.source === 'mongodb_stale'
            ? 'Dados do banco (Redis offline) — podem estar desatualizados.'
            : (response.message || 'Exibindo dados armazenados em cache.');
          this.toastService.info(msg);
          this.cdr.markForCheck();
          return;
        }

        // Source 'in_progress' = coleta ativa em andamento (scheduler ou on-demand anterior)
        // Mantém spinner true e aguarda WS — a coleta em andamento vai finalizar
        if (response?.status === 'in_progress') {
          this.toastService.info('Coleta em andamento. Aguardando dados via WebSocket...');
          return; // telemetryLoading permanece true
        }

        // HTTP 202 aceito (idempotent bypass — lock ativo por outra requisição)
        // A coleta ativa vai completar e enviar WS — mantém spinner por no máximo 120s
        if (response?.status === 'accepted') {
          this.toastService.info(response.message || 'Coleta já está em andamento. Aguarde a atualização na tela.');
          return; // telemetryLoading permanece true — WS irá fechar
        }

        // Qualquer outra resposta = coleta enfileirada ou iniciada
        this.toastService.success('CPE online. Coleta em tempo real iniciada via TR-069...');
        // telemetryLoading permanece true até telemetry_update ou telemetry_complete
      }
    });

    // Inscreve-se na sala da CPE para receber eventos WebSocket específicos
    if (this.serialNumber) {
      this.wsService.subscribeToCpe(this.serialNumber);
    }
    this.loadFromFrontendCache();
    this.extractFallbackTelemetry(); // Fallback imediato de 0ms a partir do BD
    // Registra listeners WebSocket antes das chamadas HTTP
    this.listenForTelemetryUpdates();
    this.listenForTelemetryProgress(); // Listener para progresso por chunk
    this.listenForTelemetryComplete(); // Listener para encerramento de spinner via WebSocket
    this.listenForCpeValueChange();
    this.listenForAlerts(); // Listener para alertas de telemetria
    this.listenForPresenceEvents(); // Single Driver: escuta conflitos e promoções
    this.startHeartbeat(); // Inicia heartbeat para manter controle de Driver
    // Escalonamento das chamadas HTTP para evitar burst (429 Too Many Requests)
    this.loadLatestVitals();       // NOVO: 0ms — carga imediata do snapshot TelemetryVitals
    await this.loadHistory();      // imediato — gráfico precisa de dados antes de qualquer update
    timer(150).pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => this.loadFromCache());
    timer(300).pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => this.loadAnalysis());
    timer(450).pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => this.loadSupplementaryPanels());
  }

  ngOnDestroy(): void {
    // Cancela inscrição na sala da CPE
    if (this.serialNumber) {
      this.wsService.unsubscribeFromCpe(this.serialNumber);
    }
    // Previne memory leak e erros no console se o componente for destruído
    // enquanto aguarda a resposta de telemetria da CPE
    if (this.telemetryTimeoutId) {
      clearTimeout(this.telemetryTimeoutId);
    }
    // Limpa timers de flash visual
    this.flashTimers.forEach(timer => clearTimeout(timer));
    this.flashTimers.clear();
    
    // ── Prevenção de Ghost Viewers: Emite leave_cpe_room ao destruir ──
    this.destroyRef.onDestroy(() => {
      if (this.wsService['socket']?.connected && this.serialNumber) {
        this.wsService['socket'].emit('leave_cpe_room', { serialNumber: this.serialNumber });
      }
    });
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['cpe'] && this.cpe?.parameters) {
      this.extractFallbackTelemetry();
    }
    if (changes['cpe'] && this.cpe) {
      // Só recarrega painéis suplementares quando healthScore ou isOnline mudaram
      const prevCpe = changes['cpe'].previousValue as CpeDevice | null;
      if (prevCpe?.healthScore !== this.cpe.healthScore || prevCpe?.isOnline !== this.cpe.isOnline) {
        this.loadSupplementaryPanels();
      }
    }
    if (changes['serialNumber'] && this.serialNumber) {
      this.loadSupplementaryPanels();
    }
  }

  // ── Efeitos Visuais (Highlight) ─────────────────────────────────────────
  flashingMetrics = new Set<string>();
  private flashTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly MAX_FLASH_TIMERS = 30;

  /** Dispara um efeito visual de "piscar" para uma métrica específica */
  triggerFlash(metricKey: string): void {
    // Limita acumulação de timers em CPEs com muitas métricas ou alta frequência de chunks
    if (this.flashTimers.size >= this.MAX_FLASH_TIMERS) return;
    // Não recria timer já ativo para a mesma chave
    if (this.flashTimers.has(metricKey)) return;
    this.flashingMetrics.add(metricKey);
    const timer = setTimeout(() => {
      this.flashingMetrics.delete(metricKey);
      this.flashTimers.delete(metricKey);
      this.cdr.markForCheck(); // Atualiza a view após remover o flash
    }, 2000); // Remove o efeito após 2s
    this.flashTimers.set(metricKey, timer);
  }

  /** Verifica se o card deve estar piscando agora */
  hasFlash(metricKey: string): boolean {
    return this.flashingMetrics.has(metricKey);
  }

  // ── Getters de Análise Avançada ────────────────────────────────────────
  get opticalTrend() { return this.analysisData?.analyses?.opticalTrend; }
  get rebootStability() { return this.analysisData?.analyses?.rebootStability; }
  get trafficAnomalies() { return this.analysisData?.analyses?.trafficAnomalies; }
  get oltComparison() { return this.analysisData?.analyses?.oltComparison; }
  get thermalCorrelation() { return this.analysisData?.analyses?.thermalCorrelation; }
  get latencyDns() { return this.analysisData?.analyses?.latencyDns; }
  get topDestinations() { return this.analysisData?.analyses?.topDestinations; }
  get analysisAlerts() { return this.analysisData?.summary?.alerts || []; }
  get analysisHealth() { return this.analysisData?.summary?.overallHealth || 'unknown'; }

  // Traduz overallHealth para português
  get overallHealthLabel(): string {
    const health = this.analysisData?.summary?.overallHealth || 'unknown';
    const labels: Record<string, string> = {
      good: 'Bom',
      warning: 'Atenção',
      critical: 'Crítico',
      unknown: 'Desconhecido'
    };
    return labels[health] || health;
  }

  // ── EP 26.37: Novos getters e métodos ───────────────────────────────────

  // Step 1: Health Score
  readonly healthScoreLabels: Record<string, string> = {
    connectivity: 'Conectividade WAN/GPON',
    optical:      'Sinal Óptico',
    system:       'Recursos do Sistema',
    wifi:         'Ruído Wi-Fi',
    stability:    'Estabilidade Histórica',
  };

  healthScoreColor(score: number): string {
    if (score >= 80) return 'bg-green-500';
    if (score >= 50) return 'bg-yellow-400';
    return 'bg-red-500';
  }

  healthScoreBadge(score: number): string {
    if (score >= 80) return 'text-green-600 dark:text-green-400';
    if (score >= 50) return 'text-yellow-600 dark:text-yellow-400';
    return 'text-red-600 dark:text-red-400';
  }

  // Step 2: Sistema
  formatUptimeHuman(seconds: number | null | undefined): string {
    if (seconds == null || isNaN(Number(seconds))) return '—';
    const s = Math.round(Number(seconds));
    if (s < 60) return `${s}s`;
    const minutes = Math.floor(s / 60);
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h`;
    const days = Math.floor(hours / 24);
    const rem = hours % 24;
    return rem > 0 ? `${days}d ${rem}h` : `${days}d`;
  }

  get ramUsagePercent(): number | null {
    const free  = this.safeExtractValue(this.telemetryData as any, 'memoryFree');
    const total = this.safeExtractValue(this.telemetryData as any, 'memoryTotal');
    if (free == null || total == null || total <= 0) return null;
    return Math.round(((total - free) / total) * 100);
  }

  get ramUsedMb(): number | null {
    const free  = this.safeExtractValue(this.telemetryData as any, 'memoryFree');
    const total = this.safeExtractValue(this.telemetryData as any, 'memoryTotal');
    if (free == null || total == null) return null;
    return Math.round((total - free) / 1024);
  }

  get ramTotalMb(): number | null {
    const total = this.safeExtractValue(this.telemetryData as any, 'memoryTotal');
    if (total == null) return null;
    return Math.round(total / 1024);
  }

  usageBarColor(pct: number | null): string {
    if (pct == null) return 'bg-gray-400';
    if (pct >= 85) return 'bg-red-500';
    if (pct >= 70) return 'bg-yellow-400';
    return 'bg-green-500';
  }

  // Step 3: Óptico
  get rxZone(): 'ok' | 'warning' | 'critical' | 'unknown' {
    const rx = this.safeExtractValue(this.telemetryData as any, 'opticalRx');
    if (rx == null) return 'unknown';
    if (rx >= -22) return 'ok';       // padrão GPON TP-Link aceitável
    if (rx >= -27) return 'warning';  // degradado mas funcional
    return 'critical';                 // < -27 dBm = LOS iminente
  }

  get txZone(): 'ok' | 'warning' | 'critical' | 'unknown' {
    const tx = this.safeExtractValue(this.telemetryData as any, 'opticalTx');
    if (tx == null) return 'unknown';
    if (tx > -5) return 'ok';
    if (tx >= -8) return 'warning';
    return 'critical';
  }

  opticalZoneClass(zone: 'ok' | 'warning' | 'critical' | 'unknown'): string {
    return {
      ok:      'text-green-500 font-semibold',
      warning: 'text-yellow-500 font-semibold',
      critical:'text-red-500 font-bold',
      unknown: 'text-gray-400',
    }[zone];
  }

  // Step 4: Wi-Fi tabs
  wifiTabSelected: '2g' | '5g' = '2g';

  private autoSelectWifiTab(): void {
    const c2g = this.safeExtractValue(this.telemetryData as any, 'wifi2gClients') ?? 0;
    const c5g = this.safeExtractValue(this.telemetryData as any, 'wifi5gClients') ?? 0;
    if (!this.telemetryData?.['wifi' + (this.wifiTabSelected === '2g' ? '2g' : '5g') + 'Channel']) {
      this.wifiTabSelected = this.telemetryData?.['wifi5gChannel'] ? '5g' : '2g';
    }
  }

  // Step 5: Export CSV
  exportHistoryCsv(): void {
    if (!this.rawHistory.length) return;

    const headers = ['timestamp', 'cpuUsage', 'memoryFreeKb', 'memoryTotalKb', 'opticalRx_dBm', 'opticalTx_dBm', 'wanStatus', 'gponStatus'];

    const rows = this.rawHistory.map(snap => {
      return [
        new Date(snap.timestamp).toISOString(),
        (snap as any)['cpuUsage'] ?? '',
        (snap as any)['memoryFree'] ?? '',
        (snap as any)['memoryTotal'] ?? '',
        (snap as any)['opticalRx'] ?? '',
        (snap as any)['opticalTx'] ?? '',
        (snap as any)['wanStatus'] ?? '',
        (snap as any)['gponStatus'] ?? '',
      ].map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',');
    });

    const csv = [headers.join(','), ...rows].join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `telemetria_${this.serialNumber}_${this.selectedPeriodHours}h_${new Date().toISOString().slice(0,10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  // Step 6: Análise priorizada
  readonly analysisInfoMap: Record<string, string> = {
    opticalTrend:       'Tendência Óptica',
    rebootStability:    'Estabilidade de Reboot',
    trafficAnomalies:   'Anomalias de Tráfego',
    oltComparison:      'Comparação com OLT',
    thermalCorrelation: 'Correlação Térmica',
    latencyDns:         'Latência DNS',
    topDestinations:    'Top Destinos de Tráfego',
    wanErrors:          'Erros WAN',
    laserHealth:        'Saúde do Laser',
    memoryLeak:         'Vazamento de Memória',
    powerSupply:        'Fonte de Energia',
    wifiQuality2g:      'Qualidade Wi-Fi 2.4 GHz',
    wifiQuality5g:      'Qualidade Wi-Fi 5 GHz',
    gponLinkBudget:     'Margem Óptica GPON',
    transceiverAging:   'Envelhecimento do Laser',
  };

  getAnalysisInfo(key: string): string {
    return this.analysisInfoMap[key] || key;
  }

  formatMeasuredAt(measuredAt: string): string {
    const seconds = Math.floor((Date.now() - new Date(measuredAt).getTime()) / 1000);
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}min`;
    return `${Math.floor(seconds / 3600)}h`;
  }


  get sortedAnalysisEntries(): Array<{ key: string; data: any }> {
    if (!this.analysisData?.analyses) return [];
    const severityOrder: Record<string, number> = { critical: 0, warning: 1, ok: 2, normal: 2 };
    return Object.entries(this.analysisData.analyses)
      .filter(([, v]) => v != null)
      .map(([key, data]) => ({ key, data }))
      .sort((a, b) => {
        const sa = severityOrder[a.data?.severity ?? a.data?.status ?? 'ok'] ?? 2;
        const sb = severityOrder[b.data?.severity ?? b.data?.status ?? 'ok'] ?? 2;
        return sa - sb;
      });
  }

  analysisCardBorder(data: any): string {
    const sev = data?.severity ?? data?.status ?? 'ok';
    if (sev === 'critical') return 'border-red-400 dark:border-red-600';
    if (sev === 'warning')  return 'border-yellow-400 dark:border-yellow-600';
    return 'border-gray-200 dark:border-gray-700';
  }

  analysisBadge(data: any): string {
    const sev = data?.severity ?? data?.status ?? '';
    if (sev === 'critical') return '🔴';
    if (sev === 'warning')  return '⚠️';
    if (sev === 'ok' || sev === 'normal') return '✅';
    return '';
  }


  // ── EP 26.36: Métodos para alertas enriquecidos ───────────────────────────
  /** Ícone de severidade para o card de alertas */
  alertIcon(severity: string): string {
    return severity === 'critical' ? '🔴' : '⚠️';
  }

  /** Converte timestamp para "há X min/h" */
  timeAgo(timestamp: string | Date | undefined): string {
    if (!timestamp) return '';
    const diff = Date.now() - new Date(timestamp).getTime();
    const min  = Math.floor(diff / 60000);
    if (min < 1)   return 'agora';
    if (min < 60)  return `há ${min}min`;
    const h = Math.floor(min / 60);
    if (h < 24)    return `há ${h}h`;
    return `há ${Math.floor(h / 24)}d`;
  }

  // ── Getters legados (WAN, Óptica, Hardware) ────────────────────────────
  get isRxCritical(): boolean {
    const rxPower = this.safeExtractValue(this.telemetryData!, 'opticalRx');
    return rxPower !== null && rxPower < -27; // alinhado com GPON threshold
  }
  get isRxGood(): boolean {
    const rxPower = this.safeExtractValue(this.telemetryData!, 'opticalRx');
    return rxPower !== null && rxPower >= -22;
  }

  /** Retorna label de cache (ex: "Atualizado há 12s · cache"). */
  get cacheLabel(): string {
    if (!this.lastUpdated) return 'Nenhuma telemetria disponível';
    const seconds = Math.floor((Date.now() - this.lastUpdated.getTime()) / 1000);
    if (seconds < 5) return 'Atualizado agora · via TR-069';
    if (seconds < 60) return `Atualizado há ${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    return `Atualizado há ${minutes}min`;
  }

  /** Retorna métrica como string, ou null. */
  stringValue(key: string): string | null {
    const m = this.telemetryData?.[key];
    if (m === undefined || m === null) return null;

    // Trata caso onde m é um primitivo (backend/cache) ou um objeto TelemetryMetric
    const val = typeof m === 'object' && 'value' in m ? (m as TelemetryMetric).value : m;
    if (val === undefined || val === null) return null;

    return String(val);
  }

  /**
   * Retorna o valor numérico de bytes da WAN para uso estrito no pipe formatBytes.
   * @param key Chave da métrica (wanBytesReceived ou wanBytesSent)
   */
  getWanBytes(key: string): number {
    const m = this.telemetryData?.[key];
    if (!m) return 0;
    const val = typeof m === 'object' && 'value' in m ? (m as TelemetryMetric).value : m;
    const parsed = parseFloat(String(val));
    return isNaN(parsed) ? 0 : parsed;
  }

  // ── Ações ────────────────────────────────────────────────────────────────

  /**
   * Extrai valores vitais estáticos da árvore TR-069 para renderização Zero-Latency (0ms).
   * Utiliza as conversões da norma OMCI (ITU-T G.988) para exibir dBm, Volts e Celsius reais.
   */
  private extractFallbackTelemetry(): void {
    if (!this.cpe || !this.cpe.parameters) return;

    const values: Record<string, string> = {};

    for (const p of this.cpe.parameters) {
      if (!p.name) continue;
      const nameLower = p.name.toLowerCase();
      
      // Encontra o sufixo correspondente no array estático (O(n) com n pequeno)
      for (const [suffix, key] of PARAM_MAP) {
        if (nameLower.endsWith(suffix)) {
          values[key] = p.value;
          break;
        }
      }
    }

    if (!this.telemetryData) this.telemetryData = {};
    const t = this.telemetryData;

    // OTIMIZAÇÃO: Resolve as constantes matemáticas OMCI antes da atribuição (Anti-Leak)
    const valRx = values['rxPower'] ? this.diagnosticParser.parseOmciRx(values['rxPower']) : null;
    const valTx = values['txPower'] ? this.diagnosticParser.parseOmciTx(values['txPower']) : null;
    const valTemp = values['temp'] ? this.diagnosticParser.parseOmciTemp(values['temp']) : null;
    const valVoltage = values['voltage'] ? this.diagnosticParser.parseOmciVoltage(values['voltage']) : null;
    const valBias = values['bias'] ? this.diagnosticParser.parseOmciBias(values['bias']) : null;

    // CORREÇÃO: Adicionado 'unit' e 'description' exigidos estritamente pela interface TelemetryMetric (TS2739)
    // Processa dados do fallback local (parâmetros da CPE)
    if (!t['cpuUsage'] && values['cpu']) t['cpuUsage'] = { value: String(parseFloat(values['cpu'])), unit: '%', description: 'CPU Usage' };
    if (!t['memoryFree'] && values['memFree']) t['memoryFree'] = { value: String(parseFloat(values['memFree'])), unit: 'KB', description: 'Free Memory' };
    if (!t['memoryTotal'] && values['memTotal']) t['memoryTotal'] = { value: String(parseFloat(values['memTotal'])), unit: 'KB', description: 'Total Memory' };
    if (!t['upTime'] && values['upTime']) t['upTime'] = { value: String(parseFloat(values['upTime'])), unit: 's', description: 'Uptime' };
    if (!t['gponStatus'] && values['gponStatus']) t['gponStatus'] = { value: values['gponStatus'], unit: '', description: 'GPON Status' };
    if (!t['opticalRx'] && valRx !== null) t['opticalRx'] = { value: String(valRx), unit: 'dBm', description: 'Optical RX' };
    if (!t['opticalTx'] && valTx !== null) t['opticalTx'] = { value: String(valTx), unit: 'dBm', description: 'Optical TX' };
    if (!t['opticalTemperature'] && valTemp !== null) t['opticalTemperature'] = { value: String(valTemp), unit: '°C', description: 'Optical Temperature' };
    if (!t['opticalVoltage'] && valVoltage !== null) t['opticalVoltage'] = { value: String(valVoltage), unit: 'V', description: 'Optical Voltage' };
    if (!t['biasCurrent'] && valBias !== null) t['biasCurrent'] = { value: String(valBias), unit: 'mA', description: 'Bias Current' };
    if (!t['wanBytesReceived'] && values['bytesRx']) t['wanBytesReceived'] = { value: String(parseFloat(values['bytesRx'])), unit: 'B', description: 'WAN Bytes Received' };
    if (!t['wanBytesSent'] && values['bytesTx']) t['wanBytesSent'] = { value: String(parseFloat(values['bytesTx'])), unit: 'B', description: 'WAN Bytes Sent' };

    this.cdr.markForCheck(); // Atualiza interface com os fallbacks
  }

  /**
   * Carrega o snapshot mais recente do TelemetryVitals do banco para carga inicial.
   * Padrão híbrido: popula telemetryData imediatamente ao abrir a aba.
   * WebSocket continua sobrescrevendo em tempo real quando novos dados chegam.
   * Merge defensivo: só preenche campos que ainda estão null (evita sobrescrever WS).
   */
  private loadLatestVitals(): void {
    if (!this.serialNumber) return;

    this.cpeService.getLatestVitals(this.serialNumber)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          if (!res?.data) return;
          const d = res.data;

          // Padrão idêntico ao WebSocket source === 'vitals' (valores brutos, sem wrapper)
          const vitalsFields: Partial<TelemetryData> = {};

          if (d.cpuUsage   != null) vitalsFields['cpuUsage']   = d.cpuUsage;
          if (d.memoryFree != null) vitalsFields['memoryFree']  = d.memoryFree;
          if (d.memoryTotal!= null) vitalsFields['memoryTotal'] = d.memoryTotal;
          if (d.opticalRx  != null) vitalsFields['opticalRx']   = d.opticalRx;
          if (d.opticalTx  != null) vitalsFields['opticalTx']   = d.opticalTx;
          if (d.wanStatus)          vitalsFields['wanStatus']   = d.wanStatus;
          if (d.gponStatus)         vitalsFields['gponStatus']  = d.gponStatus;
          if (d.hostCount  != null) vitalsFields['hostCount']   = d.hostCount;

          // Merge defensivo: spread na ordem (vitals como base, telemetryData existente tem prioridade)
          // Se WebSocket já populou antes do HTTP retornar, campos não-null do telemetryData prevalecem.
          this.telemetryData = {
            ...vitalsFields,
            ...(this.telemetryData || {}),
          } as TelemetryData;

          // Atualizar lastUpdated apenas se não há dado mais recente do WebSocket
          if (!this.lastUpdated && d.timestamp) {
            this.lastUpdated = new Date(d.timestamp);
          }

          this.cdr.detectChanges();
        },
        error: () => {
          // Erro silencioso — o WebSocket cobre o caso de fallback
        }
      });
  }

  /** Busca telemetria do cache Redis SEM disparar coleta na CPE.
   *  Se não houver cache, não faz nada (usuário deve clicar em "Monitorar agora"). */
  loadFromCache(): void {
    if (!this.serialNumber) return;

    this.cpeService.getTelemetryCache(this.serialNumber)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
      next: (res) => {
        if (res.success && res.data) {
          this.telemetryData = { ...(this.telemetryData || {}), ...(res.data as TelemetryData) };
          this.lastUpdated = new Date(res.timestamp);
          this.telemetryCacheService.saveLatestTelemetry(this.serialNumber, this.telemetryData, this.lastUpdated);
          this.telemetryLoading = false;
          this.cdr.markForCheck();
        }
      },
      error: (err) => {
        // Se não houver cache (404), não faz nada - usuário deve clicar em "Monitorar agora"
        if (err.status !== 404) {
          this.telemetryError = 'Erro ao carregar cache de telemetria.';
        }
        this.cdr.markForCheck();
      }
    });
  }

  /**
   * Carrega dados do cache do navegador (localStorage) na inicialização.
   * Mostra dados imediatamente enquanto os dados frescos são buscados.
   */
  private async loadFromFrontendCache(): Promise<void> {
    if (!this.serialNumber) return;

    // Carrega a telemetria mais recente
    const cachedTelemetry = this.telemetryCacheService.loadLatestTelemetry(this.serialNumber);
    if (cachedTelemetry) {
      this.telemetryData = { ...(this.telemetryData || {}), ...(cachedTelemetry.data as TelemetryData) };
      this.lastUpdated = new Date(cachedTelemetry.lastUpdated);
      this.cdr.markForCheck();
    }

    // Carrega o histórico para o período selecionado
    const cachedHistory = await this.telemetryCacheService.loadHistory(this.serialNumber, this.selectedPeriodHours);
    if (cachedHistory) {
      this.rawHistory = cachedHistory;
      this.buildChart();
      this.cdr.markForCheck();
    }
  }

  /** Timeout para desativar o spinner se a CPE não responder em 120s. */
  private telemetryTimeoutId: ReturnType<typeof setTimeout> | null = null;

  /** Solicita telemetria sob demanda ao backend (botão de refresh manual). */
  requestTelemetry(): void {
    this.isPartialResult = false; // Limpa badge de coleta parcial ao iniciar nova coleta
    this.telemetryProgress = 0; // Reseta barra de progresso
    this.completedChunks = 0; // Reseta contador de chunks
    this.totalChunks = 0; // Reseta total de chunks
    this.isPartialCollection = false; // Reseta flag de coleta parcial
    this.vitalsReceived = false; // Reseta flag de vitals recebidos
    // Dispara a esteira. Se já estiver rodando, o exhaustMap ignora o next() internamente.
    this.monitorTrigger$.next();

    // Proteção de timeout: se CPE não responder em 120s, desliga spinner.
    // Segundo clique cancela o timeout anterior antes de criar um novo (sem duplicatas).
    if (this.telemetryTimeoutId) clearTimeout(this.telemetryTimeoutId);
    this.telemetryTimeoutId = setTimeout(() => {
      if (this.telemetryLoading) {
        this.telemetryLoading = false;
        this.toastService.warning('Tempo esgotado: CPE não respondeu em 120s. Verifique a conexão da CPE.');
        this.cdr.markForCheck();
      }
      this.telemetryTimeoutId = null;
    }, 120_000);
  }

  /** Solicita telemetria vitals (8 campos críticos) para resposta rápida (~2s). */
  requestVitals(): void {
    if (this.vitalsLoading) return; // Guard: previne múltiplas requisições simultâneas
    this.vitalsLoading = true;

    // Failsafe: libera o botão se WebSocket não chegar em 30s após HTTP 202.
    // Cobre edge cases onde CR falha silenciosamente e stall não resolve o loading.
    timer(30000).pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      if (this.vitalsLoading) {
        this.vitalsLoading = false;
        this.cdr.markForCheck();
      }
    });

    this.cpeService.requestVitals(this.serialNumber).pipe(
      takeUntilDestroyed(this.destroyRef),
      timeout(30000), // Timeout 30s
      catchError((err) => {
        this.vitalsLoading = false;
        this.toastService.error(err.error?.error || 'Erro ao conectar com a CPE.');
        return EMPTY;
      })
    ).subscribe({
      next: (response: any) => {
        this.vitalsLoading = false;
        if (response.source === 'cache' || response.source === 'mongodb_stale') {
          this.toastService.info('Vitals: dados em cache (< 60s).');
        } else if (response.status === 'accepted') {
          this.toastService.info('Vitals já em andamento. Aguarde o WebSocket.');
        } else if (response.status === 'queued') {
          this.toastService.info('Coleta vitals enfileirada. Aguarde atualização via WebSocket.');
        } else {
          this.toastService.success('Vitals iniciado na CPE.');
        }
        this.cdr.markForCheck();
      }
    });
  }

  /** Carrega análise avançada agregada do backend. */
  loadAnalysis(): void {
    if (!this.serialNumber) return;
    this.analysisLoading = true;
    this.cpeService.getTelemetryAnalysis(this.serialNumber)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
      next: (res) => {
        this.analysisData = res as TelemetryAnalysis;
        this.analysisUpdatedAt = new Date(); // timestamp local do carregamento
        this.analysisLoading = false;
        this.cdr.markForCheck();
      },
      error: () => {
        this.analysisLoading = false;
        this.analysisError = 'Erro ao carregar análise avançada.';
        this.cdr.markForCheck();
      }
    });
  }

  loadWanConfig(): void {
    if (!this.cpe) return;
    this.wanConfigFields = {
      pppoeUsername: this.cpe.pppoeUsername || '',
      dnsServer1:   (this.cpe.wanDnsManual && this.cpe.wanDnsManual[0]) || '',
      dnsServer2:   (this.cpe.wanDnsManual && this.cpe.wanDnsManual[1]) || '',
      mtu:          this.cpe.wanMtu    || 1492,
      vlanId:       this.cpe.wanVlanId || 0,
    };
    this.isEditingWanConfig = true;
  }

  saveWanConfig(): void {
    if (!this.serialNumber) return;
    const payload: Record<string, unknown> = {};
    const f = this.wanConfigFields;
    const c = this.cpe;

    if (f.pppoeUsername !== (c?.pppoeUsername || ''))
      payload['pppoeUsername'] = f.pppoeUsername;
    if (f.dnsServer1 !== ((c?.wanDnsManual && c.wanDnsManual[0]) || ''))
      payload['dnsServer1'] = f.dnsServer1;
    if (f.dnsServer2 !== ((c?.wanDnsManual && c.wanDnsManual[1]) || ''))
      payload['dnsServer2'] = f.dnsServer2;
    if (f.mtu && f.mtu !== (c?.wanMtu || 1492))
      payload['mtu'] = f.mtu;
    if (f.vlanId !== undefined && f.vlanId !== (c?.wanVlanId || 0))
      payload['vlanId'] = f.vlanId;

    if (!Object.keys(payload).length) {
      this.toastService.warning('Nenhuma alteração detectada.');
      this.isEditingWanConfig = false;
      return;
    }

    this.wanConfigSaving = true;
    this.cpeService.updateWanConfig(this.serialNumber, payload).pipe(
      takeUntilDestroyed(this.destroyRef),
      catchError((err: { error?: { error?: string } }) => {
        this.wanConfigSaving = false;
        this.toastService.error(err.error?.error || 'Erro ao atualizar configuração WAN.');
        return EMPTY;
      })
    ).subscribe({
      next: () => {
        this.wanConfigSaving   = false;
        this.isEditingWanConfig = false;
        this.toastService.success('Configuração WAN enviada. A CPE será atualizada na próxima conexão.');
        this.cdr.markForCheck();
      }
    });
  }

  /** Carrega painéis suplementares (Health Score, Alertas, Incidente, Intervenção). */
  private loadSupplementaryPanels(): void {
    if (!this.serialNumber) return;

    this.cpeService.getHealthScoreBreakdown(this.serialNumber).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (res) => { this.healthScoreBreakdown = res; this.cdr.detectChanges(); },
      error: () => { /* silencioso — painel opcional */ },
    });

    this.cpeService.getCpeAlerts(this.serialNumber).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (res) => { this.cpeAlerts = res.data; this.cdr.detectChanges(); },
      error: () => { /* silencioso */ },
    });

    this.cpeService.getIncidentStatus(this.serialNumber).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (res) => { this.incidentStatus = res; this.cdr.detectChanges(); },
      error: () => { /* silencioso */ },
    });

    this.cpeService.getLastIntervention(this.serialNumber).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (res) => { this.lastIntervention = res; this.cdr.detectChanges(); },
      error: () => { /* silencioso */ },
    });
  }

  /** Escuta o evento específico bruto de VALUE CHANGE (TR-181) */
  private listenForCpeValueChange(): void {
    // Verifica se o método existe no serviço WebSocket
    const wsService = this.wsService as { onCpeValueChange?: () => any };
    if (typeof wsService.onCpeValueChange !== 'function') return;

    wsService.onCpeValueChange()
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        // OTIMIZAÇÃO (Micro-batching RxJS): Agrupa os eventos de Value Change passivos
        // em janelas de 500ms para evitar travamentos na UI e Toast Spam gerados por CPEs ruidosas.
        bufferTime(500),
        filter((events: ValueChangeEvent[]) => events.length > 0)
      )
      .subscribe((events: ValueChangeEvent[]) => {
        this.ngZone.run(() => {
          // Filtra estritamente os eventos direcionados a esta CPE
          const cpeEvents = events.filter((e: ValueChangeEvent) => e.serialNumber === this.serialNumber);
          if (cpeEvents.length === 0) return;

          let hasWanStatusChange = false;

          // Processa e consolida o lote de Value Changes iterativamente
          cpeEvents.forEach((event: ValueChangeEvent) => {
            if (event.changeType === 'wan_status_change') hasWanStatusChange = true;
          });

          // Notificação consolidada (Estresse Zero UX)
          if (hasWanStatusChange) {
            this.toastService.warning('Mudança de Rede: O status da interface WAN da CPE foi alterado.');
          }
          this.cdr.detectChanges(); // Renderiza o DOM imediatamente
        });
      });
  }

  /** Escuta alertas de telemetria (onTelemetryAlert, onTelemetryAlertResolved, onTelemetryAlertBatch) */
  private listenForAlerts(): void {
    const wsService = this.wsService as {
      onTelemetryAlert?: () => any;
      onTelemetryAlertResolved?: () => any;
      onTelemetryAlertBatch?: () => any;
    };

    // onTelemetryAlert: alerta individual
    if (typeof wsService.onTelemetryAlert === 'function') {
      wsService.onTelemetryAlert()
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe((alert: TelemetryAlert) => {
          if (alert.serialNumber === this.serialNumber) {
            this.ngZone.run(() => {
              this.cpeAlerts = [alert, ...this.cpeAlerts].slice(0, 50);
              this.cdr.detectChanges();
            });
          }
        });
    }

    // onTelemetryAlertResolved: alerta resolvido
    if (typeof wsService.onTelemetryAlertResolved === 'function') {
      wsService.onTelemetryAlertResolved()
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe((event: { serialNumber: string; metric: string }) => {
          if (event.serialNumber === this.serialNumber) {
            this.ngZone.run(() => {
              this.cpeAlerts = this.cpeAlerts.filter(a => a.metric !== event.metric);
              this.cdr.detectChanges();
            });
          }
        });
    }

    // onTelemetryAlertBatch: lote de alertas
    if (typeof wsService.onTelemetryAlertBatch === 'function') {
      wsService.onTelemetryAlertBatch()
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe((batch: { alerts: TelemetryAlert[]; count: number }) => {
          const cpeAlerts = batch.alerts.filter((a: TelemetryAlert) => a.serialNumber === this.serialNumber);
          if (cpeAlerts.length > 0) {
            this.ngZone.run(() => {
              this.cpeAlerts = [...cpeAlerts, ...this.cpeAlerts].slice(0, 50);
              this.cdr.detectChanges();
            });
          }
        });
    }
  }

  /** Escuta eventos de presença Single Driver (presence_conflict e driver_promoted) */
  private listenForPresenceEvents(): void {
    // Verifica se o método existe no serviço WebSocket
    const wsService = this.wsService as { onPresenceConflict?: () => any; onDriverPromoted?: () => any; onCpeLocked?: () => any; onCpeUnlocked?: () => any; onDriverAcquired?: () => any; onViewOnly?: () => any; onDriverReleased?: () => any; onForceViewOnly?: () => any; onViewersUpdated?: () => any };

    // ── Escuta driver_acquired: usuário adquiriu controle de Driver ──
    if (typeof wsService.onDriverAcquired === 'function') {
      wsService.onDriverAcquired()
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe((event: { serialNumber: string; username: string }) => {
          if (event.serialNumber === this.serialNumber) {
            this.ngZone.run(() => {
              this.isViewOnly = false;
              this.cdr.markForCheck();
            });
          }
        });
    }

    // ── Escuta view_only: usuário entrou em modo View-Only ──
    if (typeof wsService.onViewOnly === 'function') {
      wsService.onViewOnly()
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe((event: { serialNumber: string; driver: string; message: string }) => {
          if (event.serialNumber === this.serialNumber) {
            this.ngZone.run(() => {
              this.isViewOnly = true;
              this.toastService.warning(event.message);
              this.cdr.markForCheck();
            });
          }
        });
    }

    // ── Escuta force_view_only: Backend forçou View-Only por latência ──
    if (typeof wsService.onForceViewOnly === 'function') {
      wsService.onForceViewOnly()
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe((event: { serialNumber: string; message: string }) => {
          if (event.serialNumber === this.serialNumber) {
            this.ngZone.run(() => {
              this.isViewOnly = true;
              this.toastService.warning(event.message);
              this.cdr.markForCheck();
            });
          }
        });
    }

    // ── Escuta driver_released: Driver liberou controle ──
    if (typeof wsService.onDriverReleased === 'function') {
      wsService.onDriverReleased()
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe((event: { serialNumber: string }) => {
          if (event.serialNumber === this.serialNumber) {
            this.ngZone.run(() => {
              // Habilita botão "Assumir Controle"
              this.isViewOnly = false;
              this.cdr.markForCheck();
            });
          }
        });
    }

    // ── Escuta viewers_updated: Lista de visualizadores atualizada ──
    if (typeof wsService.onViewersUpdated === 'function') {
      wsService.onViewersUpdated()
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe((event: { serialNumber: string; viewers: string[] }) => {
          if (event.serialNumber === this.serialNumber) {
            this.ngZone.run(() => {
              // Atualiza lista de visualizadores (para renderizar avatares)
              this.viewers = event.viewers;
              this.cdr.markForCheck();
            });
          }
        });
    }

    // ── Escuta cpe_locked: CPE está em tráfego CWMP ativo ──
    if (typeof wsService.onCpeLocked === 'function') {
      wsService.onCpeLocked()
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe((event: { serialNumber: string; source: string }) => {
          if (event.serialNumber === this.serialNumber) {
            this.ngZone.run(() => {
              this.isCpeBusy = true;
              this.cdr.markForCheck();
            });
          }
        });
    }

    // ── Escuta cpe_unlocked: CPE está livre ──
    if (typeof wsService.onCpeUnlocked === 'function') {
      wsService.onCpeUnlocked()
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe((event: { serialNumber: string }) => {
          if (event.serialNumber === this.serialNumber) {
            this.ngZone.run(() => {
              this.isCpeBusy = false;
              this.cdr.markForCheck();
            });
          }
        });
    }
  }

  /** Inicia ciclo de heartbeat para manter controle de Driver */
  private startHeartbeat(): void {
    if (!this.serialNumber) return;
    // Emite driver_keepalive a cada 30 segundos para renovar TTL no Redis
    // Usa takeUntilDestroyed para limpeza automática e verifica socket.connected
    interval(30000)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        filter(() => this.wsService['socket']?.connected === true)
      )
      .subscribe(() => {
        this.wsService.emitDriverKeepalive(this.serialNumber);
      });
  }

  /** Escuta WebSocket de telemetria para esta CPE. */
  private listenForTelemetryUpdates(): void {
    this.wsService.onTelemetryUpdate()
      .pipe(
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((event: TelemetryUpdateEvent) => {
        this.ngZone.run(() => {
          // Filtra estritamente os eventos direcionados a esta CPE
          if (event.serialNumber !== this.serialNumber) return;
  
          if (this.telemetryTimeoutId) {
            clearTimeout(this.telemetryTimeoutId);
            this.telemetryTimeoutId = null;
          }

          // Roteamento por source: vitals vs standard
          if (event.source === 'vitals' || event.source === 'on-demand-vitals') {
            // Atualiza APENAS os campos vitais — não sobrescreve dados completos
            const vitalsKeys = [
              'wanStatus', 'cpuUsage', 'memoryFree', 'memoryTotal',
              'opticalRx', 'opticalTx', 'gponStatus',
              'upTime',              // tempo ligada — faltava
              'opticalTemperature',  // temperatura do transceptor — faltava
              'biasCurrent',         // corrente de bias — faltava
              'opticalVoltage',      // tensão da fonte — faltava
              'wifi2gNoise', 'wifi5gNoise',
              'wifi2gSnr', 'wifi5gSnr',        // SNR — faltava
              'wifi2gSignalStrength', 'wifi5gSignalStrength', // sinal — faltava
              'hostCount',
            ];
            const vitalsData: Partial<TelemetryData> = {};
            if (event.data && typeof event.data === 'object') {
              for (const k of vitalsKeys) {
                if (event.data[k] !== undefined) vitalsData[k] = event.data[k];
              }
              this.telemetryData = { ...(this.telemetryData || {}), ...vitalsData };
            }
            this.vitalsReceived = true;
            this.vitalsLoading = false;
          } else {
            // Source 'standard' ou 'on-demand': atualiza todos os campos
            if (event.data && typeof event.data === 'object') {
              this.telemetryData = { ...(this.telemetryData || {}), ...event.data };
            }
          }
          this.lastUpdated = new Date(event.timestamp);
          this.telemetryCacheService.saveLatestTelemetry(this.serialNumber, this.telemetryData!, this.lastUpdated);

          const hasPartial = event.partial;
          const hasPassive = event.source === 'inform_passive';
          const isBackground = event.tabContext === 'background';

          // ── ATUALIZAÇÃO DE GRÁFICO O(1) VIA WebSocket ─────────────────────
          // Atualiza gráficos para qualquer fonte (on-demand, passive, scheduler)
          // para visualização contínua de métricas em tempo real.
          if (event.data) {
            this.addTelemetryPointToChart(event.data, event.timestamp);
          }

          if (event.data) {
            Object.keys(event.data).forEach(key => this.triggerFlash(key));
          }

          this.telemetryLoading = false;

          // Auto-seleciona o rádio Wi-Fi com mais clientes quando dados chegam
          this.autoSelectWifiTab();

          // Persiste estado de coleta parcial para o template (badge amarelo)
          this.isPartialResult = hasPartial ?? false;

          // Consolida as notificações visuais (Evita Toast Spam UI)
          if (hasPartial) {
            this.toastService.warning(event.message || 'Coleta parcial — alguns lotes não responderam.');
          } else if (hasPassive) {
            this.toastService.info('Active Notification: A CPE atualizou dados de telemetria passivamente.');
          } else if (!isBackground) {
            // UX: Evita Spam de Toast. Polling de background só ativa o update e o flash visual das cards.
            this.toastService.success('Telemetria recebida em tempo real.');
          }

          // Força CD para atualizar cards de telemetria (mesmo sem dados de gráfico)
          this.cdr.detectChanges();
        });
      });
  }

  /** Escuta evento de conclusão de telemetria via WebSocket para desligar spinner */
  private listenForTelemetryComplete(): void {
    const wsService = this.wsService as { onTelemetryComplete?: () => any };
    if (typeof wsService.onTelemetryComplete !== 'function') return;

    wsService.onTelemetryComplete()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((data: any) => {
        if (data.serialNumber === this.serialNumber) {
          this.ngZone.run(() => {
            // telemetry_complete carrega { serialNumber, timestamp, totalChunks, source }
            // Fontes que NÃO devem fechar o spinner on-demand: scheduler e inform passivo
            const isPassiveSource = data.source === 'standard' || data.source === 'scheduler';
            if (!isPassiveSource) {
              // on-demand (batch único) — fecha spinner principal
              this.telemetryLoading = false;
              this.vitalsLoading = false;
              this.telemetryProgress = 0;
              this.completedChunks = 0;
              this.totalChunks = 0;

              // Toast de conclusão — o único feedback explícito de "coleta finalizada"
              if (data.partial) {
                this.toastService.warning('Coleta parcial concluída — alguns parâmetros não responderam.');
              } else {
                this.toastService.success('Coleta de telemetria concluída com sucesso.');
                // Recarrega análise com delay de 2s para garantir que cwmpController
                // completou a persistência no MongoDB antes da query de análise rodar.
                // Só dispara para coletas on-demand completas (não parciais nem passivas).
                timer(2000).pipe(take(1), takeUntilDestroyed(this.destroyRef))
                  .subscribe(() => this.loadAnalysis());
              }
            }
            if (data.partial) {
              this.isPartialResult = true;
              this.isPartialCollection = true;
            }
            if (this.telemetryTimeoutId) {
              clearTimeout(this.telemetryTimeoutId);
              this.telemetryTimeoutId = null;
            }
            this.cdr.markForCheck();
          });
        }
      });
  }

  /** Escuta evento de progresso de telemetria por chunk para atualizar barra de progresso */
  private listenForTelemetryProgress(): void {
    const wsService = this.wsService as { onTelemetryProgress?: () => any };
    if (typeof wsService.onTelemetryProgress !== 'function') return;

    wsService.onTelemetryProgress()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((data: any) => {
        if (data.serialNumber === this.serialNumber) {
          this.ngZone.run(() => {
            this.telemetryProgress = data.percent || 0;
            this.completedChunks = data.completedChunks || 0;
            this.totalChunks = data.totalChunks || 0;
            if (data.partial) {
              this.isPartialCollection = true;
            }
            this.cdr.markForCheck();
          });
        }
      });
  }

  // ── Gráfico de histórico (últimas 6h) ──────────────────────────────────

  /**
   * Helper seguro para extrair valores numéricos de telemetria.
   * Suporta ambas estruturas: { value: number } e plano { number }.
   * @param data - Objeto de dados de telemetria
   * @param key - Chave da métrica (ex: 'cpuUsage', 'memoryFree')
   * @returns Valor numérico ou null se inválido
   */
  private safeExtractValue(data: TelemetryData, key: string): number | null {
    const item = data[key];
    if (item === null || item === undefined) return null;
    
    // Suporta ambos os formatos do backend:
    //   { value: "27", unit: "%" }  ← WebSocket (string)
    //   { value: 27, unit: "%" }    ← possível futuro (number direto)
    if (typeof item === 'object' && 'value' in item) {
      if (item.value === null || item.value === undefined || item.value === '') return null;
      const num = Number(item.value);
      return isNaN(num) ? null : num;
    }
    
    // Suporta plain number (compatibilidade com dados já numéricos)
    if (typeof item === 'number') return item;
    
    // Suporta string sem wrapper (edge case de normalização futura)
    if (typeof item === 'string' && item.trim() !== '') {
      const num = Number(item);
      return isNaN(num) ? null : num;
    }
    
    return null;
  }

  /**
   * Altera o período do histórico e recarrega os dados do gráfico.
   * @param hours - O período em horas (1, 6, 24).
   */
  changeHistoryPeriod(hours: number): void {
    // Removido o bloqueio '|| this.historyLoading' permitindo ao RxJS abortar a request
    // anterior para não prejudicar a intenção rápida do usuário (UX / Race Condition fix)
    if (this.selectedPeriodHours === hours) return;
    this.selectedPeriodHours = hours;
    
    // Limpa arrays de gráficos para evitar mistura de dados de períodos diferentes
    this.chartLabels = [];
    this.chartDatasets = [];
    this.opticalChartLabels = [];
    this.opticalChartDatasets = [];
    
    this.loadHistory();
  }

  /** Carrega raw history e monta datasets do Chart.js. */
  loadHistory(): void {
    if (!this.serialNumber) return;
    this.historyLoading = true;

    // Cancela a requisição anterior se o técnico clicar rápido demais (Race Condition Prevention)
    if (this.historySub) {
      this.historySub.unsubscribe();
    }

    this.historySub = this.cpeService.getTelemetryVitalsHistory(this.serialNumber, this.selectedPeriodHours)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
      next: async (res) => {
        this.rawHistory = (res.data as TelemetrySnapshot[]) || [];
        await this.telemetryCacheService.saveHistory(this.serialNumber, this.selectedPeriodHours, this.rawHistory);
        this.buildChart();
        this.historyLoading = false;
        this.cdr.detectChanges();
      },
      error: (err) => {
        console.error('[loadHistory] Erro ao carregar histórico:', err);
        // Garante que buildChart() seja chamado mesmo em erro (datasets vazios)
        this.buildChart();
        this.cdr.detectChanges();
      }
    });
  }

  /** Extrai valor de documento TelemetryRaw (nested) ou evento WebSocket (flat) */
  private extractHistoryValue(d: any, flatKey: string, nestedPath: string[]): number | null {
    // Tenta flat primeiro (compatibilidade com eventos WebSocket ao vivo)
    const flat = d?.[flatKey];
    if (typeof flat === 'number') return flat;
    // Lê nested (documentos TelemetryRaw do MongoDB)
    let cur: any = d;
    for (const key of nestedPath) {
      cur = cur?.[key];
      if (cur == null) return null;
    }
    return typeof cur === 'number' ? cur : null;
  }

  private buildChart(): void {
    const data = this.rawHistory;
    if (data.length === 0) {
      this.chartLabels = [];
      this.chartDatasets = [
        createChartDataset('CPU (%)', '#7c3aed', []),
        createChartDataset('Memória Usada (%)', '#06b6d4', []),
      ];
      this.opticalChartLabels = [];
      this.opticalChartDatasets = [
        createChartDataset('RX (dBm)', '#10b981', []),
        createChartDataset('TX (dBm)', '#f59e0b', []),
      ];
      // Novas referências dos objetos wrapper
      this.chartData         = { labels: this.chartLabels, datasets: this.chartDatasets };
      this.opticalChartData = { labels: this.opticalChartLabels, datasets: this.opticalChartDatasets };
      this.cdr.detectChanges();
      return;
    }

    // OTIMIZAÇÃO: Loop O(n) único. Substitui 5 `data.map()` independentes para construir
    // os labels e os dados das linhas em uma única varredura. Economiza milhares de
    // ciclos da CPU em matrizes de dados longos (Histórico de 24h).
    const labels: string[] = [];
    const cpuData: (number | null)[] = [];
    const memData: (number | null)[] = [];
    const rxData: (number | null)[] = [];
    const txData: (number | null)[] = [];

    for (const d of data) {
        labels.push(this.timeFormatter.format(new Date(d.timestamp)));

        cpuData.push(this.extractHistoryValue(d, 'cpuUsage', ['telemetry','system','cpuUsage']));

        const memFree = this.extractHistoryValue(d, 'memoryFree', ['telemetry','system','memoryFree']);
        const memTotal = this.extractHistoryValue(d, 'memoryTotal', ['telemetry','system','memoryTotal']);
        memData.push(memFree !== null && memTotal !== null && memTotal > 0
          ? Math.round(((memTotal - memFree) / memTotal) * 100)
          : null);

        rxData.push(this.extractHistoryValue(d, 'opticalRx', ['telemetry','optical','rxPower']));  // ← nome diferente!
        txData.push(this.extractHistoryValue(d, 'opticalTx', ['telemetry','optical','txPower']));  // ← nome diferente!
    }

    this.chartLabels = labels;
    this.opticalChartLabels = labels;

    this.chartDatasets = [
      createChartDataset('CPU (%)', '#7c3aed', cpuData),
      createChartDataset('Memória Usada (%)', '#06b6d4', memData),
    ];

    this.opticalChartDatasets = [
      createChartDataset('RX (dBm)', '#10b981', rxData),
      createChartDataset('TX (dBm)', '#f59e0b', txData),
    ];

    // Novas referências dos objetos wrapper (ng2-charts detecta mudança no input [data])
    this.chartData         = { labels: this.chartLabels, datasets: this.chartDatasets };
    this.opticalChartData = { labels: this.opticalChartLabels, datasets: this.opticalChartDatasets };

    this.cdr.detectChanges(); // Renderiza imediatamente o gráfico
  }

  /**
   * Adiciona um novo ponto de telemetria ao gráfico em O(1) via WebSocket.
   * Evita requisição HTTP adicional para recarregar o histórico.
   * @param data - Dados de telemetria recebidos via WebSocket
   * @param timestamp - Timestamp do dado
   */
  private addTelemetryPointToChart(data: TelemetryData, timestamp: string): void {
    // ── PARTE SÍNCRONA: atualiza gráfico imediatamente (antes do detectChanges) ──
    const cpuValue = this.safeExtractValue(data, 'cpuUsage');
    const memFree = this.safeExtractValue(data, 'memoryFree');
    const memTotal = this.safeExtractValue(data, 'memoryTotal');
    const memValue = (memFree !== null && memTotal !== null && memTotal > 0)
      ? Math.round(((memTotal - memFree) / memTotal) * 100)
      : null;
    const rxValue = this.safeExtractValue(data, 'opticalRx');
    const txValue = this.safeExtractValue(data, 'opticalTx');

    const timeLabel = this.timeFormatter.format(new Date(timestamp));

    this.chartLabels.push(timeLabel);
    this.opticalChartLabels.push(timeLabel);

    if (this.chartDatasets[0]) this.chartDatasets[0].data.push(cpuValue);
    if (this.chartDatasets[1]) this.chartDatasets[1].data.push(memValue);
    if (this.opticalChartDatasets[0]) this.opticalChartDatasets[0].data.push(rxValue);
    if (this.opticalChartDatasets[1]) this.opticalChartDatasets[1].data.push(txValue);

    const MAX_POINTS = 100;
    if (this.chartLabels.length > MAX_POINTS) {
      this.chartLabels.shift();
      this.opticalChartLabels.shift();
      this.chartDatasets.forEach(ds => ds.data.shift());
      this.opticalChartDatasets.forEach(ds => ds.data.shift());
    }

    // Novas referências para ng2-charts detectar a mudança (OnPush)
    this.chartLabels           = [...this.chartLabels];
    this.chartDatasets         = this.chartDatasets.map(ds => ({ ...ds, data: [...ds.data] }));
    this.opticalChartLabels    = [...this.opticalChartLabels];
    this.opticalChartDatasets  = this.opticalChartDatasets.map(ds => ({ ...ds, data: [...ds.data] }));

    // Novas referências dos objetos wrapper (ng2-charts detecta mudança no input [data])
    this.chartData             = { labels: this.chartLabels, datasets: this.chartDatasets };
    this.opticalChartData     = { labels: this.opticalChartLabels, datasets: this.opticalChartDatasets };

    // Nota: detectChanges() é chamado no listener listenForTelemetryUpdates() (linha 842)
    // para garantir que cards de telemetria atualizem mesmo sem dados de gráfico.

    // ── PARTE ASSÍNCRONA: persiste no cache (fire-and-forget, não bloqueia CD) ──
    const newSnapshot: TelemetrySnapshot = {
      timestamp: new Date(timestamp).toISOString(),
      cpuUsage: cpuValue ?? undefined,
      memoryUsage: memValue ?? undefined,
      opticalRx: rxValue ?? undefined,
      opticalTx: txValue ?? undefined,
    };

    this.telemetryCacheService.loadHistory(this.serialNumber, this.selectedPeriodHours)
      .then(currentHistory => {
        const updatedHistory = [...(currentHistory || []), newSnapshot];
        if (updatedHistory.length > MAX_POINTS) {
          updatedHistory.splice(0, updatedHistory.length - MAX_POINTS);
        }
        return this.telemetryCacheService.saveHistory(this.serialNumber, this.selectedPeriodHours, updatedHistory);
      })
      .catch(err => console.warn('Erro ao persistir snapshot no cache:', err));
  }

}
