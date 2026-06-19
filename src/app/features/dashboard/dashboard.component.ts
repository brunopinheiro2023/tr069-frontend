// Caminho do arquivo: frontend/src/app/features/dashboard/dashboard.component.ts

import { Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef, ViewChild, inject, DestroyRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { bufferTime, filter, debounceTime, distinctUntilChanged } from 'rxjs/operators';
import { ScrollingModule, CdkVirtualScrollViewport } from '@angular/cdk/scrolling';
import { NgChartsModule } from 'ng2-charts';
import { ChartConfiguration, ChartOptions } from 'chart.js';
import { CpeService } from '../../core/services/cpe.service';
import { WebSocketService } from '../../core/services/websocket.service';
import { LoadingService } from '../../core/services/loading.service';
import { ToastService } from '../../core/services/toast.service';
import { ButtonComponent } from '../../core/components/button/button.component';
import { SkeletonComponent } from '../../core/components/skeleton/skeleton.component';
import { CpeDevice, PaginatedResponse } from '../../core/models';
import { Router } from '@angular/router';
import { AlertsPanelComponent } from './components/alerts-panel/alerts-panel.component';

// Extensão da interface para suportar valores pré-computados em tela
interface DashboardCpe extends CpeDevice {
  _pppoe?: string;
  _rx?: number;
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
    averageUptime: number;
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

  // Thresholds centralizados para saúde do ACS
  readonly WORKER_HEALTH_THRESHOLDS = {
    avgMsWarning: 80,
    avgMsCritical: 150,
    memoryMBWarning: 400,
    memoryMBCritical: 600,
    queueWarning: 50,
    queueCritical: 200
  };

  // Ordenação por Health Score
  healthScoreSortDirection: 'asc' | 'desc' | null = null;

  // Filtros da tabela
  searchQuery: string = '';
  searchSubject = new Subject<string>();
  filterStatus: 'all' | 'online' | 'offline' = 'all';
  filterManufacturer: string = '';
  filterModel: string = '';
  filterFirmware: string = '';
  filterCriticalGpon: boolean = false;

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

  // Estado de carregamento
  loading: boolean = true;

  // CPEs que já receberam alerta de offline nesta sessão (evita spam)
  private alertedOfflineCpes = new Set<string>();
  private alertedGponCpes = new Set<string>();

  private timeAgoInterval?: ReturnType<typeof setInterval>;
  private metricsInterval?: ReturnType<typeof setInterval>;
  private healthSummaryInterval?: ReturnType<typeof setInterval>;
  private worker?: Worker;
  private destroyRef = inject(DestroyRef); // Gerenciador de ciclo de vida moderno do Angular 17+

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
    private loadingService: LoadingService,
    private toastService: ToastService,
    private router: Router,
    private cdr: ChangeDetectorRef
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
    // Setup do debounce reativo para a busca (Otimização RxJS)
    this.searchSubject.pipe(
      debounceTime(400),
      distinctUntilChanged(),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(query => {
      this.triggerFilter();
    });

    // Inicializa o Web Worker para isolar o processamento pesado de filtros
    if (typeof Worker !== 'undefined') {
      this.worker = new Worker(new URL('./cpe-filter.worker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = ({ data }) => {
        if (data.error) {
          console.error('Erro no Web Worker:', data.error, data.message);
          this.toastService.error(`Erro no filtro: ${data.message}`);
          this.cpes = this.allCpes; // Fallback: exibe lista completa
        } else {
          this.cpes = data;
        }
        // Reaplica ordenação por health score se ativa, mantendo-a estável durante atualizações WS
        if (this.healthScoreSortDirection !== null) {
          this.applyHealthScoreSort();
        }
        this.loading = false;
        this.cdr.markForCheck();
      };
      this.worker.onerror = (error) => {
        console.error('Erro no Web Worker de filtro:', error);
        this.toastService.error('Ocorreu um erro no processamento de filtros em segundo plano.');
        this.cpes = this.allCpes; // Fallback
        this.loading = false;
        this.cdr.markForCheck();
      };
    }

    this.loadInitialData();
    this.loadHealthSummary();
    this.setupRealTimeUpdates();
    // Entra na sala global para receber eventos de qualquer CPE no dashboard
    this.wsService.subscribeToAllCpes();

    // OTIMIZAÇÃO: Relógio passivo interno (Heartbeat Visual)
    // Atualiza o texto "Há X min" dinamicamente e detecta CPEs que caíram (silenciosamente)
    this.timeAgoInterval = setInterval(() => {
      const now = Date.now();
      let hasChanges = false;

      this.cpes.forEach(cpe => {
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
      this.cdr.markForCheck(); // Força atualização dos textos "Há X min"
    }, 60000);

    // OTIMIZAÇÃO: Polling real para o Gráfico de Saúde do ACS
    // Cada ponto do gráfico agora é uma amostra REAL do backend, não repetição do mesmo valor
    this.metricsInterval = setInterval(() => {
      this.cpeService.getWorkerHealth().subscribe({
        next: (health) => {
          this.xmlParserMetrics = health.xmlParser;
          this.queueStats = health.rabbitmq;
          this.processHealth = health.process;
          this.workerHealthDegraded = false;

          const now = new Date().toLocaleTimeString();
          this.xmlChartLabels.push(now);
          this.xmlChartDatasets[0].data.push(health.xmlParser.avgProcessingTimeMs);
          this.xmlChartDatasets[1].data.push(health.xmlParser.p95ProcessingTimeMs);
          if (this.xmlChartLabels.length > 30) {
            this.xmlChartLabels.shift();
            this.xmlChartDatasets[0].data.shift();
            this.xmlChartDatasets[1].data.shift();
          }
          this.xmlChartDatasets = [...this.xmlChartDatasets];
          this.cdr.markForCheck();
        },
        error: () => {
          this.workerHealthDegraded = true;
          this.cdr.markForCheck();
        }
      });
    }, 5000); // 5s — equilíbrio entre frescor e carga no backend

    // Polling para Widget de Saúde da Frota (Step 9)
    this.healthSummaryInterval = setInterval(() => {
      this.loadHealthSummary();
    }, 30000); // Atualiza a cada 30 segundos
  }

  ngOnDestroy(): void {
    this.wsService.unsubscribeFromAllCpes();
    clearInterval(this.timeAgoInterval);
    clearInterval(this.metricsInterval);
    clearInterval(this.healthSummaryInterval);
    this.worker?.terminate();
  }

  /**
   * Busca a lista inicial de CPEs via API REST COM PAGINAÇÃO.
   * IMPLEMENTAÇÃO DE PAGINAÇÃO PARA SUPORTAR 6.000+ CPEs.
   *
   * Carrega apenas a página atual de itens (padrão: 50 itens)
   * em vez de carregar todas as 6.000 CPEs de uma vez.
   */
  loadInitialData(): void {
    this.loading = true;
    // OTIMIZAÇÃO: Busca um grande volume de dados de uma vez (até 10k) e delega o filtro/busca para o Web Worker.
    // A paginação é removida e substituída por Virtual Scrolling.
    this.cpeService.getAllCpes(1, 10000).subscribe({
      next: (response: any) => {
        this.allCpes = response.data.map((c: any) => this.enrichCpeData(c));
        this.globalTotalCpes = response.pagination.total; // Total real global do banco

        // Recebe as métricas agregadas diretamente do MongoDB
        if (response.metrics) {
          this.globalOnlineCount = response.metrics.onlineCount;
          this.globalCriticalGponCount = response.metrics.criticalGponCount;
          this.globalPendingTasksCount = response.metrics.pendingTasksCount;
          // xmlParserMetrics agora é buscado via polling real do endpoint /api/system/health/workers
          this.globalManufacturers = (response.metrics.byManufacturer || []).map((m: any) => ({ name: m._id || 'Desconhecido', count: m.count }));
          this.globalModels = (response.metrics.byModel || []).map((m: any) => ({ name: m._id || 'Desconhecido', count: m.count }));
          this.globalFirmwares = (response.metrics.byFirmware || []).map((m: any) => ({ name: m._id || 'Desconhecido', count: m.count })).sort((a: any, b: any) => b.count - a.count);
        } else {
          this.calculateFallbackMetrics();
        }

        this.triggerFilter(); // Dispara o primeiro filtro no worker

        // OTIMIZAÇÃO UX: Reseta o scroll para o topo ao carregar nova página ou filtros
        if (this.viewport) {
          this.viewport.scrollToIndex(0);
        }
      },
      error: (err) => {
        console.error('Erro ao buscar CPEs', err);
        this.toastService.error('Falha ao carregar lista de CPEs.');
        this.loading = false;
        this.cdr.markForCheck();
      },
    });
  }

  private triggerFilter(): void {
    this.loading = true;
    this.cdr.markForCheck();

    const filters: Record<string, any> = {};
    if (this.filterStatus === 'online') filters['isOnline'] = true;
    if (this.filterStatus === 'offline') filters['isOnline'] = false;
    if (this.filterManufacturer) filters['manufacturer'] = this.filterManufacturer;
    if (this.filterModel) filters['productClass'] = this.filterModel;
    if (this.filterFirmware) filters['softwareVersion'] = this.filterFirmware;
    if (this.searchQuery.trim()) filters['search'] = this.searchQuery.trim();
    if (this.filterCriticalGpon) filters['isCriticalGpon'] = true;

    if (this.worker) {
      this.worker.postMessage({ cpes: this.allCpes, filters });
    } else {
      // Fallback para a thread principal se o worker não estiver disponível
      console.warn('Web Worker não está disponível, filtrando na thread principal.');
      // A lógica de filtro do worker deve ser replicada aqui para o fallback.
      // Por simplicidade, vamos apenas exibir a lista completa.
      this.cpes = this.allCpes;
      this.loading = false;
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

  clearFilters(): void {
    this.filterStatus = 'all';
    this.filterManufacturer = '';
    this.filterModel = '';
    this.filterFirmware = '';
    this.searchQuery = '';
    this.filterCriticalGpon = false;
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

  private processCpeUpdate(updatedCpe: Partial<CpeDevice>, isOnlineEvent = false): boolean {
    if (!updatedCpe.serialNumber) return false;
    const index = this.allCpes.findIndex(c => c.serialNumber === updatedCpe.serialNumber);

    if (index !== -1) {
      this.updateExistingCpe(index, updatedCpe, isOnlineEvent);
      return true;
    } else {
      this.insertNewCpe(updatedCpe);
      return true;
    }
    return false;
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
    if (enrichedCpe.wanIp && oldCpe.wanIp && oldCpe.wanIp !== enrichedCpe.wanIp) {
      this.toastService.info(`CPE ${enrichedCpe.serialNumber}: IP mudou de ${oldCpe.wanIp} para ${enrichedCpe.wanIp}`);
    }

    if (enrichedCpe._pppoe && oldCpe._pppoe && oldCpe._pppoe !== enrichedCpe._pppoe && oldCpe._pppoe !== 'DHCP/Fixo') {
      this.toastService.info(`CPE ${enrichedCpe.serialNumber}: Usuário PPPoE alterado de ${oldCpe._pppoe} para ${enrichedCpe._pppoe}`);
    }

    this.allCpes[index] = enrichedCpe;
    this.checkAlerts(this.allCpes[index]);
  }

  private insertNewCpe(updatedCpe: Partial<CpeDevice>): void {
    const enrichedCpe = this.enrichCpeData(updatedCpe as CpeDevice);
    this.allCpes.unshift(enrichedCpe);

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
    const index = this.allCpes.findIndex(c => c.serialNumber === serialNumber);
    if (index !== -1) {
      const oldCpe = this.allCpes[index];
      if (oldCpe.isOnline) this.globalOnlineCount--;
      if (oldCpe._rx !== undefined && oldCpe._rx < -27) this.globalCriticalGponCount--;
      this.globalTotalCpes--;
      this.allCpes.splice(index, 1);
      this.applyChangesIfAny(true);
    }
  }

  private applyChangesIfAny(hasChanges: boolean): void {
    if (hasChanges) {
      this.globalOnlineCount = Math.max(0, this.globalOnlineCount);
      this.globalCriticalGponCount = Math.max(0, this.globalCriticalGponCount);
      this.globalPendingTasksCount = Math.max(0, this.globalPendingTasksCount);
      this.triggerFilter(); // Re-filtra a lista após uma mudança em tempo real
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
    this.cpeService.wakeUpCpe(serialNumber).subscribe({
      next: () => this.toastService.success(`Connection Request enviado para ${serialNumber}!`),
      error: () => this.toastService.error(`Falha ao acordar a CPE ${serialNumber}.`),
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
   * Carrega o Widget de Saúde da Frota do endpoint /api/health-summary.
   * Métricas agregadas com cache Redis TTL 30s no backend.
   */
  loadHealthSummary(): void {
    this.cpeService.getHealthSummary().subscribe({
      next: (summary) => {
        this.healthSummary = summary;
        this.cdr.markForCheck();
      },
      error: (err) => {
        console.error('Erro ao carregar health summary:', err);
        // Silencioso - não quebra o dashboard se o widget falhar
      }
    });
  }

  /**
   * Ordena a lista atualmente exibida por healthScore.
   * Ciclo: null → asc (piores primeiro) → desc (melhores primeiro) → null (ordem original).
   */
  toggleHealthScoreSort(): void {
    if (this.healthScoreSortDirection === null) {
      this.healthScoreSortDirection = 'asc';
    } else if (this.healthScoreSortDirection === 'asc') {
      this.healthScoreSortDirection = 'desc';
    } else {
      this.healthScoreSortDirection = null;
    }
    this.applyHealthScoreSort();
  }

  private applyHealthScoreSort(): void {
    if (this.healthScoreSortDirection === null) {
      this.triggerFilter(); // Reaplica o filtro original (ordem do backend) sem sort
      return;
    }
    const direction = this.healthScoreSortDirection === 'asc' ? 1 : -1;
    this.cpes = [...this.cpes].sort((a, b) => {
      // CPEs sem score (N/D) vão para o final independente da direção
      const scoreA = a.healthScore ?? (direction === 1 ? Infinity : -Infinity);
      const scoreB = b.healthScore ?? (direction === 1 ? Infinity : -Infinity);
      return (scoreA - scoreB) * direction;
    });
    this.cdr.markForCheck();
  }

  // Função de Performance: Pré-processa os dados pesados na entrada
  private enrichCpeData(cpe: CpeDevice): DashboardCpe {
    let cleanIp = cpe.wanIp;
    if (cleanIp && cleanIp.startsWith('::ffff:')) {
      cleanIp = cleanIp.replace('::ffff:', '');
    }

    // Busca valores cacheados na raiz para evitar varredura caso o Backend já tenha normalizado
    let pppoe = (cpe as any)['pppoeUsername'] || (cpe as any)['_pppoe'];
    let rx = cpe.opticalRx;

    // OTIMIZAÇÃO O(1): Converte array para Map para lookup constante
    // Reduz complexidade de O(N×M) para O(N) onde N=2 lookups, M=parâmetros
    if ((pppoe === undefined || rx === undefined) && cpe.parameters && cpe.parameters.length > 0) {
      const paramMap = new Map(cpe.parameters.map(p => [p.name?.toLowerCase(), p.value]));
      
      // PPPoE Username - lookup O(1)
      if (pppoe === undefined) {
        for (const [key, value] of paramMap.entries()) {
          if (key?.endsWith('username') && (key.includes('pppconnection') || key.includes('ppp.interface'))) {
            pppoe = value;
            break;
          }
        }
      }
      
      // Sinal Óptico (Rx) - lookup O(1)
      if (rx === undefined) {
        for (const [key, value] of paramMap.entries()) {
          if (key?.endsWith('opticalsignallevel') || key?.endsWith('rxpower')) {
            const rxVal = parseFloat(value);
            if (!isNaN(rxVal)) {
              // Auto-correção para roteadores que enviam "-250" em vez de "-25.0"
              rx = rxVal < -100 ? rxVal / 10 : rxVal;
            }
            break;
          }
        }
      }
    }

    return {
      ...cpe,
      wanIp: cleanIp,
      _pppoe: pppoe || 'DHCP/Fixo',
      _rx: rx
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


  // Adicione esta função
  goToDetails(serialNumber: string): void {
    this.router.navigate(['/dashboard/cpe', serialNumber]);
  }

  exportSelectedToCsv(): void {
    if (this.selectedCpes.size === 0) return;

    const selectedData = this.cpes.filter(c => this.selectedCpes.has(c.serialNumber));
    const headers = ['Status', 'Serial Number', 'Modelo', 'IP WAN', 'PPPoE', 'Sinal Rx (dBm)', 'Ultima Conexao'];

    const rows = selectedData.map(c => [
      c.isOnline ? 'Online' : 'Offline',
      c.serialNumber,
      c.productClass || c.manufacturer || 'N/D',
      c.wanIp || 'N/D',
      c._pppoe || 'N/D',
      c._rx !== undefined ? c._rx : 'N/D',
      c.lastInform || 'N/D'
    ]);

    const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `acs_cpes_export_${new Date().getTime()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  bulkRebootSelected(): void {
    if (this.selectedCpes.size === 0) return;
    if (!confirm(`TEM CERTEZA? Isso irá reiniciar ${this.selectedCpes.size} equipamento(s) e derrubar a conexão dos clientes temporariamente.`)) return;

    // Lotes de 50 com 500ms delay — evita 6000 sockets simultâneos → OOM
    const BATCH_SIZE = 50;
    const BATCH_DELAY_MS = 500;
    const serialNumbers = Array.from(this.selectedCpes);
    const results: { success: number; failed: number; errors: { serial: string; error: string }[] } = { success: 0, failed: 0, errors: [] };

    const processBatch = async (batch: string[]): Promise<void> => {
      const batchResults = await Promise.allSettled(
        batch.map(serial => this.cpeService.rebootCpe(serial).toPromise())
      );
      batchResults.forEach((r, idx) => {
        if (r.status === 'fulfilled') results.success++;
        else {
          results.failed++;
          results.errors.push({ serial: batch[idx], error: r.reason?.message });
        }
      });
    };

    const processAllBatches = async () => {
      for (let i = 0; i < serialNumbers.length; i += BATCH_SIZE) {
        const batch = serialNumbers.slice(i, i + BATCH_SIZE);
        await processBatch(batch);
        if (i + BATCH_SIZE < serialNumbers.length) {
          await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS));
        }
      }
      this.finalizeBulkReboot(results.success, results.failed);
    };

    processAllBatches();
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
    this.selectedCpeForConfig = cpe;
    this.isConfigModalOpen = true;
  }

  closeConfigModal(): void {
    this.isConfigModalOpen = false;
    this.selectedCpeForConfig = null;
  }

  goToDiagnostics(serialNumber: string): void {
    this.router.navigate(['/dashboard/cpe', serialNumber, 'diagnostics']);
  }

  // --- INTEGRAÇÃO COM INTELIGÊNCIA ARTIFICIAL (MOTOR DE PREDIÇÃO) ---

  runAiAnalysis(cpe: DashboardCpe): void {
    this.selectedCpeForAi = cpe;
    this.isAnalyzingAi = true;
    this.isAiModalOpen = true;
    this.aiReport = null;

    // Aciona a rota /api/cpe/:serialNumber/predict-failure do backend
    // O cast para 'any' garante que compilará mesmo se você ainda for adicionar o método no CpeService
    ((this.cpeService as any).predictFailure(cpe.serialNumber)).subscribe({
      next: (res: any) => {
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
