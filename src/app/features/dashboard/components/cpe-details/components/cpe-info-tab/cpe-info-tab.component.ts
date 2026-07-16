import {
  Component,
  Input,
  OnInit,
  OnDestroy,
  OnChanges,
  SimpleChanges,
  DestroyRef,
  inject,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  filter,
  interval,
  Subject,
  EMPTY,
  timer,
  timeout,
  retry,
  switchMap,
} from 'rxjs';
import { exhaustMap, catchError, bufferTime } from 'rxjs/operators';
import { ChartDataset, ChartOptions } from 'chart.js';
import { NgChartsModule } from 'ng2-charts';
import {
  CpeDevice,
  TelemetryAlert,
  TelemetryAnalysis,
  TelemetryData,
  TelemetryMetric,
  TelemetrySnapshot,
} from '../../../../../../core/models';
import { environment } from '../../../../../../../environments/environment';
import { CpeService } from '../../../../../../core/services/cpe.service';
import { WebSocketService } from '../../../../../../core/services/websocket.service';
import { ToastService } from '../../../../../../core/services/toast.service';
import { DiagnosticParserService } from '../../../../../../core/services/diagnostic-parser.service';
import { TelemetryCacheService } from '../../../../../../core/services/telemetry-cache.service';
import { MetricPipe } from '../../../../../../core/pipes/metric.pipe';
import { IconTooltipComponent } from '../../../../../../core/components/icon-tooltip/icon-tooltip.component';

// ── Tipagem forte para eventos WebSocket ──
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

interface TelemetryAlertEvent {
  serialNumber: string;
  metric: string;
  severity: string;
  value: number;
  message: string;
  timestamp: string;
}

// ── Constants de configuração ──
const TELEMETRY_CONFIG = {
  REQUEST_TIMEOUT_MS: 45_000,
  VITALS_TIMEOUT_MS: 30_000,
  CACHE_TTL_MS: 60_000,
  RETRY_ATTEMPTS: 2,
  RETRY_DELAY_MS: 2_000,
  MAX_FLASH_TIMERS: 30,
  FLASH_DURATION_MS: 2_000,
  HEARTBEAT_INTERVAL_MS: 30_000,
  VALUE_CHANGE_BUFFER_MS: 500,
} as const;

// ── Limites de listas e gráfico ──
// Centralizados aqui para facilitar ajuste sem caçar magic numbers no código.
const MAX_CHART_POINTS = 100; // pontos máximos em tempo real no gráfico
const MAX_ALERT_ENTRIES = 50; // entradas máximas no array cpeAlerts

// ── Thresholds ópticos (dBm) ──
const RX_THRESHOLDS = {
  OK: -22,
  WARNING: -27,
} as const;

const TX_THRESHOLDS = {
  OK: -5,
  WARNING: -8,
} as const;

// ── Métricas visíveis para flash visual (limitado a ~15 para não esgotar MAX_FLASH_TIMERS) ──
const FLASH_VISIBLE_METRICS = new Set<string>([
  'cpuUsage',
  'memoryFree',
  'memoryTotal',
  'uptime',
  'opticalRx',
  'opticalTx',
  'opticalTemperature',
  'opticalVoltage',
  'biasCurrent',
  'wanStatus',
  'wanDownstreamRate',
  'wanUpstreamRate',
  'wanNativeLatency',
  'wifi2gClients',
  'wifi5gClients',
]);

// ── Logging estruturado ──
const LOG_PREFIX = '[CpeInfoTab]';

function logInfo(message: string, data?: unknown): void {
  if (!environment.production)
    console.log(`${LOG_PREFIX} ${message}`, data || '');
}

function logWarn(message: string, data?: unknown): void {
  if (!environment.production)
    console.warn(`${LOG_PREFIX} ${message}`, data || '');
}

function logError(message: string, error?: unknown): void {
  // erros são sempre logados (inclusive em produção) para facilitar diagnóstico de incidentes
  console.error(`${LOG_PREFIX} ${message}`, error || '');
}

// ── Guard de validação de dados ──
/**
 * Validação estrutural de payload de telemetria recebido via WebSocket.
 * Verifica que é objeto (não string/número/array). Aceita objeto vazio
 * como "partial válido" (backend emite data:{} quando nenhum chunk respondeu).
 * Rejeita payloads não-objeto que poderiam corromper o estado do componente.
 */
export function isValidTelemetryData(data: unknown): data is TelemetryData {
  if (!data || typeof data !== 'object') return false;
  // Array é objeto em JS mas não é payload de telemetria válido
  if (Array.isArray(data)) return false;
  return true;
}

/**
 * Verifica se o payload tem pelo menos 1 campo de telemetria conhecido
 * com tipo primitivo válido. Usado para decidir se atualiza gráfico.
 */
const TELEMETRY_KNOWN_FIELDS = [
  'cpuUsage',
  'memoryFree',
  'memoryTotal',
  'memUsedPercent',
  'opticalRx',
  'opticalTx',
  'uptime',
  'wanStatus',
  'gponStatus',
  'hostCount',
  'wanLatency',
  'wanJitter',
] as const;

export function hasTelemetryFields(data: unknown): boolean {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
  const obj = data as Record<string, unknown>;
  return TELEMETRY_KNOWN_FIELDS.some(
    (field) =>
      obj[field] !== undefined &&
      obj[field] !== null &&
      (typeof obj[field] === 'number' ||
        typeof obj[field] === 'string' ||
        typeof obj[field] === 'boolean'),
  );
}

/**
 * Valida serial number com regex alfanumérica (alinhada com backend SERIAL_REGEX).
 * Previne injection de caracteres perigosos em chamadas HTTP e WebSocket.
 * Backend: /^[A-Za-z0-9\-.]{1,64}$/ (src/validators/schemas.js linha 25)
 */
const SERIAL_REGEX = /^[A-Za-z0-9\-.]{4,64}$/;

export function isValidSerialNumber(serial: string): boolean {
  return typeof serial === 'string' && SERIAL_REGEX.test(serial);
}

/** Valida se uma string é um endereço IPv4 válido */
function isValidIPv4(ip: string): boolean {
  if (!ip || typeof ip !== 'string') return false;
  const parts = ip.split('.');
  if (parts.length !== 4) return false;
  return parts.every((part) => {
    const num = parseInt(part, 10);
    return !isNaN(num) && num >= 0 && num <= 255 && part === String(num);
  });
}

// Interface para snapshots de intervenção (retorno aninhado de getLastIntervention)
interface InterventionSnapshot {
  source: string;
  createdAt: string;
  telemetry?: {
    optical?: { rxPower?: number };
    system?: { cpuUsage?: number };
    wan?: Record<string, unknown>;
  };
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
      labels: { color: '#94a3b8', font: { size: 12 } },
    },
    tooltip: {
      backgroundColor: 'rgba(15, 18, 39, 0.95)',
      titleColor: '#f8fafc',
      bodyColor: '#e2e8f0',
      borderWidth: 1,
    },
  },
  scales: {
    x: {
      ticks: { color: '#94a3b8', maxTicksLimit: 8 },
      grid: { color: 'rgba(255,255,255,0.05)' },
    },
    y: {
      ticks: { color: '#94a3b8' },
      grid: { color: 'rgba(255,255,255,0.05)' },
    },
  },
};

// Map de suffixos para chaves de destino (estático para evitar recriação)
const PARAM_MAP: ReadonlyArray<[string, string]> = [
  ['cpuusage', 'cpu'],
  ['cpu', 'cpu'], // Mapeamento direto para compatibilidade com backend
  ['memoryfree', 'memFree'],
  ['memorystatus.free', 'memFree'],
  ['memorytotal', 'memTotal'],
  ['memorystatus.total', 'memTotal'],
  ['uptime', 'uptime'],
  ['xponstatus', 'gponStatus'],
  ['rxpower', 'rxPower'],
  ['opticalsignallevel', 'rxPower'],
  ['txpower', 'txPower'],
  ['transceivertemperature', 'temp'],
  ['temperature', 'temp'], // Mapeamento direto para temperatura do SoC
  ['supplyvottage', 'voltage'], // typo intencional do firmware TP-Link (SupplyVottage ≠ SupplyVoltage)
  ['supplyvoltage', 'voltage'],
  ['biascurrent', 'bias'],
  ['bytesreceived', 'bytesRx'],
  ['optical.interface.1.stats.bytesreceived', 'bytesRx'],
  ['bytessent', 'bytesTx'],
  ['optical.interface.1.stats.bytessent', 'bytesTx'],
];

