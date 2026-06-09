import { Component, Input, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subscription } from 'rxjs';
import { ChartConfiguration, ChartDataset } from 'chart.js';
import { NgChartsModule } from 'ng2-charts';
import { CpeDevice, TelemetryData, TelemetryMetric } from '../../../../../../core/models';
import { CpeService } from '../../../../../../core/services/cpe.service';
import { WebSocketService } from '../../../../../../core/services/websocket.service';
import { ToastService } from '../../../../../../core/services/toast.service';

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
  imports: [CommonModule, NgChartsModule],
  templateUrl: './cpe-info-tab.component.html',
  styleUrls: ['./cpe-info-tab.component.scss']
})
export class CpeInfoTabComponent implements OnInit, OnDestroy {
  /** Dados da CPE vindo do componente pai. */
  @Input() cpe: CpeDevice | null = null;
  /** Número de série para requisições de telemetria. */
  @Input() serialNumber: string = '';

  // ── Telemetria em tempo real ─────────────────────────────────────────────
  telemetryData: TelemetryData | null = null;
  lastUpdated: Date | null = null;
  telemetryLoading = false;
  telemetryError: string | null = null;

  // ── Histórico para gráficos ──────────────────────────────────────────────
  rawHistory: any[] = [];
  historyLoading = false;

  // ── Análise avançada agregada ──────────────────────────────────────────
  analysisData: any = null;
  analysisLoading = false;
  analysisError: string | null = null;

