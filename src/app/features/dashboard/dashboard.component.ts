// Caminho do arquivo: frontend/src/app/features/dashboard/dashboard.component.ts

import { Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef, ViewChild, inject, DestroyRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject, from, of, timer, forkJoin, zip, Observable } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { bufferTime, filter, debounceTime, distinctUntilChanged, bufferCount, concatMap, catchError, map } from 'rxjs/operators';
import { firstValueFrom } from 'rxjs';
import { ScrollingModule, CdkVirtualScrollViewport } from '@angular/cdk/scrolling';
import { NgChartsModule } from 'ng2-charts';
import { ChartConfiguration, ChartOptions } from 'chart.js';
import { CpeService } from '../../core/services/cpe.service';
import { WebSocketService } from '../../core/services/websocket.service';
import { ToastService } from '../../core/services/toast.service';
import { AuthService } from '../../core/services/auth.service';
import { ButtonComponent } from '../../core/components/button/button.component';
import { SkeletonComponent } from '../../core/components/skeleton/skeleton.component';
import { CpeDevice, PaginatedResponse, CpePrediction, DiagnosticOverview } from '../../core/models';
import { Router } from '@angular/router';
import { AlertsPanelComponent } from './components/alerts-panel/alerts-panel.component';
import { DiagnosticTargetService } from '../../core/services/diagnostic-target.service';