// Configuração base de datasets (estática para evitar recriação)
const hexToRgba = (hex: string, alpha: number): string => {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

const createChartDataset = (
  label: string,
  color: string,
  data: (number | null)[],
): ChartDataset<'line'> => ({
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
  imports: [
    CommonModule,
    FormsModule,
    NgChartsModule,
    MetricPipe,
    IconTooltipComponent,
  ],
  templateUrl: './cpe-info-tab.component.html',
  styleUrls: ['./cpe-info-tab.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CpeInfoTabComponent implements OnInit, OnDestroy, OnChanges {
  /** Dados da CPE vindo do componente pai. */
  @Input() cpe: CpeDevice | null = null;
  /** Número de série para requisições de telemetria. */
  @Input() serialNumber: string = '';
  /** CPE está offline — bloqueia coleta de telemetria, vitals e config WAN. */
  @Input() isCpeOffline: boolean = false;

  private destroyRef = inject(DestroyRef); // Gerenciador de ciclo de vida moderno do Angular 17+
  private cdr = inject(ChangeDetectorRef); // Injetor para disparar atualizações manuais na UI

  // ── Telemetria em tempo real ─────────────────────────────────────────────
  telemetryData: TelemetryData | null = null;
  lastUpdated: Date | null = null;
  telemetryLoading = false;
  telemetryError: string | null = null;

  // ── Two-Phase UI State (Vitals + Standard) ─────────────────────────────────
  vitalsLoading = false; // indicador rápido (vitals)

  // ── Progresso de coleta por chunk ─────────────────────────────────────────
  telemetryProgress = 0; // 0-100%
  completedChunks = 0;
  totalChunks = 0;
  isPartialCollection = false; // true quando chunk falhou (partial: true)
  suppressChartUpdates = false; // true durante coleta on-demand para evitar pontos parciais

  // ── Single Driver: Controle de modo View-Only ─────────────────────────────
  isViewOnly = false; // Se true, usuário está em modo de visualização (não é Driver)

  // ── Sincronização de Estado de Semáforo (Lock State Sync) ───────────────────
  isCpeBusy = false; // Se true, CPE está em tráfego CWMP ativo (botão bloqueado)

  // ── Tracking de Viewers ───────────────────────────────────────────────────
  viewers: string[] = []; // Lista de usernames visualizando a CPE

  isPartialResult = false; // true quando a última coleta retornou chunks incompletos

  private userRequestedTelemetry = false; // Flag para distinguir coleta on-demand de scheduler passivo

  // ── Contador regressivo do botão "Coletar Dados" (60s) ──────────────────────
  // Após qualquer coleta (cache hit ou on-demand completa), o botão fica bloqueado
  // por 60s com contador regressivo visível. Alinhado com TELEMETRY_CACHE_TTL (60s)
  // do backend — evita spamming e respeita o TTL do cache on-demand.
  refreshCountdownSeconds = 0; // 0 = botão liberado; >0 = contador regressivo ativo
  private refreshCountdownId: ReturnType<typeof setInterval> | null = null;
  private readonly REFRESH_COOLDOWN_SECONDS = 60;

  // ── Getter para debounce do botão (alias de telemetryLoading) ─────────────
  get isLoading(): boolean {
    return this.telemetryLoading;
  }

  // ── Getter: botão "Coletar Dados" bloqueado durante cooldown ──────────────
  get isRefreshInCooldown(): boolean {
    return this.refreshCountdownSeconds > 0;
  }

  // ── Getter: label dinâmico do botão durante o contador regressivo ─────────
  get refreshButtonLabel(): string {
    return this.refreshCountdownSeconds > 0
      ? `Coletar Dados (${this.refreshCountdownSeconds}s)`
      : 'Coletar Dados';
  }

  // ── Subject para controle de emissão com exhaustMap (prevenção de Efeito Eco) ──
  private monitorTrigger$ = new Subject<void>();

  // ── Histórico para gráficos ──────────────────────────────────────────────
  rawHistory: TelemetrySnapshot[] = [];
  historyLoading = false;
  selectedPeriodHours = 6; // Período padrão
  // Subject que aciona loadHistory via switchMap — cancela request anterior automaticamente
  private readonly historyTrigger$ = new Subject<number>();
  private readonly timeFormatter = new Intl.DateTimeFormat('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
  });

  // ── Análise avançada agregada ──────────────────────────────────────────
  analysisData: TelemetryAnalysis | null = null;
  analysisLoading = false;
  analysisError: string | null = null;
  analysisUpdatedAt: Date | null = null;

  // ── Painéis suplementares (Health Score, Alertas, Incidente, Intervenção) ──
  healthScoreBreakdown: {
    total: number;
    components: Record<string, { score: number; weight: number }>;
  } | null = null;
  cpeAlerts: TelemetryAlert[] = [];
  incidentStatus: { active: boolean; expiresInSeconds: number | null } = {
    active: false,
    expiresInSeconds: null,
  };
  bootLoopAnomaly: {
    count: number;
    message: string;
    suggestion: string;
    timestamp: string;
  } | null = null;
  lastIntervention: {
    found: boolean;
    before?: InterventionSnapshot;
    after?: InterventionSnapshot;
    pending?: boolean;
  } | null = null;

  // Getter para filtrar apenas alertas ativos (status: 'active')
  get activeAlerts(): TelemetryAlert[] {
    return this.cpeAlerts.filter((a) => a.status === 'active').slice(0, 10);
  }

  // ── Configuração WAN (somente leitura — edição removida por segurança) ──
  // O card WAN — Configuração é 100% somente leitura para evitar que o técnico
  // altere PPPoE/DNS/MTU/VLAN e derrube a conexão do cliente sem confirmação.
  // Para alterar WAN, usar a aba dedicada ou API administrativa.

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
      },
    },
    scales: {
      x: CHART_COMMON_OPTIONS.scales?.['x'],
      y: {
        ...(CHART_COMMON_OPTIONS.scales?.['y'] as any),
        beginAtZero: true,
        max: 100,
      },
    },
  };

  // ── Configuração do gráfico Óptico ─────────────────────────────────────
  opticalChartLabels: string[] = [];
  opticalChartDatasets: ChartDataset<'line'>[] = [
    createChartDataset('RX (dBm)', '#10b981', []),
    createChartDataset('TX (dBm)', '#f59e0b', []),
  ];
  opticalChartData = {
    labels: this.opticalChartLabels,
    datasets: this.opticalChartDatasets,
  };
  opticalChartOptions: ChartOptions<'line'> = {
    ...CHART_COMMON_OPTIONS,
    plugins: {
      ...CHART_COMMON_OPTIONS.plugins,
      tooltip: {
        ...CHART_COMMON_OPTIONS.plugins!.tooltip,
        borderColor: 'rgba(16, 185, 129, 0.3)',
      },
    },
    scales: {
      x: CHART_COMMON_OPTIONS.scales?.['x'],
      y: {
        ...(CHART_COMMON_OPTIONS.scales?.['y'] as any),
        title: { display: true, text: 'dBm', color: '#94a3b8' },
        // Escala sugerida para RX e TX não distorcem o gráfico quando um está ausente
        // RX óptico GPON: -30 a -15 dBm (normal); -35 em fibra degradada; TX: 0 a 5 dBm
        // suggested (não min/max absoluto) — chart.js expande se dados ultrapassarem
        suggestedMin: -35,
        suggestedMax: 5,
      },
    },
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
    this.monitorTrigger$
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        exhaustMap(() => {
          this.userRequestedTelemetry = true; // Marca intenção do usuário para distinguir de scheduler passivo
          this.telemetryLoading = true; // Feedback visual imediato
          this.vitalsLoading = true; // Indicador de vitals
          this.suppressChartUpdates = true; // Evita pontos parciais no gráfico durante coleta

          // Fallback: simula progresso se backend não enviar telemetry_progress
          this.telemetryProgress = 10;
          this.cdr.markForCheck();

          // Retorna o fluxo HTTP
          return this.cpeService.requestTelemetry(this.serialNumber).pipe(
            // CAPTURA INTERNA: Impede que o erro suba e mate o Subject monitorTrigger$
            catchError((err) => {
              this.telemetryLoading = false; // Desliga spinner em caso de erro
              this.vitalsLoading = false; // Desliga indicador de vitals
              this.suppressChartUpdates = false; // Libera atualização de gráfico
              this.telemetryProgress = 0; // Reseta progresso
              this.toastService.error(
                err.error?.error || 'Erro ao conectar com a CPE.',
              );
              return EMPTY; // Retorna um fluxo vazio e finalizado de forma segura
            }),
          );
        }),
      )
      .subscribe({
        next: (response: any) => {
          // Source 'cache' ou 'mongodb_stale' = dado imediato, fecha spinner
          if (
            response?.source === 'cache' ||
            response?.source === 'mongodb_stale'
          ) {
            this.telemetryLoading = false;
            this.vitalsLoading = false;
            if (response.telemetry || response.data) {
              this.telemetryData = response.telemetry || response.data;
            }
            const msg =
              response.source === 'mongodb_stale'
                ? 'Dados do banco (Redis offline) — podem estar desatualizados.'
                : response.message || 'Exibindo dados armazenados em cache.';
            this.toastService.info(msg);
            // Inicia contador regressivo de 60s (alinhado com TTL on-demand do backend).
            // Para cache hit, usa cacheAgeMs para refletir o tempo restante real.
            if (response.source === 'cache') {
              this.startRefreshCooldown(response.cacheAgeMs ?? null);
            }
            this.cdr.markForCheck();
            return;
          }

          // Source 'in_progress' = coleta ativa em andamento (scheduler ou on-demand anterior)
          // Mantém spinner true e aguarda WS — a coleta em andamento vai finalizar
          if (response?.status === 'in_progress') {
            this.toastService.info(
              'Coleta em andamento. Aguardando dados via WebSocket...',
            );
            return; // telemetryLoading permanece true
          }

          // HTTP 202 aceito (idempotent bypass — lock ativo por outra requisição)
          // A coleta ativa vai completar e enviar WS — mantém spinner por no máximo 120s
          if (response?.status === 'accepted') {
            this.toastService.info(
              response.message ||
                'Coleta já está em andamento. Aguarde a atualização na tela.',
            );
            return; // telemetryLoading permanece true — WS irá fechar
          }

          // Qualquer outra resposta = coleta enfileirada ou iniciada
          this.toastService.success(
            'CPE online. Coleta em tempo real iniciada via TR-069...',
          );
          // telemetryLoading permanece true até telemetry_update ou telemetry_complete
        },
      });

    // Inscreve-se na sala da CPE para receber eventos WebSocket específicos
    if (this.serialNumber) {
      this.wsService.subscribeToCpe(this.serialNumber);
    }
    this.loadFromFrontendCache();
    this.extractFallbackTelemetry(); // Fallback imediato de 0ms a partir do BD

    // ── Barramento de histórico com switchMap (cancela request anterior automaticamente) ──
    // Garante que mudanças rápidas de período não causam race condition de responses.
    this.historyTrigger$
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        switchMap((hours) => {
          this.historyLoading = true;
          logInfo('Carregando histórico de telemetria', {
            serialNumber: this.serialNumber,
            periodHours: hours,
          });
          return this.cpeService
            .getTelemetryVitalsHistory(this.serialNumber, hours)
            .pipe(
              timeout(30_000),
              catchError((err) => {
                logError('Erro ao carregar histórico de telemetria', err);
                this.buildChart();
                this.historyLoading = false;
                this.cdr.detectChanges();
                return EMPTY;
              }),
            );
        }),
      )
      .subscribe({
        next: (res) => {
          this.rawHistory = (res.data as TelemetrySnapshot[]) || [];
          this.telemetryCacheService
            .saveHistory(
              this.serialNumber,
              this.selectedPeriodHours,
              this.rawHistory,
            )
            .catch((e) =>
              logError('Erro ao salvar histórico no cache local', e),
            );
          this.buildChart();
          this.historyLoading = false;
          logInfo('Histórico carregado com sucesso', {
            count: this.rawHistory.length,
          });
          this.cdr.detectChanges();
        },
      });

    // Registra listeners WebSocket antes das chamadas HTTP
    this.listenForTelemetryUpdates();
    this.listenForTelemetryProgress(); // Listener para progresso por chunk
    this.listenForTelemetryComplete(); // Listener para encerramento de spinner via WebSocket
    this.listenForCpeValueChange();
    this.listenForAlerts(); // Listener para alertas de telemetria
    this.listenForPresenceEvents(); // Single Driver: escuta conflitos e promoções
    this.listenForAnalysisUpdates(); // Listener para atualização de análise em tempo real
    this.listenForBootLoopAnomaly(); // Listener para anomalia de boot loop (aviso ao técnico)
    this.startHeartbeat(); // Inicia heartbeat para manter controle de Driver
    // Escalonamento das chamadas HTTP para evitar burst (429 Too Many Requests)
    this.loadLatestVitals(); // 0ms — carga imediata do snapshot TelemetryVitals
    this.loadHistory(); // imediato — gráfico precisa de dados antes de qualquer update
    timer(150)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.loadFromCache());
    timer(300)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.loadAnalysis());
    timer(450)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.loadSupplementaryPanels());
  }

  ngOnDestroy(): void {
    // Cancela inscrição na sala da CPE
    if (this.serialNumber) {
      this.wsService.unsubscribeFromCpe(this.serialNumber);
    }

    // Limpa timeout de telemetria
    if (this.telemetryTimeoutId) {
      clearTimeout(this.telemetryTimeoutId);
      this.telemetryTimeoutId = null;
    }

    // Limpa contador regressivo do botão "Coletar Dados"
    this.stopRefreshCooldown();

    // Limpa timers de flash visual
    this.clearAllFlashTimers();
    // historyTrigger$ é gerenciado por takeUntilDestroyed — sem cleanup manual necessário
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['cpe'] && this.cpe?.parameters) {
      this.extractFallbackTelemetry();
    }
    if (changes['cpe'] && this.cpe) {
      // Só recarrega painéis suplementares quando healthScore ou isOnline mudaram
      const prevCpe = changes['cpe'].previousValue as CpeDevice | null;
      if (
        prevCpe?.healthScore !== this.cpe.healthScore ||
        prevCpe?.isOnline !== this.cpe.isOnline
      ) {
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

  /** Dispara um efeito visual de "piscar" para uma métrica específica */
  triggerFlash(metricKey: string): void {
    if (!metricKey || typeof metricKey !== 'string') return;

    // Quando o limite de timers é atingido, expulsa o mais antigo (FIFO)
    // para liberar espaço em vez de silenciosamente descartar o novo flash.
    if (this.flashTimers.size >= TELEMETRY_CONFIG.MAX_FLASH_TIMERS) {
      const oldestKey = this.flashTimers.keys().next().value as string;
      clearTimeout(this.flashTimers.get(oldestKey)!);
      this.flashTimers.delete(oldestKey);
      this.flashingMetrics.delete(oldestKey);
    }

    // Não recria timer já ativo para a mesma chave
    if (this.flashTimers.has(metricKey)) return;

    this.flashingMetrics.add(metricKey);
    const timer = setTimeout(() => {
      this.flashingMetrics.delete(metricKey);
      this.flashTimers.delete(metricKey);
      this.cdr.markForCheck();
    }, TELEMETRY_CONFIG.FLASH_DURATION_MS);

    this.flashTimers.set(metricKey, timer);
  }

  /** Verifica se o card deve estar piscando agora */
  hasFlash(metricKey: string): boolean {
    return this.flashingMetrics.has(metricKey);
  }

  /** Limpa todos os timers de flash (usado em ngOnDestroy) */
  private clearAllFlashTimers(): void {
    this.flashTimers.forEach((timer) => clearTimeout(timer));
    this.flashTimers.clear();
    this.flashingMetrics.clear();
  }

  // ── Getters de Análise Avançada ────────────────────────────────────────
  get analysisAlerts() {
    return this.analysisData?.summary?.alerts || [];
  }

  // Traduz overallHealth para português
  get overallHealthLabel(): string {
    const health = this.analysisData?.summary?.overallHealth || 'unknown';
    const labels: Record<string, string> = {
      good: 'Bom',
      warning: 'Atenção',
      critical: 'Crítico',
      unknown: 'Desconhecido',
    };
    return labels[health] || health;
  }

  // ── Health Score ────────────────────────────────────────────────────────
  readonly healthScoreLabels: Record<string, string> = {
    connectivity: 'Conectividade WAN/GPON',
    optical: 'Sinal Óptico',
    system: 'Recursos do Sistema',
    wifi: 'Ruído Wi-Fi',
    stability: 'Estabilidade Histórica',
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
    const free = this.safeExtractValue(this.telemetryData as any, 'memoryFree');
    const total = this.safeExtractValue(
      this.telemetryData as any,
      'memoryTotal',
    );
    if (free == null || total == null || total <= 0) return null;
    return Math.round(((total - free) / total) * 100);
  }

  get ramUsedMb(): number | null {
    const free = this.safeExtractValue(this.telemetryData as any, 'memoryFree');
    const total = this.safeExtractValue(
      this.telemetryData as any,
      'memoryTotal',
    );
    if (free == null || total == null) return null;
    return Math.round((total - free) / 1024);
  }

  get ramTotalMb(): number | null {
    const total = this.safeExtractValue(
      this.telemetryData as any,
      'memoryTotal',
    );
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
    if (rx >= RX_THRESHOLDS.OK) return 'ok';
    if (rx >= RX_THRESHOLDS.WARNING) return 'warning';
    return 'critical';
  }

  get txZone(): 'ok' | 'warning' | 'critical' | 'unknown' {
    const tx = this.safeExtractValue(this.telemetryData as any, 'opticalTx');
    if (tx == null) return 'unknown';
    if (tx >= TX_THRESHOLDS.OK) return 'ok';
    if (tx >= TX_THRESHOLDS.WARNING) return 'warning';
    return 'critical';
  }

  opticalZoneClass(zone: 'ok' | 'warning' | 'critical' | 'unknown'): string {
    return {
      ok: 'text-green-500 font-semibold',
      warning: 'text-yellow-500 font-semibold',
      critical: 'text-red-500 font-bold',
      unknown: 'text-gray-400',
    }[zone];
  }

  // Step 4: Wi-Fi tabs
  wifiTabSelected: '2g' | '5g' = '2g';

  private autoSelectWifiTab(): void {
    const has5g = this.telemetryData?.['wifi5gChannel'] != null;
    const has2g = this.telemetryData?.['wifi2gChannel'] != null;

    if (has5g && !has2g) {
      this.wifiTabSelected = '5g';
    } else if (has2g && !has5g) {
      this.wifiTabSelected = '2g';
    }
    // Se ambos existem, mantém a seleção atual
  }

  // Step 5: Export CSV
  // Exporta histórico de telemetria para CSV com campos de TelemetrySnapshot
  // Nota: opticalTx não está incluído pois não existe em TelemetryVitals (apenas em TelemetryRaw)
  exportHistoryCsv(): void {
    if (!this.rawHistory.length) return;

    const headers = [
      'timestamp',
      'cpuUsage',
      'memoryFreeKb',
      'memoryTotalKb',
      'uptime_s',
      'opticalRx_dBm',
      'wanStatus',
      'gponStatus',
      'hostCount',
    ];

    const rows = this.rawHistory.map((snap) => {
      return [
        new Date(snap.timestamp).toISOString(),
        (snap as any)['cpuUsage'] ?? '',
        (snap as any)['memoryFree'] ?? '',
        (snap as any)['memoryTotal'] ?? '',
        (snap as any)['uptime'] ?? '',
        (snap as any)['opticalRx'] ?? '',
        (snap as any)['wanStatus'] ?? '',
        (snap as any)['gponStatus'] ?? '',
        (snap as any)['hostCount'] ?? '',
      ]
        .map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`)
        .join(',');
    });

    const csv = [headers.join(','), ...rows].join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `telemetria_${this.serialNumber}_${this.selectedPeriodHours}h_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  // Step 6: Análise priorizada — metadados completos (label, ícone, descrição, interpretação, utilidade)
  readonly analysisInfoMap: Record<
    string,
    {
      label: string;
      icon: string;
      description: string;
      interpretation: string;
      utility: string;
    }
  > = {
    opticalTrend: {
      label: 'Tendência Óptica',
      icon: 'fiber_manual_record',
      description:
        'Regressão linear da potência óptica RX em 7 dias para detectar degradação gradual.',
      interpretation:
        'Slope negativo = sinal piorando. Pode ser sujeira no conector, dobra na fibra ou splitter degradando.',
      utility:
        'Intervenção preventiva ANTES do LOS. Combine com GPON Link Budget para priorizar dispatch.',
    },
    rebootStability: {
      label: 'Estabilidade de Reboot',
      icon: 'restart_alt',
      description:
        'Conta reboots por queda de uptime em 7 dias. Reboots frequentes indicam instabilidade.',
      interpretation:
        '> 2 reboots/semana é anormal. Pode ser fonte defeituosa, firmware bugado ou pane térmica.',
      utility:
        'CPE com reboots frequentes tem prioridade de dispatch. Verifique correlação com temperatura e fonte.',
    },
    trafficAnomalies: {
      label: 'Anomalias de Tráfego',
      icon: 'trending_up',
      description:
        'Detecta picos anômalos via regra 3-sigma com piso mínimo de 30 Mbps.',
      interpretation:
        'Picos podem ser downloads grandes, streaming 4K ou, em casos extremos, botnet/DDoS.',
      utility:
        'Explica lentidão relatada pelo cliente. Compare com Top Destinos para entender o padrão.',
    },
    oltComparison: {
      label: 'Comparação com OLT',
      icon: 'compare',
      description:
        'Compara sinal óptico RX com CPEs vizinhas no mesmo /24 (mesma OLT/splitter).',
      interpretation:
        'Média do grupo baixa = problema na infraestrutura. Só esta CPE baixa = problema local.',
      utility:
        'Diferencia problema de infraestrutura (dispatch de campo) de problema local (troca de ONT).',
    },
    thermalCorrelation: {
      label: 'Correlação Térmica',
      icon: 'thermostat',
      description:
        'Correlação de Pearson entre temperatura do transceptor e CPU. Temp alta + CPU baixa = falha de ventilação.',
      interpretation:
        'Temp > 85°C = superaquecimento. Temp alta + CPU baixa + baixa correlação = ventilação defeituosa.',
      utility:
        'Identifica CPEs em ambientes quentes que precisam realocação ou ventilação adicional.',
    },
    latencyDns: {
      label: 'Latência DNS',
      icon: 'speed',
      description:
        'Latência via IPPingDiagnostics em cache. Requer diagnóstico de ping executado.',
      interpretation:
        '> 100ms = congestionamento ou rota subótima. < 20ms excelente. < 50ms normal.',
      utility:
        'Explica lentidão de navegação. Execute ping diagnóstico para atualizar os dados.',
    },
    topDestinations: {
      label: 'Top Destinos de Tráfego',
      icon: 'analytics',
      description:
        'Inferência de padrão de uso por horário de pico (streaming, gaming, trabalho).',
      interpretation:
        'Baseado em volume por hora. Não identifica sites específicos — requer NetFlow/DPI.',
      utility:
        'Entende o perfil do cliente. Streaming noturno é esperado em residências.',
    },
    wanErrors: {
      label: 'Erros WAN',
      icon: 'error_outline',
      description:
        'Taxa de erros CRC/FCS na interface óptica. Erros indicam degradação física L1/L2.',
      interpretation:
        '> 100/h warning, > 1000/h crítico. Indica fibra suja, conector oxidado ou cabo danificado.',
      utility:
        'Erros crescentes justificam dispatch para limpeza de conector ou troca de drop cable.',
    },
    laserHealth: {
      label: 'Saúde do Laser',
      icon: 'highlight',
      description:
        'Tendência da corrente de bias (mA) do laser. Aumento progressivo indica envelhecimento.',
      interpretation:
        'Bias > 30mA = fim de vida. Slope > 0.5 mA/dia = envelhecimento acelerado.',
      utility:
        'Troca preventiva do transceptor ANTES da falha. Combine com Envelhecimento do Laser.',
    },
    memoryLeak: {
      label: 'Vazamento de Memória',
      icon: 'memory',
      description:
        'Detecta leak de RAM via regressão linear, isolando o maior bloco de uptime contínuo.',
      interpretation:
        'Perda > 0.3%/hora com R² > 0.8 = leak. RAM < 10% = crítica, o roteador vai travar.',
      utility:
        'Identifica firmware bugado. CPE com leak precisa de reboot programado ou update de firmware.',
    },
    powerSupply: {
      label: 'Fonte de Energia',
      icon: 'power',
      description:
        'Monitora tensão (V) do módulo óptico. Quedas ou picos indicam problema na fonte.',
      interpretation:
        'Normal: 3.2-3.4V. < 3.1V = subtensão (fonte defeituosa). > 3.5V = sobretensão (risco de queima).',
      utility:
        'Subtensão causa reboots aleatórios. Sobretensão pode queimar o equipamento.',
    },
    wifiQuality2g: {
      label: 'Qualidade Wi-Fi 2.4 GHz',
      icon: 'wifi',
      description:
        'SNR, ruído, taxa de erros e densidade de clientes na banda 2.4GHz (CWNA/IEEE 802.11).',
      interpretation:
        'SNR < 10dB crítico. Ruído > -65dBm interferência severa. Erros > 2000/min link degradado.',
      utility:
        '2.4GHz é mais congestionada. Alta densidade + ruído alto = migrar clientes para 5GHz.',
    },
    wifiQuality5g: {
      label: 'Qualidade Wi-Fi 5 GHz',
      icon: 'wifi',
      description:
        'SNR, ruído, taxa de erros e densidade de clientes na banda 5GHz.',
      interpretation:
        'SNR < 10dB crítico. Ruído > -75dBm interferência severa. Erros > 800/min link degradado.',
      utility:
        '5GHz tem menos interferência mas menor alcance. Se baixo, verificar obstáculos físicos.',
    },
    gponLinkBudget: {
      label: 'Margem Óptica GPON',
      icon: 'straighten',
      description:
        'Margem entre RX atual e threshold crítico de -27 dBm. Margem baixa = proximidade de LOS.',
      interpretation:
        '< 1dB crítica (LOS iminente). < 3dB warning. > 3dB adequada.',
      utility:
        'Margem baixa = dispatch urgente. Combine com Tendência Óptica para prever quando chegará a zero.',
    },
    transceiverAging: {
      label: 'Envelhecimento do Laser',
      icon: 'schedule',
      description:
        'Tendência da corrente de bias em 30 dias para detectar envelhecimento acelerado.',
      interpretation:
        'Bias > 30mA ou slope > 1.0 mA/dia = fim de vida próximo.',
      utility:
        'Visão de longo prazo. Transceptor envelhecendo deve ser trocado preventivamente.',
    },
    cpuLoad: {
      label: 'Carga de CPU',
      icon: 'developer_board',
      description:
        'Uso de CPU sustentado em 7 dias. CPU cronicamente alta indica CPE sobrecarregada.',
      interpretation:
        '> 80% em 30% das amostras = warning. > 90% médio = crítico.',
      utility:
        'CPE com CPU alta pode precisar de modelo mais potente. Verifique clientes e throughput.',
    },
    wanLatency: {
      label: 'Latência WAN Nativa',
      icon: 'network_ping',
      description:
        'Latência e jitter nativos da WAN (coletados passivamente). Detecta degradação de rota.',
      interpretation:
        '> 50ms latência ou > 20ms jitter = crítico. > 20ms latência = warning.',
      utility:
        'Latência alta afeta tudo. Pode indicar congestionamento, rota BGP subótima ou problema na OLT.',
    },
    wifiBandDistribution: {
      label: 'Distribuição Wi-Fi por Banda',
      icon: 'device_hub',
      description:
        'Distribuição de clientes entre 2.4GHz e 5GHz. Concentração em 2.4GHz causa congestionamento.',
      interpretation:
        '> 80% em 2.4GHz com > 5 clientes = warning. > 90% com > 10 = crítico.',
      utility:
        'Recomendar migração para 5GHz. Verificar se SSID 5GHz está ativo e com potência adequada.',
    },
  };

  getAnalysisInfo(key: string): string {
    return this.analysisInfoMap[key]?.label || key;
  }

  getAnalysisMeta(key: string): {
    label: string;
    icon: string;
    description: string;
    interpretation: string;
    utility: string;
  } | null {
    return this.analysisInfoMap[key] || null;
  }

  formatMeasuredAt(measuredAt: string): string {
    const seconds = Math.floor(
      (Date.now() - new Date(measuredAt).getTime()) / 1000,
    );
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}min`;
    return `${Math.floor(seconds / 3600)}h`;
  }

  get sortedAnalysisEntries(): Array<{ key: string; data: any }> {
    if (!this.analysisData?.analyses) return [];
    const severityOrder: Record<string, number> = {
      critical: 0,
      warning: 1,
      ok: 2,
      normal: 2,
    };
    return Object.entries(this.analysisData.analyses)
      .filter(([, v]) => v != null)
      .map(([key, data]) => ({ key, data }))
      .sort((a, b) => {
        const sa =
          severityOrder[a.data?.severity ?? a.data?.status ?? 'ok'] ?? 2;
        const sb =
          severityOrder[b.data?.severity ?? b.data?.status ?? 'ok'] ?? 2;
        return sa - sb;
      });
  }

  analysisCardBorder(data: any): string {
    const sev = data?.severity ?? data?.status ?? 'ok';
    if (sev === 'critical') return 'border-red-400 dark:border-red-600';
    if (sev === 'warning') return 'border-yellow-400 dark:border-yellow-600';
    return 'border-gray-200 dark:border-gray-700';
  }

  analysisBadge(data: any): string {
    const sev = data?.severity ?? data?.status ?? '';
    if (sev === 'critical') return '🔴';
    if (sev === 'warning') return '⚠️';
    if (sev === 'ok' || sev === 'normal') return '✅';
    return '';
  }

  // ── TrackBy helpers para *ngFor (evita re-render desnecessário) ──────────
  trackByAnalysisKey(_: number, item: { key: string; data: unknown }): string {
    return item.key;
  }
  trackByAlertSeverityMsg(_: number, alert: TelemetryAlert): string {
    return alert.metric + alert.triggeredAt;
  }
  trackByAlertMsg(
    index: number,
    alert: { severity: string; message: string },
  ): string {
    return `${index}-${alert.severity}`;
  }
  trackByKvKey(_: number, kv: { key: string }): string {
    return kv.key;
  }
  trackByDnsIp(_: number, dns: { ip: string }): string {
    return dns.ip;
  }

  // ── Alertas enriquecidos ─────────────────────────────────────────────────
  /** Ícone de severidade para o card de alertas */
  alertIcon(severity: string): string {
    return severity === 'critical' ? '🔴' : '⚠️';
  }

  /** Converte timestamp para "há X min/h" */
  timeAgo(timestamp: string | Date | undefined): string {
    if (!timestamp) return '';
    const diff = Date.now() - new Date(timestamp).getTime();
    const min = Math.floor(diff / 60000);
    if (min < 1) return 'agora';
    if (min < 60) return `há ${min}min`;
    const h = Math.floor(min / 60);
    if (h < 24) return `há ${h}h`;
    return `há ${Math.floor(h / 24)}d`;
  }

  // ── Getters legados (WAN, Óptica, Hardware) ────────────────────────────
  get isRxCritical(): boolean {
    const rxPower = this.safeExtractValue(
      this.telemetryData as any,
      'opticalRx',
    );
    return rxPower !== null && rxPower < RX_THRESHOLDS.WARNING; // alinhado com RX_THRESHOLDS
  }

  /** Retorna label de cache (ex: "Atualizado há 12s · cache"). */
  get cacheLabel(): string {
    if (!this.lastUpdated) return 'Nenhuma telemetria disponível';
    const seconds = Math.floor(
      (Date.now() - this.lastUpdated.getTime()) / 1000,
    );
    if (seconds < 5) return 'Atualizado agora · via TR-069';
    if (seconds < 60) return `Atualizado há ${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    return `Atualizado há ${minutes}min`;
  }

  /**
   * Detecta se o gráfico tem dados limitados (memória ou TX óptico ausentes).
   * Períodos >48h usam TelemetryHourly que agrega memUsedPercent e txPowerAvg,
   * mas documentos históricos anteriores à correção do endpoint podem não ter
   * esses campos. Retorna true quando período >48h E algum dataset está vazio.
   */
  get hasLimitedChartData(): boolean {
    if (this.selectedPeriodHours <= 48) return false;
    if (!this.rawHistory.length) return false;
    const hasMem = this.chartDatasets[1]?.data.some((v) => v !== null);
    const hasTx = this.opticalChartDatasets[1]?.data.some((v) => v !== null);
    return !hasMem || !hasTx;
  }

  /** Retorna métrica como string, ou null. */
  stringValue(key: string): string | null {
    const m = this.telemetryData?.[key];
    if (m === undefined || m === null) return null;

    // Trata caso onde m é um primitivo (backend/cache) ou um objeto TelemetryMetric
    const val =
      typeof m === 'object' && 'value' in m ? (m as TelemetryMetric).value : m;
    if (val === undefined || val === null) return null;

    return String(val);
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

    const valRx = values['rxPower']
      ? this.diagnosticParser.parseOmciRx(values['rxPower'])
      : null;
    const valTx = values['txPower']
      ? this.diagnosticParser.parseOmciTx(values['txPower'])
      : null;
    const valTemp = values['temp']
      ? this.diagnosticParser.parseOmciTemp(values['temp'])
      : null;
    const valVoltage = values['voltage']
      ? this.diagnosticParser.parseOmciVoltage(values['voltage'])
      : null;
    const valBias = values['bias']
      ? this.diagnosticParser.parseOmciBias(values['bias'])
      : null;

    // CORREÇÃO: Adicionado 'unit' e 'description' exigidos estritamente pela interface TelemetryMetric (TS2739)
    // Processa dados do fallback local (parâmetros da CPE)
    if (!t['cpuUsage'] && values['cpu'])
      t['cpuUsage'] = {
        value: String(parseFloat(values['cpu'])),
        unit: '%',
        description: 'CPU Usage',
      };
    if (!t['memoryFree'] && values['memFree'])
      t['memoryFree'] = {
        value: String(parseFloat(values['memFree'])),
        unit: 'KB',
        description: 'Free Memory',
      };
    if (!t['memoryTotal'] && values['memTotal'])
      t['memoryTotal'] = {
        value: String(parseFloat(values['memTotal'])),
        unit: 'KB',
        description: 'Total Memory',
      };
    if (!t['uptime'] && values['uptime'])
      t['uptime'] = {
        value: String(parseFloat(values['uptime'])),
        unit: 's',
        description: 'Uptime',
      };
    if (!t['gponStatus'] && values['gponStatus'])
      t['gponStatus'] = {
        value: values['gponStatus'],
        unit: '',
        description: 'GPON Status',
      };
    if (!t['opticalRx'] && valRx !== null)
      t['opticalRx'] = {
        value: String(valRx),
        unit: 'dBm',
        description: 'Optical RX',
      };
    if (!t['opticalTx'] && valTx !== null)
      t['opticalTx'] = {
        value: String(valTx),
        unit: 'dBm',
        description: 'Optical TX',
      };
    if (!t['opticalTemperature'] && valTemp !== null)
      t['opticalTemperature'] = {
        value: String(valTemp),
        unit: '°C',
        description: 'Optical Temperature',
      };
    if (!t['opticalVoltage'] && valVoltage !== null)
      t['opticalVoltage'] = {
        value: String(valVoltage),
        unit: 'V',
        description: 'Optical Voltage',
      };
    if (!t['biasCurrent'] && valBias !== null)
      t['biasCurrent'] = {
        value: String(valBias),
        unit: 'mA',
        description: 'Bias Current',
      };
    if (!t['wanBytesReceived'] && values['bytesRx'])
      t['wanBytesReceived'] = {
        value: String(parseFloat(values['bytesRx'])),
        unit: 'B',
        description: 'WAN Bytes Received',
      };
    if (!t['wanBytesSent'] && values['bytesTx'])
      t['wanBytesSent'] = {
        value: String(parseFloat(values['bytesTx'])),
        unit: 'B',
        description: 'WAN Bytes Sent',
      };

    this.cdr.markForCheck(); // Atualiza interface com os fallbacks
  }

  /**
   * Carrega o snapshot mais recente do TelemetryVitals do banco para carga inicial.
   * Padrão híbrido: popula telemetryData imediatamente ao abrir a aba.
   * WebSocket continua sobrescrevendo em tempo real quando novos dados chegam.
   * Merge defensivo: só preenche campos que ainda estão null (evita sobrescrever WS).
   */
  private loadLatestVitals(): void {
    if (!isValidSerialNumber(this.serialNumber)) return;

    logInfo('Carregando vitals mais recentes', {
      serialNumber: this.serialNumber,
    });

    this.cpeService
      .getLatestVitals(this.serialNumber)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        timeout(10_000),
        catchError((err) => {
          logWarn('Erro ao carregar vitals (fallback silencioso)', {
            error: err.message,
          });
          return EMPTY;
        }),
      )
      .subscribe({
        next: (res) => {
          if (!res?.data) {
            logWarn('Resposta de vitals vazia');
            return;
          }
          const d = res.data;

          const vitalsFields: Partial<TelemetryData> = {};

          if (d.cpuUsage != null) vitalsFields['cpuUsage'] = d.cpuUsage;
          if (d.memoryFree != null) vitalsFields['memoryFree'] = d.memoryFree;
          if (d.memoryTotal != null)
            vitalsFields['memoryTotal'] = d.memoryTotal;
          if (d.opticalRx != null) vitalsFields['opticalRx'] = d.opticalRx;
          if (d.uptime != null) vitalsFields['uptime'] = d.uptime;
          if (d.wanStatus) vitalsFields['wanStatus'] = d.wanStatus;
          if (d.gponStatus) vitalsFields['gponStatus'] = d.gponStatus;
          if (d.hostCount != null) vitalsFields['hostCount'] = d.hostCount;

          this.telemetryData = {
            ...(this.telemetryData || {}),
            ...vitalsFields,
          } as TelemetryData;

          if (!this.lastUpdated && d.timestamp) {
            this.lastUpdated = new Date(d.timestamp);
          }

          logInfo('Vitals carregados com sucesso', {
            fieldsCount: Object.keys(vitalsFields).length,
          });
          this.cdr.markForCheck();
        },
      });
  }

  /** Busca telemetria do cache Redis SEM disparar coleta na CPE.
   *  Se não houver cache, não faz nada (usuário deve clicar em "Monitorar agora"). */
  private loadFromCache(): void {
    if (!isValidSerialNumber(this.serialNumber)) return;

    logInfo('Carregando telemetria do cache Redis', {
      serialNumber: this.serialNumber,
    });

    this.cpeService
      .getTelemetryCache(this.serialNumber)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        timeout(10_000),
        catchError((err) => {
          if (err.status === 404) {
            logInfo('Cache de telemetria vazio (404)');
          } else {
            logError('Erro ao carregar cache de telemetria', err);
            this.telemetryError = 'Erro ao carregar cache de telemetria.';
          }
          this.cdr.markForCheck();
          return EMPTY;
        }),
      )
      .subscribe({
        next: (res) => {
          if (res.success && res.data) {
            this.telemetryData = {
              ...(this.telemetryData || {}),
              ...(res.data as TelemetryData),
            };
            this.lastUpdated = new Date(res.timestamp);

            try {
              this.telemetryCacheService.saveLatestTelemetry(
                this.serialNumber,
                this.telemetryData,
                this.lastUpdated,
              );
            } catch (e) {
              logError('Erro ao salvar telemetria no cache local', e);
            }

            this.telemetryLoading = false;
            logInfo('Telemetria carregada do cache com sucesso');
            this.cdr.markForCheck();
          }
        },
      });
  }

  /**
   * Carrega dados do cache do navegador (localStorage) na inicialização.
   * Mostra dados imediatamente enquanto os dados frescos são buscados.
   */
  private async loadFromFrontendCache(): Promise<void> {
    if (!isValidSerialNumber(this.serialNumber)) return;

    logInfo('Carregando dados do cache do navegador', {
      serialNumber: this.serialNumber,
    });

    try {
      const cachedTelemetry = this.telemetryCacheService.loadLatestTelemetry(
        this.serialNumber,
      );
      if (cachedTelemetry) {
        this.telemetryData = {
          ...(this.telemetryData || {}),
          ...(cachedTelemetry.data as TelemetryData),
        };
        this.lastUpdated = new Date(cachedTelemetry.lastUpdated);
        logInfo('Telemetria carregada do cache local', {
          lastUpdated: cachedTelemetry.lastUpdated,
        });
        this.cdr.markForCheck();
      }
    } catch (e) {
      logError('Erro ao carregar telemetria do cache local', e);
    }

    try {
      const cachedHistory = await this.telemetryCacheService.loadHistory(
        this.serialNumber,
        this.selectedPeriodHours,
      );
      if (cachedHistory) {
        this.rawHistory = cachedHistory;
        this.buildChart();
        logInfo('Histórico carregado do cache local', {
          periodHours: this.selectedPeriodHours,
          count: cachedHistory.length,
        });
        this.cdr.markForCheck();
      }
    } catch (e) {
      logError('Erro ao carregar histórico do cache local', e);
    }
  }

  /** Timeout para desativar o spinner se a CPE não responder. */
  private telemetryTimeoutId: ReturnType<typeof setTimeout> | null = null;

  /**
   * Inicia contador regressivo de 60s no botão "Coletar Dados".
   * Chamado após:
   *   - response source='cache' (cache hit — dados frescos, próximo on-demand só em 60s)
   *   - evento WS telemetry_complete (coleta on-demand completou — novo cache fresco por 60s)
   * Se receber cacheAgeMs do backend, subtrai da duração para refletir o tempo restante real.
   */
  private startRefreshCooldown(cacheAgeMs: number | null = null): void {
    this.stopRefreshCooldown();
    // Se o backend informou a idade do cache, o cooldown é o tempo restante até 60s
    const remainingSeconds =
      cacheAgeMs !== null && cacheAgeMs >= 0
        ? Math.max(
            0,
            this.REFRESH_COOLDOWN_SECONDS - Math.floor(cacheAgeMs / 1000),
          )
        : this.REFRESH_COOLDOWN_SECONDS;
    this.refreshCountdownSeconds = remainingSeconds;
    if (this.refreshCountdownSeconds <= 0) {
      this.cdr.markForCheck();
      return;
    }
    this.refreshCountdownId = setInterval(() => {
      this.refreshCountdownSeconds--;
      if (this.refreshCountdownSeconds <= 0) {
        this.stopRefreshCooldown();
      }
      this.cdr.markForCheck();
    }, 1000);
    this.cdr.markForCheck();
  }

  /** Cancela o contador regressivo e libera o botão. */
  private stopRefreshCooldown(): void {
    if (this.refreshCountdownId) {
      clearInterval(this.refreshCountdownId);
      this.refreshCountdownId = null;
    }
    this.refreshCountdownSeconds = 0;
  }

  /** Solicita telemetria sob demanda ao backend (botão de refresh manual). */
  requestTelemetry(): void {
    if (!isValidSerialNumber(this.serialNumber)) {
      this.toastService.error(
        'Número de série inválido para solicitação de telemetria.',
      );
      return;
    }

    // Bloqueia clique durante cooldown do contador regressivo
    if (this.isRefreshInCooldown) {
      this.toastService.info(
        `Aguarde ${this.refreshCountdownSeconds}s para nova coleta.`,
      );
      return;
    }

    this.isPartialResult = false;
    this.telemetryProgress = 0;
    this.completedChunks = 0;
    this.totalChunks = 0;
    this.isPartialCollection = false;

    // Dispara a esteira com retry pattern inteligente
    this.monitorTrigger$.next();

    // Proteção de timeout com configuração centralizada
    if (this.telemetryTimeoutId) clearTimeout(this.telemetryTimeoutId);
    this.telemetryTimeoutId = setTimeout(() => {
      if (this.telemetryLoading) {
        this.telemetryLoading = false;
        this.vitalsLoading = false;
        this.suppressChartUpdates = false; // Libera atualização de gráfico
        this.telemetryProgress = 0; // Reseta progresso
        this.toastService.warning(
          `Tempo esgotado: CPE não respondeu em ${TELEMETRY_CONFIG.REQUEST_TIMEOUT_MS / 1000}s. Verifique a conexão da CPE.`,
        );
        this.cdr.markForCheck();
      }
      this.telemetryTimeoutId = null;
    }, TELEMETRY_CONFIG.REQUEST_TIMEOUT_MS);
  }

  /** Solicita telemetria vitals (8 campos críticos) para resposta rápida (~2s). */
  requestVitals(): void {
    if (!isValidSerialNumber(this.serialNumber)) {
      this.toastService.error(
        'Número de série inválido para solicitação de vitals.',
      );
      return;
    }

    if (this.vitalsLoading) return;
    this.vitalsLoading = true;

    // Failsafe: libera o botão se WebSocket não chegar após timeout
    timer(TELEMETRY_CONFIG.VITALS_TIMEOUT_MS)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        if (this.vitalsLoading) {
          this.vitalsLoading = false;
          this.cdr.markForCheck();
        }
      });

    this.cpeService
      .requestVitals(this.serialNumber)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        timeout(TELEMETRY_CONFIG.VITALS_TIMEOUT_MS),
        retry({
          count: TELEMETRY_CONFIG.RETRY_ATTEMPTS,
          delay: TELEMETRY_CONFIG.RETRY_DELAY_MS,
          resetOnSuccess: true,
        }),
        catchError((err) => {
          this.vitalsLoading = false;
          const errorMsg =
            err.error?.error || err.message || 'Erro ao conectar com a CPE.';
          this.toastService.error(errorMsg);
          logError('Erro na requisição de vitals', err);
          return EMPTY;
        }),
      )
      .subscribe({
        next: (response: any) => {
          this.vitalsLoading = false;
          if (!response) {
            this.toastService.error('Resposta inválida do servidor.');
            return;
          }

          if (
            response.source === 'cache' ||
            response.source === 'mongodb_stale'
          ) {
            this.toastService.info('Vitals: dados em cache (< 60s).');
          } else if (response.status === 'accepted') {
            this.toastService.info(
              'Vitals já em andamento. Aguarde o WebSocket.',
            );
          } else if (response.status === 'queued') {
            this.toastService.info(
              'Coleta vitals enfileirada. Aguarde atualização via WebSocket.',
            );
          } else {
            this.toastService.success('Vitals iniciado na CPE.');
          }
          this.cdr.markForCheck();
        },
      });
  }

  /** Carrega análise avançada agregada do backend. */
  loadAnalysis(): void {
    if (!isValidSerialNumber(this.serialNumber)) return;

    this.analysisLoading = true;
    this.analysisError = null;

    this.cpeService
      .getTelemetryAnalysis(this.serialNumber)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        timeout(30_000),
        retry({
          count: TELEMETRY_CONFIG.RETRY_ATTEMPTS,
          delay: TELEMETRY_CONFIG.RETRY_DELAY_MS,
        }),
        catchError((err) => {
          this.analysisLoading = false;
          this.analysisError = 'Erro ao carregar análise avançada.';
          logError('Erro na requisição de análise', err);
          this.cdr.markForCheck();
          return EMPTY;
        }),
      )
      .subscribe({
        next: (res) => {
          if (!res || typeof res !== 'object') {
            this.analysisLoading = false;
            this.analysisError = 'Resposta inválida do servidor.';
            this.cdr.markForCheck();
            return;
          }

          this.analysisData = res as TelemetryAnalysis;
          this.analysisUpdatedAt = new Date();
          this.analysisLoading = false;
          this.cdr.markForCheck();
        },
      });
  }

  /**
   * Separa a string de DNS ISP (ex: "10.10.10.10,10.10.11.11") em lista de IPs
   * válidos para exibição em linhas separadas no card WAN — Configuração.
   * Cada IP é validado com isValidIPv4; IPs inválidos são marcados.
   */
  get wanDnsList(): Array<{ ip: string; valid: boolean; label: string }> {
    const raw = this.cpe?.wan?.dnsIsp || (this.cpe as any)?.wanDnsIsp || '';
    if (!raw || typeof raw !== 'string') return [];
    return raw
      .split(',')
      .map((s: string) => s.trim())
      .filter((s: string) => s.length > 0)
      .map((ip: string, idx: number) => ({
        ip,
        valid: isValidIPv4(ip),
        label:
          idx === 0
            ? 'DNS Primário'
            : idx === 1
              ? 'DNS Secundário'
              : `DNS ${idx + 1}`,
      }));
  }

  /** Carrega painéis suplementares (Health Score, Alertas, Incidente, Intervenção). */
  private loadSupplementaryPanels(): void {
    if (!isValidSerialNumber(this.serialNumber)) return;

    logInfo('Carregando painéis suplementares', {
      serialNumber: this.serialNumber,
    });

    this.cpeService
      .getHealthScoreBreakdown(this.serialNumber)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        timeout(10_000),
        catchError((err) => {
          logWarn('Erro ao carregar Health Score (painel opcional)', err);
          return EMPTY;
        }),
      )
      .subscribe({
        next: (res) => {
          this.healthScoreBreakdown = res;
          this.cdr.markForCheck();
        },
      });

    this.cpeService
      .getCpeAlerts(this.serialNumber)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        timeout(10_000),
        catchError((err) => {
          logWarn('Erro ao carregar alertas (painel opcional)', err);
          return EMPTY;
        }),
      )
      .subscribe({
        next: (res) => {
          this.cpeAlerts = res.data;
          this.cdr.markForCheck();
        },
      });

    this.cpeService
      .getIncidentStatus(this.serialNumber)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        timeout(10_000),
        catchError((err) => {
          logWarn(
            'Erro ao carregar status de incidente (painel opcional)',
            err,
          );
          return EMPTY;
        }),
      )
      .subscribe({
        next: (res) => {
          this.incidentStatus = res;
          this.cdr.markForCheck();
        },
      });

    this.cpeService
      .getLastIntervention(this.serialNumber)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        timeout(10_000),
        catchError((err) => {
          logWarn('Erro ao carregar última intervenção (painel opcional)', err);
          return EMPTY;
        }),
      )
      .subscribe({
        next: (res) => {
          this.lastIntervention = res;
          this.cdr.markForCheck();
        },
      });
  }

  /** Escuta o evento específico bruto de VALUE CHANGE (TR-181) */
  private listenForCpeValueChange(): void {
    this.wsService
      .onCpeValueChange()
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        bufferTime(TELEMETRY_CONFIG.VALUE_CHANGE_BUFFER_MS),
        filter((events: ValueChangeEvent[]) => events.length > 0),
      )
      .subscribe((events: ValueChangeEvent[]) => {
        const cpeEvents = events.filter(
          (e: ValueChangeEvent) => e.serialNumber === this.serialNumber,
        );
        if (cpeEvents.length === 0) return;

        let hasWanStatusChange = false;
        cpeEvents.forEach((event: ValueChangeEvent) => {
          if (event.changeType === 'wan_status_change')
            hasWanStatusChange = true;
        });

        if (hasWanStatusChange) {
          this.toastService.warning(
            'Mudança de Rede: O status da interface WAN da CPE foi alterado.',
          );
        }
        this.cdr.detectChanges();
      });
  }

  /** Escuta alertas de telemetria (onTelemetryAlert, onTelemetryAlertResolved, onTelemetryAlertBatch) */
  private listenForAlerts(): void {
    this.wsService
      .onTelemetryAlert()
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        filter((alert) => alert.serialNumber === this.serialNumber),
      )
      .subscribe((alert) => {
        this.cpeAlerts = [
          {
            serialNumber: alert.serialNumber,
            metric: alert.metric,
            severity: alert.severity,
            status: 'active' as const,
            value: alert.value,
            triggeredAt: alert.timestamp,
            message: alert.message,
          },
          ...this.cpeAlerts,
        ].slice(0, MAX_ALERT_ENTRIES);
        this.cdr.detectChanges();
      });

    this.wsService
      .onTelemetryAlertResolved()
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        filter((event) => event.serialNumber === this.serialNumber),
      )
      .subscribe((event) => {
        this.cpeAlerts = this.cpeAlerts.filter(
          (a) => a.metric !== event.metric,
        );
        this.cdr.detectChanges();
      });

    this.wsService
      .onTelemetryAlertBatch()
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        filter((batch) =>
          batch.alerts.some((a) => a.serialNumber === this.serialNumber),
        ),
      )
      .subscribe((batch) => {
        const cpeAlerts = batch.alerts
          .filter((a) => a.serialNumber === this.serialNumber)
          .map(
            (event): TelemetryAlert => ({
              serialNumber: event.serialNumber,
              metric: event.metric,
              severity: event.severity as 'warning' | 'critical',
              status: 'active' as const,
              value: event.value,
              triggeredAt: event.timestamp,
              message: event.message,
            }),
          );
        if (cpeAlerts.length > 0) {
          this.cpeAlerts = [...cpeAlerts, ...this.cpeAlerts].slice(
            0,
            MAX_ALERT_ENTRIES,
          );
          this.cdr.detectChanges();
        }
      });
  }

  /** Escuta eventos de presença Single Driver (presence_conflict e driver_promoted) */
  private listenForPresenceEvents(): void {
    this.wsService
      .onDriverAcquired()
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        filter((event) => event.serialNumber === this.serialNumber),
      )
      .subscribe((event) => {
        this.isViewOnly = false;
        this.cdr.markForCheck();
      });

    this.wsService
      .onViewOnly()
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        filter((event) => event.serialNumber === this.serialNumber),
      )
      .subscribe((event) => this.handleViewOnlyEvent(event));

    this.wsService
      .onForceViewOnly()
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        filter((event) => event.serialNumber === this.serialNumber),
      )
      .subscribe((event) => this.handleViewOnlyEvent(event));

    this.wsService
      .onDriverReleased()
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        filter((event) => event.serialNumber === this.serialNumber),
      )
      .subscribe(() => {
        this.isViewOnly = false;
        this.cdr.markForCheck();
      });

    this.wsService
      .onViewersUpdated()
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        filter((event) => event.serialNumber === this.serialNumber),
      )
      .subscribe((event) => {
        this.viewers = event.viewers;
        this.cdr.markForCheck();
      });

    this.wsService
      .onCpeLocked()
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        filter((event) => event.serialNumber === this.serialNumber),
      )
      .subscribe(() => {
        this.isCpeBusy = true;
        this.cdr.markForCheck();
      });

    this.wsService
      .onCpeUnlocked()
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        filter((event) => event.serialNumber === this.serialNumber),
      )
      .subscribe(() => {
        this.isCpeBusy = false;
        this.cdr.markForCheck();
      });
  }

  /** Helper compartilhado para eventos ViewOnly (elimina duplicação de código) */
  private handleViewOnlyEvent(event: {
    serialNumber: string;
    driver?: string;
    message: string;
  }): void {
    this.isViewOnly = true;
    this.toastService.warning(event.message);
    this.cdr.markForCheck();
  }

  /** Inicia ciclo de heartbeat para manter controle de Driver */
  private startHeartbeat(): void {
    if (!isValidSerialNumber(this.serialNumber)) return;

    interval(TELEMETRY_CONFIG.HEARTBEAT_INTERVAL_MS)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        filter(() => this.wsService.isConnected),
      )
      .subscribe(() => {
        try {
          this.wsService.emitDriverKeepalive(this.serialNumber);
        } catch (e) {
          logError('Erro ao emitir keepalive', e);
        }
      });
  }

  /** Escuta WebSocket de telemetria para esta CPE. */
  private listenForTelemetryUpdates(): void {
    this.wsService
      .onTelemetryUpdate()
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        filter((event: TelemetryUpdateEvent) => {
          // Validação básica do evento
          return (
            event &&
            typeof event.serialNumber === 'string' &&
            event.serialNumber === this.serialNumber
          );
        }),
      )
      .subscribe((event: TelemetryUpdateEvent) => {
        // Limpa timeout se dados chegaram
        if (this.telemetryTimeoutId) {
          clearTimeout(this.telemetryTimeoutId);
          this.telemetryTimeoutId = null;
        }

        // Validação de dados recebidos
        if (!isValidTelemetryData(event.data)) {
          logWarn('Dados inválidos recebidos via WebSocket', event);
          return;
        }

        // Roteamento por source: vitals vs standard
        // vitalsKeys contém apenas campos de TelemetryVitals (subset limitado)
        // Campos de TelemetryRaw (wifi bandwidth/status/discards/bytes, opticalTx, etc.)
        // são processados no else branch (source='standard' ou outros)
        if (event.source === 'vitals' || event.source === 'on-demand-vitals') {
          const vitalsKeys = [
            'wanStatus',
            'cpuUsage',
            'memoryFree',
            'memoryTotal',
            'opticalRx',
            'gponStatus',
            'uptime', // TelemetryVitals (lowercase) — backend envia minúsculo
            'opticalTemperature',
            'biasCurrent',
            'opticalVoltage',
            'wifi2gNoise',
            'wifi5gNoise',
            'wifi2gSnr',
            'wifi5gSnr',
            'wifi2gSignalStrength',
            'wifi5gSignalStrength',
            'hostCount',
          ];
          const vitalsData: Partial<TelemetryData> = {};
          for (const k of vitalsKeys) {
            if (event.data[k] !== undefined) {
              vitalsData[k] = event.data[k];
            }
          }
          this.telemetryData = { ...(this.telemetryData || {}), ...vitalsData };
          this.vitalsLoading = false;
        } else {
          // source='standard' ou outros: processa todos os campos (TelemetryRaw completo)
          // Inclui: wifi bandwidth/status/discards/bytes, opticalTx, lan breakdown, etc.
          this.telemetryData = { ...(this.telemetryData || {}), ...event.data };
        }

        // Valida timestamp
        const timestamp = event.timestamp
          ? new Date(event.timestamp)
          : new Date();
        this.lastUpdated = timestamp;

        // Salva no cache com tratamento de erro
        try {
          this.telemetryCacheService.saveLatestTelemetry(
            this.serialNumber,
            this.telemetryData!,
            this.lastUpdated,
          );
        } catch (e) {
          logError('Erro ao salvar telemetria no cache', e);
        }

        const hasPartial = event.partial ?? false;
        const hasPassive = event.source === 'inform_passive';
        const isBackground = event.tabContext === 'background';

        // Atualiza gráfico O(1) - apenas se não for coleta on-demand (evita pontos parciais)
        if (
          event.data &&
          !this.suppressChartUpdates &&
          hasTelemetryFields(event.data)
        ) {
          this.addTelemetryPointToChart(event.data, event.timestamp);
        }

        // Flash visual para métricas atualizadas (apenas métricas visíveis para não esgotar MAX_FLASH_TIMERS)
        if (event.data) {
          Object.keys(event.data).forEach((key) => {
            if (typeof key === 'string' && FLASH_VISIBLE_METRICS.has(key)) {
              this.triggerFlash(key);
            }
          });
        }

        this.telemetryLoading = false;
        this.vitalsLoading = false; // Reset para qualquer source de update
        this.autoSelectWifiTab();
        this.isPartialResult = hasPartial;

        // Notificações consolidadas (evita spam)
        if (hasPartial) {
          this.toastService.warning(
            event.message || 'Coleta parcial — alguns lotes não responderam.',
          );
        } else if (hasPassive) {
          this.toastService.info(
            'Active Notification: A CPE atualizou dados de telemetria passivamente.',
          );
        } else if (!isBackground) {
          this.toastService.success('Telemetria recebida em tempo real.');
        }

        this.cdr.detectChanges();
      });
  }

  /** Escuta evento de conclusão de telemetria via WebSocket para desligar spinner */
  private listenForTelemetryComplete(): void {
    this.wsService
      .onTelemetryComplete()
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        filter((data) => {
          return (
            data &&
            typeof data.serialNumber === 'string' &&
            data.serialNumber === this.serialNumber
          );
        }),
      )
      .subscribe((data) => {
        // Fontes que NÃO devem fechar o spinner on-demand: scheduler e inform passivo
        // Se usuário solicitou explicitamente, ignora passividade da source
        const isPassiveSource =
          (data.source === 'standard' || data.source === 'scheduler') &&
          !this.userRequestedTelemetry;

        if (!isPassiveSource) {
          this.userRequestedTelemetry = false; // Consome a flag após resetar spinner
          this.telemetryLoading = false;
          this.vitalsLoading = false;
          this.telemetryProgress = 0;
          this.completedChunks = 0;
          this.totalChunks = 0;
          this.suppressChartUpdates = false; // Libera atualização de gráfico

          if (data.partial) {
            this.toastService.warning(
              'Coleta parcial concluída — alguns parâmetros não responderam.',
            );
          } else {
            this.toastService.success(
              'Coleta de telemetria concluída com sucesso.',
            );
          }

          // Inicia contador regressivo de 60s — novo cache fresco (TTL 60s no backend)
          this.startRefreshCooldown(null);

          // Recarrega gráfico completo após coleta on-demand para garantir dados consistentes
          this.loadHistory();
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

  /** Escuta análise em tempo real — disparada pelo backend após cada nova coleta */
  private listenForAnalysisUpdates(): void {
    this.wsService
      .onAnalysisUpdate()
      .pipe(
        filter((event) => event.serialNumber === this.serialNumber),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((event) => {
        this.analysisData = event.analysis;
        this.analysisUpdatedAt = new Date(event.timestamp);
        this.analysisLoading = false;
        this.cdr.markForCheck();
      });
  }

  /** Escuta anomalia de boot loop — exibe banner com sugestão ao técnico */
  private listenForBootLoopAnomaly(): void {
    this.wsService
      .onBootLoopAnomaly()
      .pipe(
        filter((event) => event.serialNumber === this.serialNumber),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((event) => {
        this.bootLoopAnomaly = {
          count: event.count,
          message: event.message,
          suggestion: event.suggestion,
          timestamp: event.timestamp,
        };
        this.cdr.markForCheck();
      });
  }

  /** Escuta evento de progresso de telemetria por chunk para atualizar barra de progresso */
  private listenForTelemetryProgress(): void {
    this.wsService
      .onTelemetryProgress()
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        filter((data) => {
          return (
            data &&
            typeof data.serialNumber === 'string' &&
            data.serialNumber === this.serialNumber
          );
        }),
      )
      .subscribe((data) => {
        // Log de debug para confirmar recebimento de progresso
        logInfo('Progresso de telemetria recebido', {
          percent: data.percent,
          completed: data.completedChunks,
          total: data.totalChunks,
        });

        // Validação de dados numéricos
        this.telemetryProgress = Math.max(0, Math.min(100, data.percent || 0));
        this.completedChunks = Math.max(0, data.completedChunks || 0);
        this.totalChunks = Math.max(0, data.totalChunks || 0);

        if (data.partial) {
          this.isPartialCollection = true;
        }

        this.cdr.markForCheck();
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
  private safeExtractValue(
    data: TelemetryData | null | undefined,
    key: string,
  ): number | null {
    if (data == null) return null;
    const item = data[key];
    if (item === null || item === undefined) return null;

    // Suporta ambos os formatos do backend:
    //   { value: "27", unit: "%" }  ← WebSocket (string)
    //   { value: 27, unit: "%" }    ← possível futuro (number direto)
    if (typeof item === 'object' && 'value' in item) {
      if (item.value === null || item.value === undefined || item.value === '')
        return null;
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

    // Reconstrói referências de datasets e wrappers imediatamente (ng2-charts detecta por referência)
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
    this.chartData = { labels: this.chartLabels, datasets: this.chartDatasets };
    this.opticalChartData = {
      labels: this.opticalChartLabels,
      datasets: this.opticalChartDatasets,
    };
    this.cdr.detectChanges(); // Limpa gráfico enquanto HTTP carrega

    this.loadHistory();
  }

  /**
   * Dispara o carregamento do histórico via historyTrigger$ (switchMap no ngOnInit).
   * O switchMap cancela automaticamente qualquer request HTTP anterior em voo,
   * eliminando a race condition de respostas fora de ordem ao trocar o período.
   */
  private loadHistory(): void {
    if (!isValidSerialNumber(this.serialNumber)) return;
    this.historyTrigger$.next(this.selectedPeriodHours);
  }

  /** Extrai valor de documento TelemetryRaw (nested) ou evento WebSocket (flat) */
  private extractHistoryValue(
    d: any,
    flatKey: string,
    nestedPath: string[],
  ): number | null {
    const toNum = (v: any): number | null => {
      if (typeof v === 'number' && !isNaN(v)) return v;
      if (typeof v === 'string') {
        const n = Number(v);
        return !isNaN(n) ? n : null;
      }
      return null;
    };
    // Tenta flat primeiro (TelemetryVitals / eventos WebSocket ao vivo)
    const flatNum = toNum(d?.[flatKey]);
    if (flatNum !== null) return flatNum;
    // Lê nested (TelemetryHourly / TelemetryRaw do MongoDB)
    let cur: any = d;
    for (const key of nestedPath) {
      cur = cur?.[key];
      if (cur == null) return null;
    }
    return toNum(cur);
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
      this.chartData = {
        labels: this.chartLabels,
        datasets: this.chartDatasets,
      };
      this.opticalChartData = {
        labels: this.opticalChartLabels,
        datasets: this.opticalChartDatasets,
      };
      this.cdr.detectChanges();
      return;
    }

    const labels: string[] = [];
    const cpuData: (number | null)[] = [];
    const memData: (number | null)[] = [];
    const rxData: (number | null)[] = [];
    const txData: (number | null)[] = [];

    for (const d of data) {
      labels.push(this.timeFormatter.format(new Date(d.timestamp)));

      cpuData.push(
        this.extractHistoryValue(d, 'cpuUsage', [
          'telemetry',
          'system',
          'cpuUsage',
        ]),
      );

      const memFree = this.extractHistoryValue(d, 'memoryFree', [
        'telemetry',
        'system',
        'memoryFree',
      ]);
      const memTotal = this.extractHistoryValue(d, 'memoryTotal', [
        'telemetry',
        'system',
        'memoryTotal',
      ]);
      // Fallback para 7d: TelemetryHourly não agrega memoryFree/Total separados,
      // mas agrega memUsedPercent (memAvg). Usa diretamente quando disponível.
      const memUsedPercent = this.extractHistoryValue(d, 'memUsedPercent', [
        'telemetry',
        'system',
        'memAvg',
      ]);
      memData.push(
        memFree !== null && memTotal !== null && memTotal > 0
          ? Math.round(((memTotal - memFree) / memTotal) * 100)
          : memUsedPercent !== null
            ? Math.round(memUsedPercent)
            : null,
      );

      rxData.push(
        this.extractHistoryValue(d, 'opticalRx', [
          'telemetry',
          'optical',
          'rxPower',
        ]),
      ); // ← nome diferente!
      // opticalTx está disponível em TelemetryRaw/TelemetryHourly/TelemetryDaily, mas não em TelemetryVitals
      // extractHistoryValue retorna null se campo não existe, gráfico lida com null corretamente
      txData.push(
        this.extractHistoryValue(d, 'opticalTx', [
          'telemetry',
          'optical',
          'txPower',
        ]),
      ); // ← nome diferente!
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
    this.chartData = { labels: this.chartLabels, datasets: this.chartDatasets };
    this.opticalChartData = {
      labels: this.opticalChartLabels,
      datasets: this.opticalChartDatasets,
    };

    this.cdr.detectChanges(); // Renderiza imediatamente o gráfico
  }

  /**
   * Adiciona um novo ponto de telemetria ao gráfico em O(1) via WebSocket.
   * Evita requisição HTTP adicional para recarregar o histórico.
   * @param data - Dados de telemetria recebidos via WebSocket
   * @param timestamp - Timestamp do dado
   */
  private addTelemetryPointToChart(
    data: TelemetryData,
    timestamp: string,
  ): void {
    // ── PARTE SÍNCRONA: atualiza gráfico imediatamente (antes do detectChanges) ──
    const cpuValue = this.safeExtractValue(data, 'cpuUsage');
    const memFree = this.safeExtractValue(data, 'memoryFree');
    const memTotal = this.safeExtractValue(data, 'memoryTotal');
    // Fallback defensivo: se memoryFree/Total ausentes, tenta memUsedPercent direto
    const memUsedPercent = this.safeExtractValue(data, 'memUsedPercent');
    const memValue =
      memFree !== null && memTotal !== null && memTotal > 0
        ? Math.round(((memTotal - memFree) / memTotal) * 100)
        : memUsedPercent !== null
          ? Math.round(memUsedPercent)
          : null;
    const rxValue = this.safeExtractValue(data, 'opticalRx');
    const txValue = this.safeExtractValue(data, 'opticalTx');

    const timeLabel = this.timeFormatter.format(new Date(timestamp));

    this.chartLabels.push(timeLabel);
    this.opticalChartLabels.push(timeLabel);

    if (this.chartDatasets[0]) this.chartDatasets[0].data.push(cpuValue);
    if (this.chartDatasets[1]) this.chartDatasets[1].data.push(memValue);
    if (this.opticalChartDatasets[0])
      this.opticalChartDatasets[0].data.push(rxValue);
    if (this.opticalChartDatasets[1])
      this.opticalChartDatasets[1].data.push(txValue);

    if (this.chartLabels.length > MAX_CHART_POINTS) {
      this.chartLabels.shift();
      this.opticalChartLabels.shift();
      this.chartDatasets.forEach((ds) => ds.data.shift());
      this.opticalChartDatasets.forEach((ds) => ds.data.shift());
    }

    // Novas referências para ng2-charts detectar a mudança (OnPush)
    this.chartLabels = [...this.chartLabels];
    this.chartDatasets = this.chartDatasets.map((ds) => ({
      ...ds,
      data: [...ds.data],
    }));
    this.opticalChartLabels = [...this.opticalChartLabels];
    this.opticalChartDatasets = this.opticalChartDatasets.map((ds) => ({
      ...ds,
      data: [...ds.data],
    }));

    // Novas referências dos objetos wrapper (ng2-charts detecta mudança no input [data])
    this.chartData = { labels: this.chartLabels, datasets: this.chartDatasets };
    this.opticalChartData = {
      labels: this.opticalChartLabels,
      datasets: this.opticalChartDatasets,
    };

    // ── PARTE ASSÍNCRONA: persiste no cache (fire-and-forget, não bloqueia CD) ──
    const newSnapshot: TelemetrySnapshot = {
      timestamp: new Date(timestamp).toISOString(),
      cpuUsage: cpuValue ?? undefined,
      memoryUsage: memValue ?? undefined,
      opticalRx: rxValue ?? undefined,
    };

    this.telemetryCacheService
      .loadHistory(this.serialNumber, this.selectedPeriodHours)
      .then((currentHistory) => {
        const updatedHistory = [...(currentHistory || []), newSnapshot];
        if (updatedHistory.length > MAX_CHART_POINTS) {
          updatedHistory.splice(0, updatedHistory.length - MAX_CHART_POINTS);
        }
        return this.telemetryCacheService.saveHistory(
          this.serialNumber,
          this.selectedPeriodHours,
          updatedHistory,
        );
      })
      .catch((err) => logWarn('Erro ao persistir snapshot no cache', err));
  }
}
