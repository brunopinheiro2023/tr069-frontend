import { Component, Input, OnInit, OnDestroy, inject, ChangeDetectorRef, DestroyRef, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subscription } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CpeService } from '../../../../../../core/services/cpe.service';
import { WebSocketService } from '../../../../../../core/services/websocket.service';
import { NeighborScanCardComponent } from '../cpe-diagnostics-tab-new/components/neighbor-scan-card/neighbor-scan-card.component';
import { WifiNeighborScanEntry } from '../../../../../../core/models';
import { sanitizeNumber, sanitizeString } from '@app/core/utils/sanitize';
import { normalizeBandwidth } from '@app/core/utils/bandwidth';
import { CHANNEL_RANGE } from '@app/core/constants/wifi.constants';
import { CpeDevice, WifiInsight, WifiHostsData, WifiDiagnosticsData } from '@app/core/models';

@Component({
  selector: 'app-cpe-wifi-analysis-tab',
  standalone: true,
  imports: [CommonModule, NeighborScanCardComponent],
  templateUrl: './cpe-wifi-analysis-tab.component.html',
  styleUrls: ['./cpe-wifi-analysis-tab.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CpeWifiAnalysisTabComponent implements OnInit, OnDestroy {
  @Input() cpe: CpeDevice | null = null;
  @Input() serialNumber: string = '';

  isLoading: boolean = false;
  neighborScanData: WifiDiagnosticsData | null = null;
  neighborScanInProgress: boolean = false;
  diagnosticsError: boolean = false;
  private neighborScanFailsafe?: ReturnType<typeof setTimeout>;
  private wsSubscription?: Subscription;

  // ── Insights ────────────────────────────────────────────────────────────
  wifiInsights: WifiInsight[] = [];
  insightsLoading = false;
  wifiHostsSummary: WifiHostsData | null = null;

  // ── Histórico de scans ──────────────────────────────────────────────────
  scanHistory: WifiNeighborScanEntry[] = [];
  historyLoading = false;
  showHistory = false; // toggle para expandir seção histórico

  // ── Apply Optimization ──────────────────────────────────────────────────
  applyInProgress = false;
  applyError: string | null = null;
  applySuccess: string | null = null;
  private applySuccessTimer?: ReturnType<typeof setTimeout>;
  private applyErrorTimer?: ReturnType<typeof setTimeout>;

  // ── Loading Coordenado ────────────────────────────────────────────────────
  private loadingCount = 0;

  private destroyRef = inject(DestroyRef);
  private cdr = inject(ChangeDetectorRef);

  constructor(
    private cpeService: CpeService,
    private wsService: WebSocketService
  ) {}

  ngOnInit(): void {
    // Validação de entrada: serialNumber deve ser uma string não vazia
    if (!this.isValidSerialNumber(this.serialNumber)) {
      console.error('[WifiAnalysisTab] Serial number inválido:', this.serialNumber);
      this.diagnosticsError = true;
      return;
    }

    // Inscreve-se na sala da CPE para receber eventos WebSocket específicos
    this.wsService.subscribeToCpe(this.serialNumber);

    this.loadAllData();
    this.setupWebSocketListeners();
  }

  ngOnDestroy(): void {
    this.wsSubscription?.unsubscribe();
    // Cancela inscrição na sala da CPE ao destruir o componente
    this.wsService.unsubscribeFromCpe(this.serialNumber);
    if (this.neighborScanFailsafe) {
      clearTimeout(this.neighborScanFailsafe);
    }
    if (this.applySuccessTimer) clearTimeout(this.applySuccessTimer);
    if (this.applyErrorTimer)   clearTimeout(this.applyErrorTimer);
  }

  /**
   * Valida se o serial number é válido.
   * Segurança: previne uso de serial numbers inválidos ou maliciosos.
   */
  private isValidSerialNumber(serial: string): boolean {
    return typeof serial === 'string' && serial.trim().length > 0 && serial.length <= 64;
  }

  /**
   * Busca o valor de um parâmetro no array parametersCache do CPE.
   * Substitui o acesso indevido como dicionário (this.cpe.parameters[path]).
   */
  private getParamValue(path: string): string | undefined {
    const cache = this.cpe?.parametersCache;
    if (!Array.isArray(cache)) return undefined;
    return cache.find((p: { name: string; value?: string }) => p.name === path)?.value;
  }

  /**
   * Carrega todos os dados da aba de análise WiFi.
   * O loading só termina quando todos os dados são carregados ou em caso de erro.
   */
  loadAllData(): void {
    if (!this.isValidSerialNumber(this.serialNumber)) {
      return;
    }

    this.loadNeighborScanData();
    this.loadNeighborScanHistory();
    this.loadWifiInsights();
  }

  loadNeighborScanData(): void {
    if (!this.isValidSerialNumber(this.serialNumber)) {
      return;
    }

    this.startLoading();
    this.cpeService.getWifiDiagnostics(this.serialNumber)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
      next: (data) => {
        // Validação: dados devem ser um objeto válido
        if (data && typeof data === 'object') {
          this.neighborScanData = data;
          this.diagnosticsError = false;
        } else {
          console.warn('[WifiAnalysisTab] Dados de diagnóstico inválidos recebidos:', data);
          this.neighborScanData = null;
        }
        this.stopLoading();
      },
      error: (err) => {
        console.error('[WifiAnalysisTab] Erro ao carregar dados de diagnóstico WiFi:', err);
        this.diagnosticsError = true; // Mantém last known data visível, mas avisa que está desatualizado
        this.stopLoading();
      }
    });
  }

  /**
   * Carrega o histórico de varreduras de vizinhos.
   */
  loadNeighborScanHistory(): void {
    if (!this.isValidSerialNumber(this.serialNumber)) {
      return;
    }
    this.historyLoading = true;
    this.startLoading();
    this.cpeService.getWifiNeighborHistory(this.serialNumber, 10)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          this.scanHistory = response?.data ?? [];
          this.historyLoading = false;
          this.stopLoading();
          this.cdr.markForCheck();
        },
        error: () => {
          this.historyLoading = false;
          this.stopLoading();
          this.cdr.markForCheck();
        }
      });
  }

  /**
   * Carrega insights Wi-Fi do endpoint /wifi-hosts.
   */
  private loadWifiInsights(): void {
    if (!this.isValidSerialNumber(this.serialNumber)) {
      return;
    }
    this.insightsLoading = true;
    this.startLoading();
    this.cpeService.getWifiHosts(this.serialNumber) // retorna { hosts, insights, summary }
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res: { insights?: WifiInsight[]; summary?: WifiHostsData }) => {
          this.wifiInsights = (res?.insights || []).slice(0, 20);
          this.wifiHostsSummary = res?.summary || null;
          this.insightsLoading = false;
          this.stopLoading();
          this.cdr.markForCheck();
        },
        error: () => {
          this.insightsLoading = false;
          this.stopLoading();
          this.cdr.markForCheck();
        }
      });
  }

  triggerNeighborScan(): void {
    if (!this.isValidSerialNumber(this.serialNumber) || this.neighborScanInProgress) return;

    this.neighborScanInProgress = true;

    this.cpeService.triggerNeighborScan(this.serialNumber)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
      next: () => {
        // Failsafe AUMENTADO para 60s — apenas rede de segurança, não o caminho normal
        this.neighborScanFailsafe = setTimeout(() => {
          console.warn('[WifiAnalysisTab] Timeout da varredura de vizinhos');
          this.neighborScanInProgress = false;
        }, 60000);
      },
      error: (err) => {
        console.error('[WifiAnalysisTab] Erro ao acionar varredura de vizinhos:', err);
        this.neighborScanInProgress = false;
      }
    });
  }

  setupWebSocketListeners(): void {
    this.wsSubscription = this.wsService.on('neighbor_scan_completed').subscribe(event => {
      // Validação de segurança: verifica estrutura do evento
      if (event && typeof event === 'object' && event.serialNumber === this.serialNumber) {
        this.neighborScanInProgress = false;
        if (this.neighborScanFailsafe) {
          clearTimeout(this.neighborScanFailsafe);
        }
        // Atualiza contagem imediatamente via evento WebSocket — não espera o endpoint
        // recarregar. event.resultCount = freshResults.length (cwmpController L.2956).
        // Evita que o card mostre "0 redes" se o cache do /wifi-diagnostics ainda não expirou.
        if (typeof event.resultCount === 'number') {
          this.neighborScanData = {
            ...(this.neighborScanData || {} as WifiDiagnosticsData),
            neighboringWiFiResultCount: event.resultCount,
          } as WifiDiagnosticsData;
          this.cdr.markForCheck();
        }
        this.loadNeighborScanData();
        this.loadWifiInsights();
        this.loadNeighborScanHistory();
      }
    });
  }



  /**
   * Helper unificado: retorna a largura de banda de uma banda (elimina duplicação wifi2g/wifi5g).
   * @param band '2.4GHz' ou '5GHz'
   */
  private getWifiBandwidth(band: '2.4GHz' | '5GHz'): string {
    const radioIdx = band === '2.4GHz' ? 1 : 2;
    const fromCache = this.getParamValue(`Device.WiFi.Radio.${radioIdx}.OperatingChannelBandwidth`);
    const fromStruct = (band === '2.4GHz' ? this.cpe?.wifi2g?.bandwidth : this.cpe?.wifi5g?.bandwidth) as string | undefined;
    return normalizeBandwidth(fromCache) ?? normalizeBandwidth(fromStruct) ?? '—';
  }

  /** Largura de banda atual do WiFi 2.4GHz. */
  get wifi2gBandwidth(): string { return this.getWifiBandwidth('2.4GHz'); }
  /** Largura de banda atual do WiFi 5GHz. */
  get wifi5gBandwidth(): string { return this.getWifiBandwidth('5GHz'); }

  /**
   * Helper unificado: retorna o canal de uma banda com detecção de auto mode.
   * @param band '2.4GHz' ou '5GHz'
   */
  private getWifiChannel(band: '2.4GHz' | '5GHz'): string {
    const radioIdx = band === '2.4GHz' ? 1 : 2;
    const fromCache  = this.getParamValue(`Device.WiFi.Radio.${radioIdx}.Channel`);
    const autoEnable = this.getParamValue(`Device.WiFi.Radio.${radioIdx}.AutoChannelEnable`);
    const autoStruct = (band === '2.4GHz' ? this.cpe?.wifi2g?.autoChannelEnable : this.cpe?.wifi5g?.autoChannelEnable) as boolean | null | undefined;
    const channel    = fromCache ?? String(band === '2.4GHz' ? this.cpe?.wifi2g?.channel : this.cpe?.wifi5g?.channel ?? '');
    // Auto mode: canal='0'/'auto', AutoChannelEnable=true (cache ou campo estruturado)
    if (channel === '0' || String(channel).toLowerCase() === 'auto' ||
        autoEnable === 'true' || autoStruct === true) return 'Auto';
    if (!channel || channel === 'undefined') return '—';
    const num = Number(channel);
    // Fora do range (CHANNEL_RANGE centralizado) → '—' em vez de exibir valor inválido/lixo
    const range = CHANNEL_RANGE[band] || CHANNEL_RANGE['2.4GHz'];
    if (isNaN(num) || num < range.min || num > range.max) return '—';
    return num.toString();
  }

  /** Canal atual do WiFi 2.4GHz (detecta auto mode). */
  get wifi2gChannel(): string { return this.getWifiChannel('2.4GHz'); }
  /** Canal atual do WiFi 5GHz (detecta auto mode). */
  get wifi5gChannel(): string { return this.getWifiChannel('5GHz'); }

  /**
   * Helper unificado: indica se o rádio de uma banda está em modo automático.
   * @param band '2.4GHz' ou '5GHz'
   */
  private getWifiAutoMode(band: '2.4GHz' | '5GHz'): boolean {
    const radioIdx = band === '2.4GHz' ? 1 : 2;
    const channel    = this.getParamValue(`Device.WiFi.Radio.${radioIdx}.Channel`);
    const autoEnable = this.getParamValue(`Device.WiFi.Radio.${radioIdx}.AutoChannelEnable`);
    const autoStruct = (band === '2.4GHz' ? this.cpe?.wifi2g?.autoChannelEnable : this.cpe?.wifi5g?.autoChannelEnable) as boolean | null | undefined;
    return channel === '0' || String(channel).toLowerCase() === 'auto' ||
           autoEnable === 'true' || autoStruct === true;
  }

  /** Indica se o rádio 2.4GHz está em modo automático. */
  get wifi2gAutoMode(): boolean { return this.getWifiAutoMode('2.4GHz'); }
  /** Indica se o rádio 5GHz está em modo automático. */
  get wifi5gAutoMode(): boolean { return this.getWifiAutoMode('5GHz'); }

  /**
   * Helper unificado: retorna a potência de transmissão de uma banda.
   * @param band '2.4GHz' ou '5GHz'
   */
  private getWifiPower(band: '2.4GHz' | '5GHz'): string {
    const radioIdx = band === '2.4GHz' ? 1 : 2;
    const fromCache  = this.getParamValue(`Device.WiFi.Radio.${radioIdx}.TransmitPower`);
    const fromStruct = band === '2.4GHz' ? this.cpe?.wifi2g?.txPower : this.cpe?.wifi5g?.txPower;
    const raw = fromCache ?? (fromStruct != null ? String(fromStruct) : undefined);
    if (raw === undefined) return '—';
    const num = sanitizeNumber(raw, 0, 100);
    return num > 0 ? `${num}%` : '—';
  }

  /** Potência de transmissão do WiFi 2.4GHz. */
  get wifi2gPower(): string { return this.getWifiPower('2.4GHz'); }
  /** Potência de transmissão do WiFi 5GHz. */
  get wifi5gPower(): string { return this.getWifiPower('5GHz'); }

  /**
   * Valida se o CPE tem dados WiFi suficientes para análise.
   * Aceita tanto parametersCache quanto campos estruturados (cpe.wifi2g/wifi5g).
   */
  get hasValidWifiData(): boolean {
    return this.hasLive2gData || this.hasLive5gData;
  }

  /**
   * Helper unificado: verifica se há dados ao vivo para uma banda.
   * @param band '2.4GHz' ou '5GHz'
   */
  private hasLiveBandData(band: '2.4GHz' | '5GHz'): boolean {
    const radioIdx = band === '2.4GHz' ? 1 : 2;
    const fromCache  = this.getParamValue(`Device.WiFi.Radio.${radioIdx}.Channel`);
    const fromStruct = band === '2.4GHz' ? this.cpe?.wifi2g?.channel : this.cpe?.wifi5g?.channel;
    return fromCache !== undefined || (fromStruct != null && fromStruct !== '');
  }

  /** Verifica se há dados ao vivo para a banda 2.4GHz. */
  get hasLive2gData(): boolean { return this.hasLiveBandData('2.4GHz'); }
  /** Verifica se há dados ao vivo para a banda 5GHz. */
  get hasLive5gData(): boolean { return this.hasLiveBandData('5GHz'); }

  /**
   * Inicia o loading coordenado.
   */
  private startLoading(): void {
    this.loadingCount++;
    this.isLoading = true;
  }

  /**
   * Finaliza o loading coordenado.
   * Só desliga isLoading quando todas as requisições completarem.
   */
  private stopLoading(): void {
    if (--this.loadingCount <= 0) {
      this.loadingCount = 0;
      this.isLoading = false;
      this.cdr.markForCheck();
    }
  }

  /**
   * Aplica recomendação de otimização Wi-Fi via endpoint /wifi-diagnostics/apply.
   */
  applyWifiRecommendation(insight: WifiInsight): void {
    if (!insight?.action || this.applyInProgress) return;
    const { type, band, value } = insight.action;
    if (!type || !band || value === undefined) return;

    this.applyInProgress = true;
    this.applyError = null;
    this.applySuccess = null;
    this.cdr.markForCheck();

    this.cpeService.applyWifiOptimization(this.serialNumber, { type, band, value })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.applyInProgress = false;
          this.applySuccess = `Otimização "${band}" enviada para a CPE.`;
          this.applySuccessTimer = setTimeout(() => { this.applySuccess = null; this.cdr.markForCheck(); }, 5000);
          this.cdr.markForCheck();
        },
        error: (err: { error?: { error?: string } }) => {
          this.applyInProgress = false;
          this.applyError = err?.error?.error || 'Erro ao aplicar otimização.';
          this.applyErrorTimer = setTimeout(() => { this.applyError = null; this.cdr.markForCheck(); }, 8000);
          this.cdr.markForCheck();
        }
      });
  }

  /**
   * Filtra apenas insights NÃO-actionable (sinal, QoE, SNR, throughput, ruído).
   * Insights actionable (canal, largura, potência) são exibidos no card de otimização
   * (neighbor-scan-card) para centralizar as sugestões aplicáveis em um único lugar.
   */
  get nonActionableInsights(): WifiInsight[] {
    return (this.wifiInsights || []).filter(i => !i?.actionable);
  }

  /**
   * Helpers para o template de insights.
   */
  insightSeverityClass(severity: string): string {
    if (severity === 'critical') return 'border-red-400 bg-red-50 dark:bg-red-900/20';
    if (severity === 'warning') return 'border-yellow-400 bg-yellow-50 dark:bg-yellow-900/20';
    return 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800';
  }

  insightBadge(severity: string): string {
    if (severity === 'critical') return '🔴';
    if (severity === 'warning') return '⚠️';
    return 'ℹ️';
  }

  /**
   * Formata timestamp do histórico para exibição compacta.
   */
  formatScanTime(ts: string | Date): string {
    if (!ts) return '—';
    const d = new Date(ts);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  }
}