// Extensão da interface para suportar valores pré-computados em tela
interface DashboardCpe extends CpeDevice {
  _pppoe?: string;
  _rx?: number;
  _bw2g?: string | null; // Ex: "40MHz" — formatado para exibição
  _bw5g?: string | null; // Ex: "80MHz" — formatado para exibição
}

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule, ButtonComponent, SkeletonComponent, ScrollingModule, NgChartsModule, AlertsPanelComponent],
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class DashboardComponent implements OnInit, OnDestroy {
  // Referência ao Viewport para resetar o scroll ao trocar de página/filtro
  @ViewChild(CdkVirtualScrollViewport) viewport?: CdkVirtualScrollViewport;

  // Lista de equipamentos e contadores

  // ──────────────────────────────────────────────────────────────────────────
  // NOTA PARA O TEMPLATE HTML (dashboard.component.html):
  // Para remover o Wi-Fi 2.4G e exibir a conta PPPoE na tabela:
  // 1. Substitua o cabeçalho <th>Wi-Fi 2.4G</th> por <th>PPPoE</th>
  // 2. Substitua o respectivo dado (<td>) por: <td>{{ cpe['pppoeUsername'] || 'DHCP/Fixo' }}</td>
  // ──────────────────────────────────────────────────────────────────────────
  allCpes: DashboardCpe[] = []; // Lista completa, não filtrada, para o worker
  cpes: DashboardCpe[] = []; // Lista filtrada para exibição no Virtual Scroll
  private cpeIndexMap = new Map<string, number>();

  // Métricas Globais (Reais do Banco de Dados)
  globalTotalCpes: number = 0;
  globalOnlineCount: number = 0;
  globalCriticalGponCount: number = 0;
  globalPendingTasksCount: number = 0;

  // Widget de Saúde da Frota (Step 9)
  healthSummary: {
    totalCpes: number;
    online: number;
    offline: number;
    neverSeen: number;
    criticalAlerts: number;
    byManufacturer: { name: string; count: number }[];
    byFirmware: { firmware: string; count: number }[];
    lastUpdated: string;
  } | null = null;

  // Métricas de saúde do Backend (Worker Threads XML)
  xmlParserMetrics: {
    poolSize: number;
    activeWorkers: number;
    queueSize: number;
    totalParsed: number;
    avgProcessingTimeMs: number;
    p95ProcessingTimeMs: number;
    lastMemoryUsageMB: number;
    errors: number;
  } | null = null;
  queueStats: { messageCount: number; consumerCount: number } | null = null;
  processHealth: { rssMB: number; heapUsedMB: number; uptimeSeconds: number } | null = null;
  workerHealthDegraded: boolean = false;
  selectedCpes = new Set<string>();

  // ─── MONITORAMENTO ACS EXPANDIDO (FASE 3) ────────────────────────────────
  // Informações de versão e status de serviços do backend (do endpoint /health)
  acsSystemInfo: {
    version: string;
    uptimeSeconds: number;
    mongodbStatus: 'connected' | 'disconnected' | 'degraded';
    redisStatus: 'connected' | 'disconnected' | 'degraded';
    eventLoopLagMs: number;
    admissionCircuitOpen: boolean;
    mongoCircuitState: string;
  } | null = null;

  // Alertas de sistema — disparados quando thresholds são cruzados
  systemAlerts: { level: 'warning' | 'critical'; message: string; metric: string }[] = [];

  // Getter: uptime formatado em dias/horas/minutos
  get acsUptimeFormatted(): string {
    if (!this.acsSystemInfo?.uptimeSeconds) return 'N/D';
    const s = this.acsSystemInfo.uptimeSeconds;
    const days = Math.floor(s / 86400);
    const hours = Math.floor((s % 86400) / 3600);
    const mins = Math.floor((s % 3600) / 60);
    if (days > 0) return `${days}d ${hours}h ${mins}m`;
    if (hours > 0) return `${hours}h ${mins}m`;
    return `${mins}m`;
  }

  // Getter: status geral do backend (ok/degraded/critical)
  get backendStatus(): 'ok' | 'degraded' | 'critical' {
    if (!this.acsSystemInfo) return 'ok';
    if (this.acsSystemInfo.mongodbStatus === 'disconnected' || this.acsSystemInfo.redisStatus === 'disconnected') return 'critical';
    if (this.workerHealthSeverity === 'critical') return 'critical';
    if (this.workerHealthSeverity === 'warning' ||
        this.acsSystemInfo.mongodbStatus === 'degraded' ||
        this.acsSystemInfo.redisStatus === 'degraded' ||
        this.acsSystemInfo.admissionCircuitOpen) return 'degraded';
    return 'ok';
  }

  // Thresholds centralizados para saúde do ACS
  readonly WORKER_HEALTH_THRESHOLDS = {
    avgMsWarning: 80,
    avgMsCritical: 150,
    memoryMBWarning: 400,
    memoryMBCritical: 600,
    queueWarning: 50,
    queueCritical: 200
  };

  // Ordenação multi-coluna — qualquer coluna pode ser ordenada (asc/desc/null)
  // Coluna ativa null = ordem original do backend
  sortColumn: string | null = null;
  sortDirection: 'asc' | 'desc' | null = null;

  // Colunas ordenáveis da tabela
  readonly SORTABLE_COLUMNS: readonly string[] = [
    'status', 'serialNumber', 'model', 'wanIp', 'pppoe', 'rx', 'healthScore', 'tasks'
  ];

  // Compatibilidade: mantém healthScoreSortDirection mapeando para o novo sistema
  get healthScoreSortDirection(): 'asc' | 'desc' | null {
    return this.sortColumn === 'healthScore' ? this.sortDirection : null;
  }

  // Filtros da tabela
  searchQuery: string = '';
  searchSubject = new Subject<string>();
  private refilterSubject = new Subject<void>();
  filterStatus: 'all' | 'online' | 'offline' = 'all';
  filterManufacturer: string = '';
  filterModel: string = '';
  filterFirmware: string = '';
  filterCriticalGpon: boolean = false;
  filterHealthScore: 'critical' | 'attention' | 'healthy' | null = null;

  // Agregações de marca e modelo
  globalManufacturers: { name: string; count: number }[] = [];
  globalModels: { name: string; count: number }[] = [];
  globalFirmwares: { name: string; count: number }[] = [];

  // Modais
  isConfigModalOpen: boolean = false;
  selectedCpeForConfig: DashboardCpe | null = null;

  // Modais de Inteligência Artificial
  isAiModalOpen: boolean = false;
  selectedCpeForAi: DashboardCpe | null = null;
  isAnalyzingAi: boolean = false;
  aiReport: any = null;

  // Modal de confirmação de bulk reboot
  isBulkRebootConfirmOpen: boolean = false;
  bulkRebootConfirmCount: number = 0;

  // Estado de carregamento
  loading: boolean = true;
  isRefiltering: boolean = false; // true durante re-filtragem silenciosa (WS); não exibe skeleton
  isLoadingMore: boolean = false; // true durante carregamento incremental de página (scroll)
  private currentPage: number = 1;
  private totalPages: number = 1;
  private readonly PAGE_SIZE = 500;

  // Getter para detectar filtros ativos (público para uso no template)
  get hasActiveFilters(): boolean {
    return this.filterStatus !== 'all'
      || !!this.filterManufacturer
      || !!this.filterModel
      || !!this.filterFirmware
      || !!this.searchQuery.trim()
      || this.filterCriticalGpon
      || this.filterHealthScore !== null;
  }

  // CPEs que já receberam alerta de offline nesta sessão (evita spam)
  private alertedOfflineCpes = new Set<string>();
  private alertedGponCpes = new Set<string>();
  // CPEs aguardando Connection Request — exibe spinner no botão bolt
  wakingUpCpes = new Set<string>();
  // CPEs aguardando reboot — exibe spinner no botão power
  rebootingCpes = new Set<string>();

  private timeAgoInterval?: ReturnType<typeof setInterval>;
  private metricsInterval?: ReturnType<typeof setInterval>;
  private healthSummaryInterval?: ReturnType<typeof setInterval>;
  private visibilityHandler?: () => void;
  private worker?: Worker;
  private destroyRef = inject(DestroyRef); // Gerenciador de ciclo de vida moderno do Angular 17+

  // ─── DIAGNÓSTICOS PERIÓDICOS — SAÚDE DA REDE ──────────────────────────────
  diagnosticOverview: DiagnosticOverview | null = null;
  diagLastUpdate: string | null = null;
  diagEmptyMessage: string | null = null;
  private diagnosticInterval?: ReturnType<typeof setInterval>;
  readonly diagnosticTooltipText = 'Diagnósticos periódicos (IPPing, TraceRoute, DNSLookup) executados automaticamente pelo scheduler a cada hora contra destinos cadastrados. A taxa de sucesso indica quantos diagnósticos completaram sem erro. A latência média reflete o tempo de resposta da rede. CPEs com falhas são equipamentos que falharam em pelo menos 1 diagnóstico no período.';
  readonly diagnosticRefreshText = 'Este gráfico é atualizado automaticamente a cada 5 minutos. A próxima atualização ocorrerá após o intervalo. Você também pode atualizar a página para ver os dados mais recentes.';

  // Gráfico de barras empilhadas: sucesso/erro por dia
  diagChartLabels: string[] = [];
  diagChartDatasets: ChartConfiguration<'bar'>['data']['datasets'] = [
    { data: [], label: 'Sucesso', backgroundColor: 'rgba(16, 185, 129, 0.7)', borderColor: '#10b981', borderWidth: 1, yAxisID: 'y', type: 'bar' as const },
    { data: [], label: 'Erro', backgroundColor: 'rgba(239, 68, 68, 0.7)', borderColor: '#ef4444', borderWidth: 1, yAxisID: 'y', type: 'bar' as const },
  ];
  diagChartOptions: ChartOptions<'bar'> = {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    plugins: {
      legend: { display: true, position: 'top' as const },
      tooltip: { enabled: true, mode: 'index' as const, intersect: false },
    },
    scales: {
      x: { stacked: true, title: { display: true, text: 'Data' } },
      y: { stacked: true, beginAtZero: true, title: { display: true, text: 'Execuções' }, position: 'left' as const },
    },
  };

  // Gráfico de Saúde do ACS
  xmlChartOptions: ChartOptions<'line'> = {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    plugins: { legend: { display: true }, tooltip: { enabled: true } },
    scales: {
      x: { display: false },
      y: { beginAtZero: true, display: false }
    },
    elements: { point: { radius: 0 } }
  };
  xmlChartLabels: string[] = [];
  xmlChartDatasets: ChartConfiguration<'line'>['data']['datasets'] = [
    { data: [], label: 'Média (ms)', borderColor: '#10b981', backgroundColor: 'rgba(16, 185, 129, 0.2)', fill: true, tension: 0.4, borderWidth: 2 },
    { data: [], label: 'P95 (ms)', borderColor: '#f59e0b', borderDash: [4, 4], fill: false, tension: 0.4, borderWidth: 1.5 }
  ];

  constructor(
    private cpeService: CpeService,
    private wsService: WebSocketService,
    private toastService: ToastService,
    private router: Router,
    private cdr: ChangeDetectorRef,
    public authService: AuthService,
    private diagnosticTargetService: DiagnosticTargetService
  ) {}

  get workerHealthSeverity(): 'ok' | 'warning' | 'critical' {
    if (!this.xmlParserMetrics) return 'ok';
    const t = this.WORKER_HEALTH_THRESHOLDS;
    if (this.xmlParserMetrics.avgProcessingTimeMs > t.avgMsCritical ||
        this.xmlParserMetrics.lastMemoryUsageMB > t.memoryMBCritical ||
        (this.queueStats?.messageCount ?? 0) > t.queueCritical) return 'critical';
    if (this.xmlParserMetrics.avgProcessingTimeMs > t.avgMsWarning ||
        this.xmlParserMetrics.lastMemoryUsageMB > t.memoryMBWarning ||
        (this.queueStats?.messageCount ?? 0) > t.queueWarning) return 'warning';
    return 'ok';
  }

  ngOnInit(): void {
    // F2: Restaura filtros salvos no localStorage antes de carregar dados
    this.loadSavedFilters();

    // Setup do debounce reativo para a busca (Otimização RxJS)
    this.searchSubject.pipe(
      debounceTime(400),
      distinctUntilChanged(),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(query => {
      this.triggerFilter();
    });

    // Setup do debounce para re-filtragem WS (evita spam ao Worker)
    this.refilterSubject.pipe(
      debounceTime(300),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(() => {
      this.triggerFilter(false);
    });

    // Inicializa o Web Worker para isolar o processamento pesado de filtros
    if (typeof Worker !== 'undefined') {
      this.worker = new Worker(new URL('./cpe-filter.worker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = ({ data }) => {
        if (data.error) {
          this.toastService.error(`Erro no filtro: ${data.message}`);
          this.cpes = this.applyFilters(this.allCpes); // Fallback: aplica filtros na thread principal
        } else {
          this.cpes = data;
        }
        // Reaplica ordenação por health score se ativa, mantendo-a estável durante atualizações WS
        if (this.healthScoreSortDirection !== null) {
          this.applyHealthScoreSort();
        }
        this.loading = false;
        this.isRefiltering = false;
        this.cdr.markForCheck();
      };
      this.worker.onerror = (error) => {
        this.toastService.error('Ocorreu um erro no processamento de filtros em segundo plano.');
        this.cpes = this.applyFilters(this.allCpes); // Fallback: aplica filtros na thread principal
        this.loading = false;
        this.isRefiltering = false;
        this.cdr.markForCheck();
      };
    }

    this.loadInitialData();
    this.loadHealthSummary();
    this.loadDiagnosticOverview();
    this.setupRealTimeUpdates();
    // Entra na sala global para receber eventos de qualquer CPE no dashboard
    this.wsService.subscribeToAllCpes();

    // OTIMIZAÇÃO: Relógio passivo interno (Heartbeat Visual)
    // Atualiza o texto "Há X min" dinamicamente e detecta CPEs que caíram (silenciosamente).
    // Itera sobre allCpes (fonte de verdade) — se mutar apenas cpes (lista filtrada),
    // o próximo refilter do worker sobrescreveria com allCpes ainda isOnline=true.
    this.timeAgoInterval = setInterval(() => {
      const now = Date.now();
      let hasChanges = false;

      this.allCpes.forEach(cpe => {
        if (cpe.lastInform) {
          const minsSince = (now - new Date(cpe.lastInform).getTime()) / 60000;

          // Se passou 5 minutos sem comunicação da CPE, marca como offline na interface
          if (cpe.isOnline && minsSince > 5) {
            cpe.isOnline = false;
            this.globalOnlineCount--;
            hasChanges = true;
          }
          this.checkAlerts(cpe);
        }
      });
      this.globalOnlineCount = Math.max(0, this.globalOnlineCount);
      // Se houve mudança de status, dispara refilter para o worker atualizar cpes[]
      if (hasChanges) {
        this.refilterSubject.next();
      }
      this.cdr.markForCheck(); // Força atualização dos textos "Há X min"
    }, 60000);

    // OTIMIZAÇÃO: Polling real para o Gráfico de Saúde do ACS
    // Cada ponto do gráfico agora é uma amostra REAL do backend, não repetição do mesmo valor
    this.startMetricsPolling();

    // Polling para Widget de Saúde da Frota (Step 9)
    this.healthSummaryInterval = setInterval(() => {
      this.loadHealthSummary();
    }, 30000); // Atualiza a cada 30 segundos

    // Polling para visão geral de diagnósticos periódicos (5min — muda lentamente)
    this.diagnosticInterval = setInterval(() => {
      this.loadDiagnosticOverview();
    }, 300000);

    // OTIMIZAÇÃO P5: Pausar polling quando a aba está ociosa (Page Visibility API)
    // Reduz carga no backend quando o técnico alterna entre abas do navegador
    this.visibilityHandler = () => {
      if (document.hidden) {
        clearInterval(this.metricsInterval);
        clearInterval(this.healthSummaryInterval);
        clearInterval(this.diagnosticInterval);
        this.diagnosticInterval = undefined;
        clearInterval(this.healthSummaryInterval);
        this.metricsInterval = undefined;
        this.healthSummaryInterval = undefined;
      } else {
        // Retoma polling imediatamente ao voltar à aba
        if (!this.metricsInterval) {
          this.startMetricsPolling();
        }
        if (!this.healthSummaryInterval) {
          this.healthSummaryInterval = setInterval(() => {
            this.loadHealthSummary();
          }, 30000);
          // Atualiza imediatamente ao retornar
          this.loadHealthSummary();
        }
        if (!this.diagnosticInterval) {
          this.diagnosticInterval = setInterval(() => {
            this.loadDiagnosticOverview();
          }, 300000);
          this.loadDiagnosticOverview();
        }
      }
    };
    document.addEventListener('visibilitychange', this.visibilityHandler);
  }

  /**
   * Inicia o polling de métricas de saúde do ACS.
   * Combina dois endpoints via forkJoin:
   *  - /health (público): version, uptime, mongodb, redis, admission, mongoCircuit
   *  - /api/system/health/workers (auth): xmlParser, rabbitmq, process
   * Intervalo de 5s — equilíbrio entre frescor e carga no backend.
   */
  private startMetricsPolling(): void {
    this.metricsInterval = setInterval(() => {
      forkJoin({
        system: this.cpeService.getSystemHealth().pipe(catchError(() => of(null))),
        workers: this.cpeService.getWorkerHealth().pipe(catchError(() => of(null))),
      }).subscribe({
        next: ({ system, workers }) => {
          // --- Endpoint /health (sistema) ---
          if (system) {
            this.acsSystemInfo = {
              version: system.version ?? 'N/D',
              uptimeSeconds: system.uptime ?? 0,
              mongodbStatus: (system.mongodb === 'connected' ? 'connected' : system.mongodb === 'degraded' ? 'degraded' : 'disconnected') as 'connected' | 'disconnected' | 'degraded',
              redisStatus: (system.redis === 'connected' ? 'connected' : system.redis === 'degraded' ? 'degraded' : 'disconnected') as 'connected' | 'disconnected' | 'degraded',
              eventLoopLagMs: system.admission?.eventLoopLagMs ?? 0,
              admissionCircuitOpen: system.admission?.circuitOpen ?? false,
              mongoCircuitState: system.mongoCircuit?.state ?? 'closed',
            };
          }

          // --- Endpoint /api/system/health/workers (workers) ---
          if (workers) {
            this.xmlParserMetrics = workers.xmlParser;
            this.queueStats = workers.rabbitmq;
            this.processHealth = workers.process;
            this.workerHealthDegraded = false;

            const now = new Date().toLocaleTimeString();
            this.xmlChartLabels.push(now);
            this.xmlChartDatasets[0].data.push(workers.xmlParser.avgProcessingTimeMs);
            this.xmlChartDatasets[1].data.push(workers.xmlParser.p95ProcessingTimeMs);
            if (this.xmlChartLabels.length > 30) {
              this.xmlChartLabels.shift();
              this.xmlChartDatasets[0].data.shift();
              this.xmlChartDatasets[1].data.shift();
            }
            this.xmlChartDatasets = [...this.xmlChartDatasets];
          } else {
            this.workerHealthDegraded = true;
          }

          // Gera alertas de sistema baseados nos thresholds
          this.evaluateSystemAlerts();

          this.cdr.markForCheck();
        },
        error: () => {
          this.workerHealthDegraded = true;
          this.cdr.markForCheck();
        }
      });
    }, 5000);
  }

  /**
   * Avalia métricas contra thresholds e gera alertas de sistema visíveis no painel.
   * Alertas são recalculados a cada polling — não persistem entre ciclos.
   */
  private evaluateSystemAlerts(): void {
    const alerts: { level: 'warning' | 'critical'; message: string; metric: string }[] = [];
    const t = this.WORKER_HEALTH_THRESHOLDS;

    if (this.xmlParserMetrics) {
      if (this.xmlParserMetrics.avgProcessingTimeMs > t.avgMsCritical) {
        alerts.push({ level: 'critical', message: `CPU XML parser crítica: ${this.xmlParserMetrics.avgProcessingTimeMs}ms`, metric: 'cpu' });
      } else if (this.xmlParserMetrics.avgProcessingTimeMs > t.avgMsWarning) {
        alerts.push({ level: 'warning', message: `CPU XML parser elevada: ${this.xmlParserMetrics.avgProcessingTimeMs}ms`, metric: 'cpu' });
      }

      if (this.xmlParserMetrics.lastMemoryUsageMB > t.memoryMBCritical) {
        alerts.push({ level: 'critical', message: `RAM crítica: ${this.xmlParserMetrics.lastMemoryUsageMB}MB`, metric: 'memory' });
      } else if (this.xmlParserMetrics.lastMemoryUsageMB > t.memoryMBWarning) {
        alerts.push({ level: 'warning', message: `RAM elevada: ${this.xmlParserMetrics.lastMemoryUsageMB}MB`, metric: 'memory' });
      }
    }

    if (this.queueStats) {
      if (this.queueStats.messageCount > t.queueCritical) {
        alerts.push({ level: 'critical', message: `Fila RabbitMQ crítica: ${this.queueStats.messageCount} mensagens`, metric: 'queue' });
      } else if (this.queueStats.messageCount > t.queueWarning) {
        alerts.push({ level: 'warning', message: `Fila RabbitMQ elevada: ${this.queueStats.messageCount} mensagens`, metric: 'queue' });
      }
    }

    if (this.acsSystemInfo) {
      if (this.acsSystemInfo.mongodbStatus === 'disconnected') {
        alerts.push({ level: 'critical', message: 'MongoDB desconectado', metric: 'mongodb' });
      } else if (this.acsSystemInfo.mongodbStatus === 'degraded') {
        alerts.push({ level: 'warning', message: 'MongoDB degradado', metric: 'mongodb' });
      }
      if (this.acsSystemInfo.redisStatus === 'disconnected') {
        alerts.push({ level: 'critical', message: 'Redis desconectado', metric: 'redis' });
      } else if (this.acsSystemInfo.redisStatus === 'degraded') {
        alerts.push({ level: 'warning', message: 'Redis degradado', metric: 'redis' });
      }
      // Alerta: admission circuit aberto (backend sob pressão, rejeitando requisições)
      if (this.acsSystemInfo.admissionCircuitOpen) {
        alerts.push({ level: 'critical', message: 'Admission circuit aberto — backend rejeitando requisições', metric: 'admission' });
      }
      // Alerta: event loop lag alto
      if (this.acsSystemInfo.eventLoopLagMs > 100) {
        alerts.push({ level: 'critical', message: `Event loop lag crítico: ${this.acsSystemInfo.eventLoopLagMs}ms`, metric: 'eventloop' });
      } else if (this.acsSystemInfo.eventLoopLagMs > 30) {
        alerts.push({ level: 'warning', message: `Event loop lag elevado: ${this.acsSystemInfo.eventLoopLagMs}ms`, metric: 'eventloop' });
      }
    }

    this.systemAlerts = alerts;
  }

  ngOnDestroy(): void {
    // F2: Persiste filtros atuais no localStorage
    this.saveFilters();
    this.wsService.unsubscribeFromAllCpes();
    clearInterval(this.timeAgoInterval);
    clearInterval(this.metricsInterval);
    clearInterval(this.healthSummaryInterval);
    clearInterval(this.diagnosticInterval);
    if (this.visibilityHandler) {
      document.removeEventListener('visibilitychange', this.visibilityHandler);
    }
    this.worker?.terminate();
  }

  // F2: Persistência de filtros no localStorage — restaura estado ao recarregar a página.
  private static readonly FILTERS_KEY = 'vmoas_dashboard_filters';

  private saveFilters(): void {
    try {
      const filters = {
        searchQuery: this.searchQuery,
        filterStatus: this.filterStatus,
        filterManufacturer: this.filterManufacturer,
        filterModel: this.filterModel,
        filterFirmware: this.filterFirmware,
        filterCriticalGpon: this.filterCriticalGpon,
        filterHealthScore: this.filterHealthScore,
      };
      localStorage.setItem(DashboardComponent.FILTERS_KEY, JSON.stringify(filters));
    } catch (e) {
      console.error('Erro ao salvar filtros no localStorage', e);
    }
  }

  private loadSavedFilters(): void {
    try {
      const raw = localStorage.getItem(DashboardComponent.FILTERS_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw);
      if (saved.searchQuery !== undefined) this.searchQuery = saved.searchQuery;
      if (saved.filterStatus) this.filterStatus = saved.filterStatus;
      if (saved.filterManufacturer !== undefined) this.filterManufacturer = saved.filterManufacturer;
      if (saved.filterModel !== undefined) this.filterModel = saved.filterModel;
      if (saved.filterFirmware !== undefined) this.filterFirmware = saved.filterFirmware;
      if (saved.filterCriticalGpon !== undefined) this.filterCriticalGpon = saved.filterCriticalGpon;
      if (saved.filterHealthScore !== undefined) this.filterHealthScore = saved.filterHealthScore;
    } catch (e) {
      console.error('Erro ao carregar filtros do localStorage', e);
    }
  }

  /**
   * Busca a lista inicial de CPEs via API REST com paginação híbrida.
   * Carrega a primeira página (500 itens) e delega filtro/busca ao Web Worker.
   * Páginas subsequentes são carregadas sob demanda via onScrollIndex().
   */
  loadInitialData(): void {
    this.loading = true;
    this.currentPage = 1;
    this.cpeService.getAllCpes(1, this.PAGE_SIZE).subscribe({
      next: (response: any) => {
        this.allCpes = response.data.map((c: any) => this.enrichCpeData(c));
        this.cpeIndexMap.clear();
        this.allCpes.forEach((cpe, i) => this.cpeIndexMap.set(cpe.serialNumber, i));
        this.globalTotalCpes = response.pagination.total;
        this.totalPages = response.pagination.totalPages;

        // Recebe as métricas agregadas diretamente do MongoDB (agregação global, não paginada)
        if (response.metrics) {
          this.globalOnlineCount = response.metrics.onlineCount;
          // globalCriticalGponCount calculado localmente via _rx (opticalRx removido do schema Cpe EP28)
          this.globalCriticalGponCount = this.allCpes.filter(c => c._rx !== undefined && c._rx < -27).length;
          this.globalPendingTasksCount = response.metrics.pendingTasksCount;
          this.globalManufacturers = (response.metrics.byManufacturer || []).map((m: any) => ({ name: m._id || 'Desconhecido', count: m.count }));
          this.globalModels = (response.metrics.byModel || []).map((m: any) => ({ name: m._id || 'Desconhecido', count: m.count }));
          this.globalFirmwares = (response.metrics.byFirmware || []).map((m: any) => ({ name: m._id || 'Desconhecido', count: m.count })).sort((a: any, b: any) => b.count - a.count);
        } else {
          this.calculateFallbackMetrics();
        }

        this.triggerFilter();

        if (this.viewport) {
          this.viewport.scrollToIndex(0);
        }
      },
      error: () => {
        this.toastService.error('Falha ao carregar lista de CPEs.');
        this.loading = false;
        this.cdr.markForCheck();
      },
    });
  }

  /**
   * Carrega a próxima página de CPEs quando o usuário rola próximo ao fim da lista.
   * Acionado pelo evento scrolledIndexChange do CDK Virtual Scroll.
   */
  onScrollIndex(index: number): void {
    // Não carrega se já está carregando, se não há mais páginas, ou se o usuário está longe do fim
    if (this.isLoadingMore || this.currentPage >= this.totalPages) return;
    const loadedCount = this.allCpes.length;
    // Gatilho: quando o usuário chega a 80% dos itens carregados
    if (index < loadedCount * 0.8) return;

    this.isLoadingMore = true;
    const nextPage = this.currentPage + 1;
    this.cpeService.getAllCpes(nextPage, this.PAGE_SIZE).subscribe({
      next: (response: any) => {
        const newCpes = response.data.map((c: any) => this.enrichCpeData(c));
        // Adiciona apenas CPEs que ainda não estão carregadas (evita duplicatas de updates WS)
        const newOnes = newCpes.filter((c: DashboardCpe) => !this.cpeIndexMap.has(c.serialNumber));
        newOnes.forEach((cpe: DashboardCpe) => {
          this.cpeIndexMap.set(cpe.serialNumber, this.allCpes.length);
          this.allCpes.push(cpe);
        });
        this.currentPage = nextPage;
        this.isLoadingMore = false;
        // Re-filtra com a lista expandida (sem overlay de loading)
        this.triggerFilter(false);
        this.cdr.markForCheck();
      },
      error: () => {
        this.isLoadingMore = false;
        this.cdr.markForCheck();
      },
    });
  }

  private triggerFilter(showLoadingOverlay: boolean = true): void {
    // Atalho: sem filtros ativos → atualiza cpes diretamente, sem Worker
    if (!this.hasActiveFilters) {
      this.cpes = [...this.allCpes];
      if (this.healthScoreSortDirection !== null) {
        this.applyHealthScoreSort();
      }
      this.loading = false;
      this.isRefiltering = false;
      this.cdr.markForCheck();
      return;
    }

    if (showLoadingOverlay) {
      this.loading = true;
    } else {
      this.isRefiltering = true;
    }
    this.cdr.markForCheck();

    const filters: Record<string, any> = {};
    if (this.filterStatus === 'online') filters['isOnline'] = true;
    if (this.filterStatus === 'offline') filters['isOnline'] = false;
    if (this.filterManufacturer) filters['manufacturer'] = this.filterManufacturer;
    if (this.filterModel) filters['productClass'] = this.filterModel;
    if (this.filterFirmware) filters['softwareVersion'] = this.filterFirmware;
    if (this.searchQuery.trim()) filters['search'] = this.searchQuery.trim();
    if (this.filterCriticalGpon) filters['isCriticalGpon'] = true;
    if (this.filterHealthScore) filters['healthScore'] = this.filterHealthScore;

    if (this.worker) {
      this.worker.postMessage({ cpes: this.allCpes, filters });
    } else {
      this.cpes = this.applyFilters(this.allCpes);
      this.loading = false;
      this.isRefiltering = false;
      this.cdr.markForCheck();
    }
  }

  /**
   * Aplica filtros e volta para a primeira página.
   * Usa debounce para a busca por texto (evita requisição a cada tecla).
   */
  onFilterChange(): void {
    // Dispara o evento RxJS para a busca
    this.searchSubject.next(this.searchQuery);
  }

  onStatusFilterChange(status: 'all' | 'online' | 'offline'): void {
    this.filterStatus = status;
    this.triggerFilter();
  }

  onManufacturerFilterChange(manufacturer: string): void {
    this.filterManufacturer = this.filterManufacturer === manufacturer ? '' : manufacturer;
    this.triggerFilter();
  }

  onModelFilterChange(model: string): void {
    this.filterModel = this.filterModel === model ? '' : model;
    this.triggerFilter();
  }

  onFirmwareFilterChange(firmware: string): void {
    this.filterFirmware = this.filterFirmware === firmware ? '' : firmware;
    this.triggerFilter();
  }

  toggleCriticalGponFilter(): void {
    this.filterCriticalGpon = !this.filterCriticalGpon;
    this.triggerFilter();
  }

  onHealthScoreFilterChange(faixa: 'critical' | 'attention' | 'healthy'): void {
    // Toggle: clicar na faixa ativa desativa o filtro
    this.filterHealthScore = this.filterHealthScore === faixa ? null : faixa;
    this.triggerFilter();
  }

  clearFilters(): void {
    this.filterStatus = 'all';
    this.filterManufacturer = '';
    this.filterModel = '';
    this.filterFirmware = '';
    this.searchQuery = '';
    this.filterCriticalGpon = false;
    this.filterHealthScore = null;
    this.triggerFilter();
  }

  /**
   * Configura os ouvintes do WebSocket e monitoriza alterações de IP
   * IMPLEMENTAÇÃO DE DEBOUNCE PARA SUPORTAR 6.000+ CPEs
   *
   * CORREÇÃO: Utilizando bufferTime ao invés de debounceTime para não perder
   * atualizações concorrentes. Agrupa múltiplos eventos em um array a cada 500ms.
   * OTIMIZAÇÃO: runOutsideAngular + markForCheck reduz CD calls de 6000 para 1 por 500ms.
   */
  setupRealTimeUpdates(): void {
    this.wsService.onCpeUpdated().pipe(
      bufferTime(500),
      filter(updates => updates.length > 0),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(updatedCpes => {
      let hasChanges = false;
      updatedCpes.forEach(updatedCpe => {
        if (this.processCpeUpdate(updatedCpe)) hasChanges = true;
      });
      this.applyChangesIfAny(hasChanges);
    });

    this.wsService.onCpeOnline().pipe(
      bufferTime(500),
      filter(updates => updates.length > 0),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(onlineCpes => {
      let hasChanges = false;
      onlineCpes.forEach(onlineCpe => {
        const mergedCpe = { ...onlineCpe, isOnline: true };
        if (this.processCpeUpdate(mergedCpe, true)) hasChanges = true;
        // Remove spinner de Connection Request quando a CPE volta online
        if (this.wakingUpCpes.has(onlineCpe.serialNumber)) {
          this.wakingUpCpes.delete(onlineCpe.serialNumber);
          this.toastService.success(`${onlineCpe.serialNumber} voltou online!`);
        }
        // Remove spinner de reboot quando a CPE volta online (reboot completo)
        if (this.rebootingCpes.has(onlineCpe.serialNumber)) {
          this.rebootingCpes.delete(onlineCpe.serialNumber);
          this.toastService.success(`${onlineCpe.serialNumber} reiniciou com sucesso!`);
        }
      });
      this.applyChangesIfAny(hasChanges);
    });

    // cpe_batch_update: ativado pelo batchEmitter quando >10 eventos/2s (mass reboot)
    // Dispatcha cada item para processCpeUpdate() usando eventName como hint de tipo
    this.wsService.onCpeBatchUpdate().pipe(
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(batch => {
      let hasChanges = false;
      const isOnlineEvent = batch.eventName === 'cpe_online';
      batch.items.forEach((payload: Partial<CpeDevice>) => {
        const cpeData = isOnlineEvent ? { ...payload, isOnline: true } : payload;
        if (this.processCpeUpdate(cpeData, isOnlineEvent)) hasChanges = true;
      });
      this.applyChangesIfAny(hasChanges);
    });

    this.wsService.on('cpe_deleted').pipe(
      takeUntilDestroyed(this.destroyRef)
    ).subscribe((data: any) => {
      this.removeCpe(data.serialNumber);
    });
  }

  // --- HELPER METHODS PARA ATUALIZAÇÃO EM TEMPO REAL ---

  private escapeRegex(string: string): string {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private applyFilters(cpes: DashboardCpe[]): DashboardCpe[] {
    const filters = {
      isOnline: this.filterStatus === 'all' ? undefined : this.filterStatus === 'online',
      manufacturer: this.filterManufacturer || undefined,
      productClass: this.filterModel || undefined,
      softwareVersion: this.filterFirmware || undefined,
      isCriticalGpon: this.filterCriticalGpon || undefined,
      healthScore: this.filterHealthScore,
      search: this.searchQuery || undefined
    };

    return cpes.filter(cpe => {
      if (filters.isOnline !== undefined && cpe.isOnline !== filters.isOnline) return false;
      if (filters.manufacturer && (cpe.deviceInfo?.manufacturer || cpe.manufacturer) !== filters.manufacturer) return false;
      if (filters.productClass && (cpe.deviceInfo?.productClass || cpe.productClass) !== filters.productClass) return false;
      if (filters.softwareVersion && (cpe.deviceInfo?.softwareVersion || cpe.softwareVersion) !== filters.softwareVersion) return false;
      if (filters.isCriticalGpon && (cpe._rx === undefined || cpe._rx >= -27)) return false;
      if (filters.healthScore) {
        const score = cpe.healthScore;
        if (score === undefined || score === null) return false;
        if (filters.healthScore === 'critical' && score >= 50) return false;
        if (filters.healthScore === 'attention' && (score < 50 || score >= 80)) return false;
        if (filters.healthScore === 'healthy' && score < 80) return false;
      }
      if (filters.search) {
        const searchRegex = new RegExp(this.escapeRegex(filters.search), 'i');
        const matches =
          searchRegex.test(cpe.serialNumber) ||
          ((cpe.wan?.ip || cpe.wanIp) && searchRegex.test((cpe.wan?.ip || cpe.wanIp)!)) ||
          ((cpe.deviceInfo?.productClass || cpe.productClass) && searchRegex.test((cpe.deviceInfo?.productClass || cpe.productClass)!)) ||
          (cpe._pppoe && searchRegex.test(cpe._pppoe)) ||
          ((cpe.deviceInfo?.manufacturer || cpe.manufacturer) && searchRegex.test((cpe.deviceInfo?.manufacturer || cpe.manufacturer)!));
        if (!matches) return false;
      }
      return true;
    });
  }

  private processCpeUpdate(updatedCpe: Partial<CpeDevice>, isOnlineEvent = false): boolean {
    if (!updatedCpe.serialNumber) return false;
    const index = this.cpeIndexMap.get(updatedCpe.serialNumber!) ?? -1;

    if (index !== -1) {
      this.updateExistingCpe(index, updatedCpe, isOnlineEvent);
      return true;
    } else {
      this.insertNewCpe(updatedCpe);
      return true;
    }
  }

  private updateExistingCpe(index: number, updatedCpe: Partial<CpeDevice>, isOnlineEvent: boolean): void {
    const oldCpe = this.allCpes[index];
    const mergedCpe = { ...oldCpe, ...updatedCpe } as CpeDevice;
    const enrichedCpe = this.enrichCpeData(mergedCpe);

    // Reatividade Global: Ajusta contadores pelo delta de mudança
    if (isOnlineEvent && !oldCpe.isOnline) {
      this.globalOnlineCount++;
      this.alertedOfflineCpes.delete(enrichedCpe.serialNumber);
      this.toastService.success(`CPE ${enrichedCpe.serialNumber} está online.`);
    } else if (oldCpe.isOnline !== enrichedCpe.isOnline) {
      this.globalOnlineCount += enrichedCpe.isOnline ? 1 : -1;
    }

    const wasCritical = oldCpe._rx !== undefined && oldCpe._rx < -27;
    const isCritical = enrichedCpe._rx !== undefined && enrichedCpe._rx < -27;
    if (wasCritical && !isCritical) this.globalCriticalGponCount--;
    if (!wasCritical && isCritical) this.globalCriticalGponCount++;

    if (updatedCpe.pendingTasks !== undefined) {
      const oldTasks = oldCpe.pendingTasks?.length || 0;
      const newTasks = enrichedCpe.pendingTasks?.length || 0;
      this.globalPendingTasksCount += (newTasks - oldTasks);
    }

    // Notificações visuais
    const newWanIp = enrichedCpe.wan?.ip || enrichedCpe.wanIp;
    const oldWanIp = oldCpe.wan?.ip || oldCpe.wanIp;
    if (newWanIp && oldWanIp && oldWanIp !== newWanIp) {
      this.toastService.info(`CPE ${enrichedCpe.serialNumber}: IP mudou de ${oldWanIp} para ${newWanIp}`);
    }

    if (enrichedCpe._pppoe && oldCpe._pppoe && oldCpe._pppoe !== enrichedCpe._pppoe && oldCpe._pppoe !== 'DHCP/Fixo') {
      this.toastService.info(`CPE ${enrichedCpe.serialNumber}: Usuário PPPoE alterado de ${oldCpe._pppoe} para ${enrichedCpe._pppoe}`);
    }

    this.allCpes[index] = enrichedCpe;
    this.checkAlerts(this.allCpes[index]);
  }

  private insertNewCpe(updatedCpe: Partial<CpeDevice>): void {
    const enrichedCpe = this.enrichCpeData(updatedCpe as CpeDevice);
    this.cpeIndexMap.set(enrichedCpe.serialNumber, this.allCpes.length); // índice = posição futura
    this.allCpes.push(enrichedCpe); // O(1) — não desloca nenhum elemento

    // Incrementa métricas globais para nova CPE na rede
    this.globalTotalCpes++;
    if (enrichedCpe.isOnline) this.globalOnlineCount++;
    if (enrichedCpe._rx !== undefined && enrichedCpe._rx < -27) this.globalCriticalGponCount++;
    this.globalPendingTasksCount += (enrichedCpe.pendingTasks?.length || 0);

    if (updatedCpe.serialNumber) {
      this.toastService.success(`CPE ${updatedCpe.serialNumber} está online.`);
    }
  }

  private removeCpe(serialNumber: string): void {
    const index = this.cpeIndexMap.get(serialNumber) ?? -1;
    if (index === -1) return;
    const oldCpe = this.allCpes[index];
    if (oldCpe.isOnline) this.globalOnlineCount--;
    if (oldCpe._rx !== undefined && oldCpe._rx < -27) this.globalCriticalGponCount--;
    this.globalTotalCpes--;
    this.allCpes.splice(index, 1);
    this.cpeIndexMap.delete(serialNumber);
    // Reatualiza índices dos elementos que foram deslocados para a esquerda
    for (let i = index; i < this.allCpes.length; i++) {
      this.cpeIndexMap.set(this.allCpes[i].serialNumber, i);
    }
    this.applyChangesIfAny(true);
  }

  private applyChangesIfAny(hasChanges: boolean): void {
    if (hasChanges) {
      this.globalOnlineCount = Math.max(0, this.globalOnlineCount);
      this.globalCriticalGponCount = Math.max(0, this.globalCriticalGponCount);
      this.globalPendingTasksCount = Math.max(0, this.globalPendingTasksCount);
      this.refilterSubject.next(); // debounced, não chama triggerFilter diretamente
      this.cdr.markForCheck();
    }
  }

  /**
   * Verifica condições críticas de uma CPE e dispara alertas via ToastService.
   * Evita spam: cada alerta é emitido no máximo uma vez por sessão.
   */
  private checkAlerts(cpe: DashboardCpe): void {
    // Alerta de sinal GPON crítico (< -27 dBm)
    const rx = cpe._rx;

    if (rx !== undefined && rx < -27 && !this.alertedGponCpes.has(cpe.serialNumber)) {
      this.alertedGponCpes.add(cpe.serialNumber);
      this.toastService.warning(
        `CPE ${cpe.serialNumber}: Sinal GPON crítico (${rx} dBm). Verifique a fibra.`,
        7000
      );
    }

    // Alerta de CPE offline (lastInform > 30 min sem contato)
    if (!cpe.isOnline && cpe.lastInform && !this.alertedOfflineCpes.has(cpe.serialNumber)) {
      const minutesSince = (Date.now() - new Date(cpe.lastInform).getTime()) / 60000;
      if (minutesSince > 30) {
        this.alertedOfflineCpes.add(cpe.serialNumber);
        this.toastService.error(
          `CPE ${cpe.serialNumber} offline há mais de ${Math.round(minutesSince)} minutos.`,
          8000
        );
      }
    }
  }

  wakeUpDevice(serialNumber: string): void {
    this.wakingUpCpes.add(serialNumber);
    this.cdr.markForCheck();
    this.cpeService.wakeUpCpe(serialNumber).subscribe({
      next: () => {
        this.toastService.success(`Connection Request enviado para ${serialNumber}!`);
        // Remove o spinner após 10s se a CPE não voltar online (timeout de segurança)
        setTimeout(() => {
          this.wakingUpCpes.delete(serialNumber);
          this.cdr.markForCheck();
        }, 10000);
      },
      error: () => {
        this.wakingUpCpes.delete(serialNumber);
        this.cdr.markForCheck();
        this.toastService.error(`Falha ao acordar a CPE ${serialNumber}.`);
      },
    });
  }

  /**
   * Reinicia uma CPE individual diretamente da tabela.
   * O backend enfileira a task via taskQueueService + cria AuditLog + snapshot "before".
   * Spinner permanece até a CPE voltar online via WebSocket ou timeout de 60s.
   */
  rebootDevice(serialNumber: string): void {
    if (!confirm(`Confirmar reinício da CPE ${serialNumber}?`)) return;
    this.rebootingCpes.add(serialNumber);
    this.cdr.markForCheck();
    this.cpeService.rebootCpe(serialNumber).subscribe({
      next: () => {
        this.toastService.success(`Comando de reinício enfileirado para ${serialNumber}.`);
        // Timeout de segurança: remove o spinner após 60s (reboot leva ~30-45s)
        setTimeout(() => {
          if (this.rebootingCpes.has(serialNumber)) {
            this.rebootingCpes.delete(serialNumber);
            this.cdr.markForCheck();
          }
        }, 60000);
      },
      error: () => {
        this.rebootingCpes.delete(serialNumber);
        this.cdr.markForCheck();
        this.toastService.error(`Falha ao reiniciar a CPE ${serialNumber}.`);
      },
    });
  }

  /**
   * Atualiza os cards superiores (Top Metrics).
   */
  calculateFallbackMetrics(): void {
    // Fallback executado apenas se a API backend falhar em enviar as métricas globais
    this.globalOnlineCount = this.allCpes.filter((c) => c.isOnline).length;

    this.globalCriticalGponCount = this.allCpes.filter((c) => {
      return c._rx !== undefined && c._rx < -27;
    }).length;

    this.globalPendingTasksCount = this.allCpes.reduce((acc, cpe) => {
      return acc + (cpe.pendingTasks ? cpe.pendingTasks.length : 0);
    }, 0);
  }

  /**
   * Carrega a visão geral de diagnósticos periódicos do endpoint /api/diagnostic-targets/overview.
   * Falha silenciosa — não quebra o dashboard se o endpoint falhar.
   */
  private loadDiagnosticOverview(): void {
    this.diagnosticTargetService.overview(7).pipe(
      catchError(() => of({ data: null, message: 'Falha ao carregar visão geral de diagnósticos.' })),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(({ data, message }) => {
      this.diagnosticOverview = data;
      this.diagEmptyMessage = data ? null : (message || 'Nenhum dado de diagnóstico disponível.');
      if (data) {
        this.diagChartLabels = data.dailySeriesAggregated.map(d => {
          const parts = d.day.split('-');
          return `${parts[2]}/${parts[1]}`;
        });
        this.diagChartDatasets[0].data = data.dailySeriesAggregated.map(d => d.success);
        this.diagChartDatasets[1].data = data.dailySeriesAggregated.map(d => d.error);
        this.diagChartDatasets = [...this.diagChartDatasets];
        // Registra o horário da última atualização para exibir no header
        this.diagLastUpdate = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      }
      this.cdr.markForCheck();
    });
  }

  /**
   * Carrega o Widget de Saúde da Frota do endpoint /api/health-summary.
   * Métricas agregadas com cache Redis TTL 30s no backend.
   */
  loadHealthSummary(): void {
    this.cpeService.getHealthSummary().subscribe({
      next: (summary) => {
        this.healthSummary = summary;
        // Sincroniza contador globalOnlineCount com valor real do backend
        this.globalOnlineCount = summary.online;
        this.cdr.markForCheck();
      },
      error: () => {
        // Silencioso - não quebra o dashboard se o widget falhar
      }
    });
  }

  /**
   * Alterna ordenação de uma coluna. Ciclo: null → asc → desc → null.
   * Se clicar em coluna diferente, inicia nova ordenação asc.
   * @param column Nome da coluna (deve estar em SORTABLE_COLUMNS)
   */
  toggleSort(column: string): void {
    if (!this.SORTABLE_COLUMNS.includes(column)) return;
    if (this.sortColumn === column) {
      // Mesma coluna: cicla direção
      if (this.sortDirection === null) this.sortDirection = 'asc';
      else if (this.sortDirection === 'asc') this.sortDirection = 'desc';
      else { this.sortColumn = null; this.sortDirection = null; }
    } else {
      // Coluna nova: inicia asc
      this.sortColumn = column;
      this.sortDirection = 'asc';
    }
    this.applySort();
  }

  /** Compatibilidade: mantém toggleHealthScoreSort delegando para o novo sistema */
  toggleHealthScoreSort(): void {
    this.toggleSort('healthScore');
  }

  /**
   * Aplica ordenação na lista exibida (this.cpes).
   * Se sortColumn é null, reaplica filtro original (ordem do backend).
   */
  private applySort(): void {
    if (this.sortColumn === null || this.sortDirection === null) {
      this.triggerFilter(); // Reaplica o filtro original (ordem do backend) sem sort
      return;
    }
    const direction = this.sortDirection === 'asc' ? 1 : -1;
    const col = this.sortColumn;

    this.cpes = [...this.cpes].sort((a, b) => {
      let valA: any;
      let valB: any;

      switch (col) {
        case 'status':
          valA = a.isOnline ? 1 : 0;
          valB = b.isOnline ? 1 : 0;
          break;
        case 'serialNumber':
          valA = a.serialNumber?.toLowerCase() ?? '';
          valB = b.serialNumber?.toLowerCase() ?? '';
          return valA.localeCompare(valB) * direction;
        case 'model':
          valA = (a.productClass || a.manufacturer || '').toLowerCase();
          valB = (b.productClass || b.manufacturer || '').toLowerCase();
          return valA.localeCompare(valB) * direction;
        case 'wanIp':
          valA = a.wanIp || a.wan?.ip || '';
          valB = b.wanIp || b.wan?.ip || '';
          // IPs ordenados por string é aceitável para ordenação visual
          return valA.localeCompare(valB, undefined, { numeric: true }) * direction;
        case 'pppoe':
          valA = a._pppoe || '';
          valB = b._pppoe || '';
          return valA.localeCompare(valB) * direction;
        case 'rx':
          // Sem rx vai para o final independente da direção
          valA = a._rx ?? (direction === 1 ? Infinity : -Infinity);
          valB = b._rx ?? (direction === 1 ? Infinity : -Infinity);
          break;
        case 'healthScore':
          // Sem score vai para o final independente da direção
          valA = a.healthScore ?? (direction === 1 ? Infinity : -Infinity);
          valB = b.healthScore ?? (direction === 1 ? Infinity : -Infinity);
          break;
        case 'tasks':
          valA = a.pendingTasks?.length ?? 0;
          valB = b.pendingTasks?.length ?? 0;
          break;
        default:
          return 0;
      }
      return (valA - valB) * direction;
    });
    this.cdr.markForCheck();
  }

  /** Compatibilidade: mantém applyHealthScoreSort delegando para applySort */
  private applyHealthScoreSort(): void {
    this.applySort();
  }

  /** Verifica se uma coluna está ordenada e retorna a direção (para ícone no template) */
  getSortDirection(column: string): 'asc' | 'desc' | null {
    return this.sortColumn === column ? this.sortDirection : null;
  }

  // Função de Performance: Pré-processa os dados pesados na entrada
  private enrichCpeData(cpe: CpeDevice): DashboardCpe {
    let cleanIp = cpe.wan?.ip || cpe.wanIp;
    if (cleanIp && typeof cleanIp === 'string' && cleanIp.startsWith('::ffff:')) {
      cleanIp = cleanIp.replace('::ffff:', '');
    }

    // Busca valores cacheados na raiz para evitar varredura caso o Backend já tenha normalizado
    let pppoe = (cpe as any)['pppoeUsername'] || (cpe as any)['_pppoe'] || cpe.wan?.pppoeUsername;
    // opticalRx vem via WebSocket no campo raiz (VALUE CHANGE) ou via cpe.parameters (carga inicial)
    let rx: number | undefined = (cpe as any).opticalRx != null ? Number((cpe as any).opticalRx) : undefined;

    // Prioridade: campo top-level wifi2gBandwidth (mais rápido) → fallback wifi2g.bandwidth
    const raw2g = (cpe as any).wifi2gBandwidth ?? cpe.wifi2g?.bandwidth ?? null;
    const raw5g = (cpe as any).wifi5gBandwidth ?? cpe.wifi5g?.bandwidth ?? null;

    // Formata para exibição adicionando "MHz" se não tiver
    const formatBw = (val: string | null): string | null => {
      if (!val) return null;
      const strVal = String(val);
      return strVal.endsWith('MHz') ? strVal : `${strVal}MHz`;
    };

    // Validação estrita de array para evitar TypeError no loop e consumo desnecessário de memória
    if ((pppoe === undefined || rx === undefined) && Array.isArray(cpe.parameters) && cpe.parameters.length > 0) {
      for (const p of cpe.parameters) {
        if (!p || !p.name) continue;
        const key = String(p.name).toLowerCase();

        // Extração de PPPoE Username
        if (pppoe === undefined && key.endsWith('username') && (key.includes('pppconnection') || key.includes('ppp.interface'))) {
          pppoe = p.value;
          if (rx !== undefined) break; // Early break se ambos encontrados
        }

        // Extração de Sinal Óptico
        if (rx === undefined && (key.endsWith('opticalsignallevel') || key.endsWith('rxpower'))) {
          const rxVal = parseFloat(p.value);
          if (!isNaN(rxVal)) {
            rx = rxVal < -100 ? rxVal / 10 : rxVal;
          }
          if (pppoe !== undefined) break; // Early break se ambos encontrados
        }
      }
    }

    // Fallback 3: parametersCache — estrutura [{name, value, lastSeen}], IS retornada pela query de lista
    if (rx === undefined && Array.isArray((cpe as any).parametersCache) && (cpe as any).parametersCache.length > 0) {
      for (const param of (cpe as any).parametersCache) {
        if (!param || !param.name) continue;
        const lk = String(param.name).toLowerCase();
        if (lk.endsWith('opticalsignallevel') || lk.endsWith('rxpower')) {
          const rxVal = parseFloat(String(param.value));
          if (!isNaN(rxVal) && rxVal !== 0) {
            rx = rxVal < -100 ? rxVal / 10 : rxVal;
          }
          break;
        }
      }
    }

    return {
      ...cpe,
      wanIp: cleanIp, // mantido para compatibilidade com código legado que ainda usa cpe.wanIp diretamente
      _pppoe: pppoe || 'DHCP/Fixo',
      _rx: rx,
      _bw2g: formatBw(raw2g),
      _bw5g: formatBw(raw5g),
      // FIX EP 27.16: normaliza productClass de deviceInfo.productClass (schema EP24)
      productClass: (cpe as any).deviceInfo?.productClass || cpe.productClass || null,
      // FIX: normaliza manufacturer e softwareVersion de deviceInfo (schema EP24)
      // Sem isso, o worker filtra por cpe.manufacturer que é undefined — tabela fica vazia
      manufacturer: (cpe as any).deviceInfo?.manufacturer || cpe.manufacturer || null,
      softwareVersion: (cpe as any).deviceInfo?.softwareVersion || cpe.softwareVersion || null,
    };
  }

  // --- NOVAS FUNCIONALIDADES: Helpers Visuais e Ações em Massa ---

  getTimeAgo(dateString?: string): string {
    if (!dateString) return 'Desconhecido';
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) return 'Agora mesmo';
    if (diffMins < 60) return `Há ${diffMins} min`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `Há ${diffHours} h`;
    const diffDays = Math.floor(diffHours / 24);
    return `Há ${diffDays} dia(s)`;
  }

  toggleSelection(serialNumber: string): void {
    if (this.selectedCpes.has(serialNumber)) {
      this.selectedCpes.delete(serialNumber);
    } else {
      this.selectedCpes.add(serialNumber);
    }
  }

  toggleSelectAll(event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    if (checked) {
      this.cpes.forEach(c => this.selectedCpes.add(c.serialNumber));
    } else {
      this.selectedCpes.clear();
    }
  }

  get isAllSelected(): boolean {
    return this.cpes.length > 0 && this.selectedCpes.size === this.cpes.length;
  }

  get isIndeterminate(): boolean {
    return this.selectedCpes.size > 0 && this.selectedCpes.size < this.cpes.length;
  }


  // Adicione esta função
  goToDetails(serialNumber: string): void {
    this.router.navigate(['/dashboard/cpe', serialNumber]);
  }

  exportSelectedToCsv(): void {
    if (this.selectedCpes.size === 0) return;
    const selectedData = this.cpes.filter(c => this.selectedCpes.has(c.serialNumber));
    this.generateCsv(selectedData, 'selecionadas');
  }

  /**
   * F9: Exporta toda a frota filtrada (this.cpes) em vez de apenas selecionadas.
   * Usa a lista já filtrada pelo Web Worker — inclui todos os CPEs que match os filtros ativos.
   */
  exportFilteredToCsv(): void {
    if (this.cpes.length === 0) return;
    this.generateCsv(this.cpes, 'filtradas');
  }

  /**
   * Lógica compartilhada de geração de CSV — reutilizada por exportSelectedToCsv e exportFilteredToCsv.
   * Previne CSV Injection (prefixa campos que começam com =, +, -, @).
   */
  private generateCsv(data: DashboardCpe[], suffix: string): void {
    const headers = ['Status', 'Serial Number', 'Modelo', 'IP WAN', 'PPPoE', 'Sinal Rx (dBm)', 'Ultima Conexao'];

    const sanitizeCsvField = (value: string | undefined): string => {
      if (!value) return 'N/D';
      const str = String(value);
      if (/^[=+\-@]/.test(str)) return `'${str}`;
      return str;
    };

    const rows = data.map(c => [
      c.isOnline ? 'Online' : 'Offline',
      sanitizeCsvField(c.serialNumber),
      sanitizeCsvField(c.deviceInfo?.productClass || c.productClass || c.deviceInfo?.manufacturer || c.manufacturer),
      sanitizeCsvField(c.wan?.ip || c.wanIp),
      sanitizeCsvField(c._pppoe),
      c._rx !== undefined ? c._rx : 'N/D',
      sanitizeCsvField(c.lastInform)
    ]);

    const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `acs_cpes_${suffix}_${new Date().getTime()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  bulkRebootSelected(): void {
    if (this.selectedCpes.size === 0) return;
    this.isBulkRebootConfirmOpen = true;
    this.bulkRebootConfirmCount = 0;
  }

  confirmBulkReboot(): void {
    if (this.bulkRebootConfirmCount !== this.selectedCpes.size) {
      this.toastService.error('Número incorreto. Digite o número exato de equipamentos.');
      return;
    }
    this.isBulkRebootConfirmOpen = false;
    this.executeBulkReboot();
  }

  cancelBulkReboot(): void {
    this.isBulkRebootConfirmOpen = false;
    this.bulkRebootConfirmCount = 0;
  }

  private executeBulkReboot(): void {
    const BATCH_SIZE = 50;
    const BATCH_DELAY_MS = 500;
    const allSelected = Array.from(this.selectedCpes);

    // BC-4: Filtra CPEs offline — reboot exige comunicação CWMP ativa.
    // CPEs offline seriam rejeitadas pelo backend/Circuit Breaker, gerando
    // falhas desnecessárias e poluindo o AuditLog com result: 'failed'.
    const serialNumbers = allSelected.filter(sn => {
      const cpe = this.allCpes.find(c => c.serialNumber === sn);
      return cpe?.isOnline === true;
    });
    const offlineCount = allSelected.length - serialNumbers.length;

    if (serialNumbers.length === 0) {
      this.toastService.warning('Todas as CPEs selecionadas estão offline. Nenhum reinício enviado.');
      this.isBulkRebootConfirmOpen = false;
      this.cdr.markForCheck();
      return;
    }

    if (offlineCount > 0) {
      this.toastService.warning(`${offlineCount} CPE(s) offline foram ignoradas — reinício exige CPE online.`);
    }

    let success = 0;
    let failed = 0;

    interface BulkRebootResult {
      error?: boolean;
      serial?: string;
      message?: string;
    }

    from(serialNumbers).pipe(
      bufferCount(BATCH_SIZE),
      concatMap((batch, index) => {
        // Cria o timer para delay apenas a partir do segundo lote
        const delay$ = index === 0 ? of(null) : timer(BATCH_DELAY_MS);
        
        const requests$ = forkJoin(
          batch.map(serial => 
            this.cpeService.rebootCpe(serial, true).pipe(
              // Envelopa o erro para o lote não quebrar a execução global
              catchError((err): Observable<BulkRebootResult> => 
                of({ error: true, serial, message: err?.message || 'Erro desconhecido' })
              )
            )
          )
        );

        return zip(delay$, requests$).pipe(map(([_, results]) => results as BulkRebootResult[]));
      }),
      // Segurança Absoluta: cancela tudo se o componente for destruído pelo Angular
      takeUntilDestroyed(this.destroyRef)
    ).subscribe({
      next: (batchResults: BulkRebootResult[]) => {
        if (Array.isArray(batchResults)) {
          batchResults.forEach(r => {
            if (r && r.error) {
              failed++;
            } else {
              success++;
            }
          });
        }
      },
      complete: () => {
        this.finalizeBulkReboot(success, failed);
      },
      error: () => {
        this.toastService.error('Falha crítica no processamento do lote de reinício.');
      }
    });
  }

  private finalizeBulkReboot(success: number, fail: number): void {
    this.toastService.success(`Ação concluída: ${success} reiniciadas com sucesso, ${fail} falhas.`);
    this.selectedCpes.clear();
    this.cdr.markForCheck();
  }

  deleteCpe(cpe: DashboardCpe): void {
    if (!confirm(`Atenção: Tem certeza que deseja excluir a CPE ${cpe.serialNumber} do sistema? Esta ação apagará todo o histórico do equipamento e não pode ser desfeita.`)) return;

    this.cpeService.deleteCpe(cpe.serialNumber).subscribe({
      next: () => {
        this.toastService.success(`CPE ${cpe.serialNumber} excluída com sucesso.`);
        // A remoção da tabela é processada automaticamente pelo evento WebSocket 'cpe_deleted' acima
      },
      error: (err) => this.toastService.error(err?.error?.error || `Falha ao excluir a CPE ${cpe.serialNumber}.`)
    });
  }

  // 2. Funções de controle do Modal (Adicione estas duas funções)
  openConfigModal(cpe: DashboardCpe): void {
    // Navega para a tab Wi-Fi do CpeDetailsComponent em vez de abrir modal inline
    this.router.navigate(['/dashboard/cpe', cpe.serialNumber], { queryParams: { tab: 'wifi' } });
  }

  closeConfigModal(): void {
    // Mantido para compatibilidade — navegação não usa mais estado de modal
    this.isConfigModalOpen = false;
    this.selectedCpeForConfig = null;
  }

  goToDiagnostics(serialNumber: string): void {
    // Navega para a tab de diagnóstico do CpeDetailsComponent via query param
    this.router.navigate(['/dashboard/cpe', serialNumber], { queryParams: { tab: 'diagnostics' } });
  }

  // --- INTEGRAÇÃO COM INTELIGÊNCIA ARTIFICIAL (MOTOR DE PREDIÇÃO) ---

  runAiAnalysis(cpe: DashboardCpe): void {
    this.selectedCpeForAi = cpe;
    this.isAnalyzingAi = true;
    this.isAiModalOpen = true;
    this.aiReport = null;

    // Aciona a rota /api/cpe/:serialNumber/predict-failure do backend
    this.cpeService.predictFailure(cpe.serialNumber).subscribe({
      next: (res: CpePrediction) => {
        this.aiReport = res;
        this.isAnalyzingAi = false;
        this.cdr.markForCheck();
      },
      error: (err: any) => {
        this.toastService.error('Falha ao conectar com o Motor de Inteligência Artificial.');
        this.isAnalyzingAi = false;
        this.isAiModalOpen = false;
        this.cdr.markForCheck();
      }
    });
  }

  closeAiModal(): void {
    this.isAiModalOpen = false;
    this.selectedCpeForAi = null;
    this.aiReport = null;
  }

  /** Otimização extrema de renderização para o Virtual Scroll e WebSockets */
  trackByCpe(index: number, cpe: DashboardCpe): string {
    return cpe.serialNumber;
  }
}