  // ── Configuração do gráfico CPU/Memória ────────────────────────────────
  chartLabels: string[] = [];
  chartDatasets: ChartDataset<'line'>[] = [];
  chartOptions: ChartConfiguration<'line'>['options'] = {
    responsive: true,
    maintainAspectRatio: false,
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
        borderColor: 'rgba(124, 58, 237, 0.3)',
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
        grid: { color: 'rgba(255,255,255,0.05)' },
        beginAtZero: true,
        max: 100
      }
    }
  };

  // ── Configuração do gráfico Óptico ─────────────────────────────────────
  opticalChartLabels: string[] = [];
  opticalChartDatasets: ChartDataset<'line'>[] = [];
  opticalChartOptions: ChartConfiguration<'line'>['options'] = {
    responsive: true,
    maintainAspectRatio: false,
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
        borderColor: 'rgba(16, 185, 129, 0.3)',
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
        grid: { color: 'rgba(255,255,255,0.05)' },
        title: { display: true, text: 'dBm', color: '#94a3b8' }
      }
    }
  };

  private wsSub = new Subscription();
  private readonly CACHE_TTL_MS = 60_000; // 60 segundos de cache no frontend

  constructor(
    private cpeService: CpeService,
    private wsService: WebSocketService,
    private toastService: ToastService,
  ) {}

  ngOnInit(): void {
    this.listenForTelemetryUpdates();
    this.loadHistory();       // carrega gráfico de 6h
    this.loadFromCache();     // tenta cache primeiro (SEM tocar na CPE)
    this.loadAnalysis();      // carrega análise avançada agregada
  }

  ngOnDestroy(): void {
    this.wsSub.unsubscribe();
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

  // ── Getters legados (WAN, Óptica, Hardware) ────────────────────────────
  get isRxCritical(): boolean {
    return this.cpe?.opticalRx !== undefined && this.cpe.opticalRx < -27;
  }
  get isRxGood(): boolean {
    return this.cpe?.opticalRx !== undefined && this.cpe.opticalRx >= -27;
  }
  get rxDisplay(): string {
    return this.cpe?.opticalRx !== undefined ? `${this.cpe.opticalRx} dBm` : 'N/A';
  }
  get txDisplay(): string {
    return this.cpe?.opticalTx !== undefined ? `${this.cpe.opticalTx} dBm` : 'N/A';
  }

  // ── Telemetria ──────────────────────────────────────────────────────────
  /** Getter para uso no template (Angular não expõe Date global). */
  get now(): number {
    return Date.now();
  }

  /** True se o último update tem mais de 5 minutos. */
  get isStale(): boolean {
    return !this.lastUpdated || (Date.now() - this.lastUpdated.getTime()) > 300_000;
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

  /** Retorna métrica parseada como número, ou null. */
  metricValue(key: string): number | null {
    const m = this.telemetryData?.[key] as TelemetryMetric | undefined;
    if (!m || m.value === undefined) return null;
    const n = parseFloat(m.value);
    return isNaN(n) ? null : n;
  }

  /** CPU percentual. */
  get cpuValue(): number | null {
    return this.metricValue('cpuUsage');
  }

  /** Memória livre em KB. */
  get memFreeValue(): number | null {
    return this.metricValue('memoryFree');
  }

  /** Memória total em KB (para calcular % usada). */
  get memTotalValue(): number | null {
    return this.metricValue('memoryTotal');
  }

  /** Percentual de memória usada. */
  get memUsedPercent(): number | null {
    const free = this.memFreeValue;
    const total = this.memTotalValue;
    if (free === null || total === null || total <= 0) return null;
    return Math.round(((total - free) / total) * 100);
  }

  /** Uptime em horas (aproximado). */
  get uptimeHours(): number | null {
    const up = this.metricValue('upTime');
    return up !== null ? Math.round(up / 3600) : null;
  }

  /** Sinal óptico RX (dBm) — telemetria em tempo real. */
  get opticalRxValue(): number | null {
    return this.metricValue('opticalRx');
  }

  /** Sinal óptico TX (dBm) — telemetria em tempo real. */
  get opticalTxValue(): number | null {
    return this.metricValue('opticalTx');
  }

  /** Temperatura do SoC/PCB (°C) — fallback para transceptor óptico se SoC não disponível. */
  get temperatureValue(): number | null {
    const socTemp = this.metricValue('temperature');
    if (socTemp !== null) return socTemp;
    // Fallback: transceiver óptico (XC220-G3 não expõe SoC temperature)
    return this.metricValue('opticalTemperature');
  }

  /** Temperatura do transceptor óptico (°C). */
  get opticalTempValue(): number | null {
    return this.metricValue('opticalTemperature');
  }

  /** Tensão do transceptor óptico (V). */
  get opticalVoltageValue(): number | null {
    return this.metricValue('opticalVoltage');
  }

  /** Status GPON ('connected' | 'disconnected' | null). */
  get gponStatus(): string | null {
    const m = this.telemetryData?.['gponStatus'] as any;
    return m?.value ?? null;
  }

  /** True se GPON está conectado. */
  get isGponConnected(): boolean {
    return this.gponStatus?.toLowerCase() === 'connected';
  }

  /** Taxa de download atual em Kbps. */
  get wanDownstreamRate(): number | null {
    return this.metricValue('wanDownstreamRate');
  }

  /** Taxa de upload atual em Kbps. */
  get wanUpstreamRate(): number | null {
    return this.metricValue('wanUpstreamRate');
  }

  /** Corrente de bias do laser óptico (µA). */
  get biasCurrentValue(): number | null {
    return this.metricValue('biasCurrent');
  }

  /** Total de bytes recebidos (desde o boot). */
  get wanBytesReceived(): number | null {
    return this.metricValue('wanBytesReceived');
  }

  /** Total de bytes enviados (desde o boot). */
  get wanBytesSent(): number | null {
    return this.metricValue('wanBytesSent');
  }

  /** Total de pacotes recebidos. */
  get wanPacketsReceived(): number | null {
    return this.metricValue('wanPacketsReceived');
  }

  /** Total de pacotes enviados. */
  get wanPacketsSent(): number | null {
    return this.metricValue('wanPacketsSent');
  }

  /** Erros de recebimento (degradação de link). */
  get wanErrorsReceived(): number | null {
    return this.metricValue('wanErrorsReceived');
  }

  /** Erros de envio. */
  get wanErrorsSent(): number | null {
    return this.metricValue('wanErrorsSent');
  }

  /** Quantidade de hosts na LAN. */
  get hostCount(): number | null {
    return this.metricValue('hostCount');
  }

  /** Clientes Wi-Fi 2.4GHz. */
  get wifi2gClients(): number | null {
    return this.metricValue('wifi2gClients');
  }

  /** Clientes Wi-Fi 5GHz. */
  get wifi5gClients(): number | null {
    return this.metricValue('wifi5gClients');
  }

  /** Total de clientes Wi-Fi em todas as redes (Principal + Guest + IoT). */
  get wifiTotalClients(): number | null {
    return this.metricValue('wifiTotalClients');
  }

  /** Canal 2.4GHz. */
  get wifi2gChannel(): number | null {
    return this.metricValue('wifi2gChannel');
  }

  /** Canal 5GHz. */
  get wifi5gChannel(): number | null {
    return this.metricValue('wifi5gChannel');
  }

  /** Potência de TX Wi-Fi 2.4GHz (%). */
  get wifi2gTxPower(): number | null {
    return this.metricValue('wifi2gTxPower');
  }

  /** Potência de TX Wi-Fi 5GHz (%). */
  get wifi5gTxPower(): number | null {
    return this.metricValue('wifi5gTxPower');
  }

  /** Formata bytes legíveis (ex: 1.5 GB, 840 MB). */
  formatBytes(bytes: number | null): string {
    if (bytes === null) return '—';
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    const v = bytes / Math.pow(k, i);
    return `${v.toFixed(2)} ${sizes[i]}`;
  }

  // ── Ações ────────────────────────────────────────────────────────────────
  /** Busca telemetria do cache Redis SEM disparar coleta na CPE.
   *  Se não houver cache, não faz nada (usuário deve clicar em "Monitorar agora"). */
  loadFromCache(): void {
    if (!this.serialNumber) return;

    this.cpeService.getTelemetryCache(this.serialNumber).subscribe({
      next: (res) => {
        if (res.success && res.data) {
          this.telemetryData = res.data as TelemetryData;
          this.lastUpdated = new Date(res.timestamp);
          this.telemetryLoading = false;
        }
      },
      error: (err) => {
        // Se não houver cache (404), não faz nada - usuário deve clicar em "Monitorar agora"
        if (err.status !== 404) {
          this.telemetryError = 'Erro ao carregar cache de telemetria.';
        }
      }
    });
  }

  /** Timeout para desativar o spinner se a CPE não responder em 60s. */
  private telemetryTimeoutId: ReturnType<typeof setTimeout> | null = null;

  /** Solicita telemetria sob demanda ao backend (botão de refresh manual). */
  requestTelemetry(): void {
    if (!this.serialNumber) return;
    this.telemetryLoading = true;
    this.telemetryError = null;

    // Limpa timeout anterior se houver
    if (this.telemetryTimeoutId) {
      clearTimeout(this.telemetryTimeoutId);
    }

    this.cpeService.requestTelemetry(this.serialNumber, 'info').subscribe({
      next: (res) => {
        this.toastService.info(res.message || 'Solicitação enviada. Aguardando CPE...');
        // Se em 60s o WebSocket não chegar, desativa o spinner e avisa o usuário
        this.telemetryTimeoutId = setTimeout(() => {
          if (this.telemetryLoading) {
            this.telemetryLoading = false;
            this.telemetryError = 'A CPE não respondeu dentro do tempo esperado (60s). Tente novamente.';
            this.toastService.warning('Timeout: CPE não respondeu em 60 segundos.');
          }
        }, 60000);
      },
      error: () => {
        this.telemetryLoading = false;
        this.telemetryError = 'Falha ao solicitar telemetria.';
        this.toastService.error('Erro ao solicitar telemetria da CPE.');
      }
    });
  }

  /** Carrega análise avançada agregada do backend. */
  loadAnalysis(): void {
    if (!this.serialNumber) return;
    this.analysisLoading = true;
    this.cpeService.getTelemetryAnalysis(this.serialNumber).subscribe({
      next: (res) => {
        this.analysisData = res;
        this.analysisLoading = false;
      },
      error: () => {
        this.analysisLoading = false;
        this.analysisError = 'Erro ao carregar análise avançada.';
      }
    });
  }

  /** Escuta WebSocket de telemetria para esta CPE. */
  private listenForTelemetryUpdates(): void {
    this.wsSub.add(
      this.wsService.onTelemetryUpdate().subscribe(event => {
        if (event.serialNumber !== this.serialNumber) return;
        // Limpa timeout de segurança para evitar que ele dispare depois
        if (this.telemetryTimeoutId) {
          clearTimeout(this.telemetryTimeoutId);
          this.telemetryTimeoutId = null;
        }
        // Faz merge dos novos dados com os existentes: garante que dados de
        // chunks anteriores (ex: CPU/Uptime) não sejam apagados quando um
        // evento parcial chega (ex: só optical após chunks 0+1 já mostrados).
        this.telemetryData = { ...(this.telemetryData || {}), ...(event.data as TelemetryData) };
        this.lastUpdated = new Date(event.timestamp);
        this.telemetryLoading = false;

        // Se o backend indicar que é coleta parcial (chunks faltantes), avisa o técnico
        if ((event as any).partial) {
          const msg = (event as any).message || 'Coleta parcial — alguns lotes não responderam.';
          this.toastService.warning(msg);
        } else {
          this.toastService.success('Telemetria recebida em tempo real.');
        }

        this.loadHistory(); // recarrega gráfico com dado mais recente
      })
    );
  }

  // ── Gráfico de histórico (últimas 6h) ──────────────────────────────────
  /** Carrega raw history e monta datasets do Chart.js. */
  loadHistory(): void {
    if (!this.serialNumber) return;
    this.historyLoading = true;

    this.cpeService.getTelemetryRaw(this.serialNumber, 6).subscribe({
      next: (res) => {
        this.rawHistory = res.data || [];
        this.buildChart();
        this.historyLoading = false;
      },
      error: () => {
        this.historyLoading = false;
      }
    });
  }

  private buildChart(): void {
    const data = this.rawHistory;
    if (data.length === 0) {
      this.chartLabels = [];
      this.chartDatasets = [];
      this.opticalChartLabels = [];
      this.opticalChartDatasets = [];
      return;
    }

    // Labels: hora formatada (ex: "14:32")
    const labels = data.map(d => {
      const date = new Date(d.timestamp);
      return `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
    });
    this.chartLabels = labels;
    this.opticalChartLabels = labels;

    // Datasets: CPU e Memória Usada (%)
    const cpuData = data.map(d => typeof d.cpuUsage === 'number' ? d.cpuUsage : null);
    const memData = data.map(d => {
      if (typeof d.memoryFree === 'number' && typeof d.memoryTotal === 'number' && d.memoryTotal > 0) {
        return Math.round(((d.memoryTotal - d.memoryFree) / d.memoryTotal) * 100);
      }
      return null;
    });

    this.chartDatasets = [
      {
        label: 'CPU (%)',
        data: cpuData,
        borderColor: '#7c3aed',
        backgroundColor: 'rgba(124, 58, 237, 0.15)',
        fill: true,
        tension: 0.3,
        pointRadius: 3,
        pointBackgroundColor: '#7c3aed',
      },
      {
        label: 'Memória Usada (%)',
        data: memData,
        borderColor: '#06b6d4',
        backgroundColor: 'rgba(6, 182, 212, 0.15)',
        fill: true,
        tension: 0.3,
        pointRadius: 3,
        pointBackgroundColor: '#06b6d4',
      }
    ];

    // Datasets Ópticos: RX e TX (dBm)
    const rxData = data.map(d => typeof d.opticalRx === 'number' ? d.opticalRx : null);
    const txData = data.map(d => typeof d.opticalTx === 'number' ? d.opticalTx : null);

    this.opticalChartDatasets = [
      {
        label: 'RX (dBm)',
        data: rxData,
        borderColor: '#10b981',
        backgroundColor: 'rgba(16, 185, 129, 0.15)',
        fill: true,
        tension: 0.3,
        pointRadius: 3,
        pointBackgroundColor: '#10b981',
      },
      {
        label: 'TX (dBm)',
        data: txData,
        borderColor: '#f59e0b',
        backgroundColor: 'rgba(245, 158, 11, 0.15)',
        fill: true,
        tension: 0.3,
        pointRadius: 3,
        pointBackgroundColor: '#f59e0b',
      }
    ];
  }
}
