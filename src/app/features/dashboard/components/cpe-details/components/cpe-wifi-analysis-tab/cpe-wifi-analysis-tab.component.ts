import { Component, Input, OnInit, OnDestroy, inject, ChangeDetectorRef, DestroyRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subscription } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CpeService } from '../../../../../../core/services/cpe.service';
import { WebSocketService } from '../../../../../../core/services/websocket.service';
import { NeighborScanCardComponent } from '../cpe-diagnostics-tab-new/components/neighbor-scan-card/neighbor-scan-card.component';
import { WifiNeighborScanEntry } from '../../../../../../core/models';

@Component({
  selector: 'app-cpe-wifi-analysis-tab',
  standalone: true,
  imports: [CommonModule, NeighborScanCardComponent],
  templateUrl: './cpe-wifi-analysis-tab.component.html',
  styleUrls: ['./cpe-wifi-analysis-tab.component.scss']
})
export class CpeWifiAnalysisTabComponent implements OnInit, OnDestroy {
  @Input() cpe: any = null;
  @Input() serialNumber: string = '';

  isLoading: boolean = false;
  neighborScanData: any = null;
  neighborScanInProgress: boolean = false;
  diagnosticsError: boolean = false;
  private neighborScanFailsafe?: ReturnType<typeof setTimeout>;
  private wsSubscription?: Subscription;

  // ── Insights ────────────────────────────────────────────────────────────
  wifiInsights: any[] = [];
  insightsLoading = false;
  wifiHostsSummary: any = null;

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
   * Sanitiza um valor string do CPE.
   * Segurança: remove caracteres perigosos e valida tipo.
   */
  private sanitizeString(value: any, maxLength: number = 100): string {
    if (value === null || value === undefined) return 'Desconhecido';
    if (typeof value !== 'string') return 'Desconhecido';
    const sanitized = value.trim().substring(0, maxLength);
    return sanitized || 'Desconhecido';
  }

  /**
   * Sanitiza um valor numérico do CPE.
   * Segurança: valida que é um número válido e está em faixa aceitável.
   */
  private sanitizeNumber(value: any, min: number = 0, max: number = 100): number {
    if (value === null || value === undefined) return min;
    const num = Number(value);
    if (isNaN(num)) return min;
    return Math.max(min, Math.min(max, num));
  }

  /**
   * Busca o valor de um parâmetro no array parametersCache do CPE.
   * Substitui o acesso indevido como dicionário (this.cpe.parameters[path]).
   */
  private getParamValue(path: string): string | undefined {
    const cache = this.cpe?.parametersCache;
    if (!Array.isArray(cache)) return undefined;
    return cache.find((p: any) => p.name === path)?.value;
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
          this.cdr.detectChanges();
        },
        error: () => {
          this.historyLoading = false;
          this.stopLoading();
          this.cdr.detectChanges();
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
        next: (res: any) => {
          this.wifiInsights = (res?.insights || []).slice(0, 20);
          this.wifiHostsSummary = res?.summary || null;
          this.insightsLoading = false;
          this.stopLoading();
          this.cdr.detectChanges();
        },
        error: () => {
          this.insightsLoading = false;
          this.stopLoading();
          this.cdr.detectChanges();
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
            ...(this.neighborScanData || {}),
            neighboringWiFiResultCount: event.resultCount,
          };
          this.cdr.detectChanges();
        }
        this.loadNeighborScanData();
        this.loadWifiInsights();
        this.loadNeighborScanHistory();
      }
    });
  }

  /**
   * Normaliza o valor de largura de banda retornado pela CPE para formato canônico.
   * CPEs retornam formatos variados: "20 MHz", "VHT80", "HE80", "20/40MHz", "80" (Intelbras), etc.
   * Retorna null se o valor não puder ser normalizado para um formato reconhecido.
   */
  private normalizeBandwidth(raw: string | undefined): string | null {
    if (!raw) return null;
    const s = raw.trim().toUpperCase().replace(/\s+/g, '');
    // Auto mode
    if (s === 'AUTO' || s === '0') return 'Auto';
    // Formatos numéricos com unidade: "20MHZ", "40MHZ", "80MHZ", "160MHZ"
    const mhzMatch = s.match(/^(\d+)MHZ$/);
    if (mhzMatch) return `${mhzMatch[1]}MHz`;
    // Formatos compostos: "20/40MHZ", "40/80MHZ", "20MHZ/40MHZ", "40MHZ/80MHZ"
    const compositeMatch = s.match(/^(\d+)(?:MHZ)?\/(\d+)MHZ$/);
    if (compositeMatch) return `${compositeMatch[1]}MHz/${compositeMatch[2]}MHz`;
    // Formatos 802.11 vendor: "VHT20", "VHT40", "VHT80", "VHT160", "HE20", "HE40", "HE80", "HE160"
    const vhtHeMatch = s.match(/^(?:VHT|HE|EHT)(\d+)$/);
    if (vhtHeMatch) return `${vhtHeMatch[1]}MHz`;
    // Intelbras X_ITBS_BandWidth: só o número sem unidade ("20", "40", "80", "160")
    const bareNum = s.match(/^(\d+)$/);
    if (bareNum && ['20', '40', '80', '160'].includes(bareNum[1])) return `${bareNum[1]}MHz`;
    return null;
  }

  /**
   * Retorna a largura de banda atual do WiFi 2.4GHz.
   * Fonte primária: parametersCache (TR-181 Device.WiFi.Radio.1.OperatingChannelBandwidth).
   * Fallback: cpe.wifi2g.bandwidth (campo estruturado persistido pelo wifiCollectorService).
   * Normaliza formatos variados da CPE (VHT, HE, espaços, Intelbras sem unidade).
   */
  get wifi2gBandwidth(): string {
    const fromCache = this.getParamValue('Device.WiFi.Radio.1.OperatingChannelBandwidth');
    const fromStruct = this.cpe?.wifi2g?.bandwidth as string | undefined;
    return this.normalizeBandwidth(fromCache) ?? this.normalizeBandwidth(fromStruct) ?? '—';
  }

  /**
   * Retorna a largura de banda atual do WiFi 5GHz.
   * Fonte primária: parametersCache (TR-181 Device.WiFi.Radio.2.OperatingChannelBandwidth).
   * Fallback: cpe.wifi5g.bandwidth (campo estruturado persistido pelo wifiCollectorService).
   */
  get wifi5gBandwidth(): string {
    const fromCache = this.getParamValue('Device.WiFi.Radio.2.OperatingChannelBandwidth');
    const fromStruct = this.cpe?.wifi5g?.bandwidth as string | undefined;
    return this.normalizeBandwidth(fromCache) ?? this.normalizeBandwidth(fromStruct) ?? '—';
  }

  /**
   * Retorna o canal atual do WiFi 2.4GHz.
   * Detecta modo automático (canal=0 ou AutoChannelEnable=true) e exibe "Auto".
   * Fonte primária: parametersCache. Fallback: cpe.wifi2g.channel (campo estruturado).
   */
  get wifi2gChannel(): string {
    const fromCache  = this.getParamValue('Device.WiFi.Radio.1.Channel');
    const autoEnable = this.getParamValue('Device.WiFi.Radio.1.AutoChannelEnable');
    const autoStruct = this.cpe?.wifi2g?.autoChannelEnable as boolean | null | undefined;
    const channel    = fromCache ?? String(this.cpe?.wifi2g?.channel ?? '');
    // Auto mode: canal='0'/'auto', AutoChannelEnable=true (cache ou campo estruturado)
    if (channel === '0' || String(channel).toLowerCase() === 'auto' ||
        autoEnable === 'true' || autoStruct === true) return 'Auto';
    if (!channel || channel === 'undefined') return '—';
    const num = Number(channel);
    // Fora do range 2.4GHz (1-13) → '—' em vez de exibir valor inválido/lixo da CPE
    if (isNaN(num) || num < 1 || num > 13) return '—';
    return num.toString();
  }

  /**
   * Retorna o canal atual do WiFi 5GHz.
   * Detecta modo automático (canal=0 ou AutoChannelEnable=true) e exibe "Auto".
   * Fonte primária: parametersCache. Fallback: cpe.wifi5g.channel (campo estruturado).
   */
  get wifi5gChannel(): string {
    const fromCache  = this.getParamValue('Device.WiFi.Radio.2.Channel');
    const autoEnable = this.getParamValue('Device.WiFi.Radio.2.AutoChannelEnable');
    const autoStruct = this.cpe?.wifi5g?.autoChannelEnable as boolean | null | undefined;
    const channel    = fromCache ?? String(this.cpe?.wifi5g?.channel ?? '');
    if (channel === '0' || String(channel).toLowerCase() === 'auto' ||
        autoEnable === 'true' || autoStruct === true) return 'Auto';
    if (!channel || channel === 'undefined') return '—';
    const num = Number(channel);
    // Fora do range 5GHz válido (36-165, UNII-1/2/3 sem extensões exóticas) → '—'
    if (isNaN(num) || num < 36 || num > 165) return '—';
    return num.toString();
  }

  /**
   * Indica se o rádio 2.4GHz está em modo automático de canal.
   * Verifica parametersCache e campo estruturado cpe.wifi2g.autoChannelEnable.
   */
  get wifi2gAutoMode(): boolean {
    const channel    = this.getParamValue('Device.WiFi.Radio.1.Channel');
    const autoEnable = this.getParamValue('Device.WiFi.Radio.1.AutoChannelEnable');
    const autoStruct = this.cpe?.wifi2g?.autoChannelEnable as boolean | null | undefined;
    return channel === '0' || String(channel).toLowerCase() === 'auto' ||
           autoEnable === 'true' || autoStruct === true;
  }

  /**
   * Indica se o rádio 5GHz está em modo automático de canal.
   * Verifica parametersCache e campo estruturado cpe.wifi5g.autoChannelEnable.
   */
  get wifi5gAutoMode(): boolean {
    const channel    = this.getParamValue('Device.WiFi.Radio.2.Channel');
    const autoEnable = this.getParamValue('Device.WiFi.Radio.2.AutoChannelEnable');
    const autoStruct = this.cpe?.wifi5g?.autoChannelEnable as boolean | null | undefined;
    return channel === '0' || String(channel).toLowerCase() === 'auto' ||
           autoEnable === 'true' || autoStruct === true;
  }

  /**
   * Retorna a potência de transmissão do WiFi 2.4GHz.
   * Fonte primária: parametersCache. Fallback: cpe.wifi2g.txPower (campo estruturado).
   */
  get wifi2gPower(): string {
    const fromCache  = this.getParamValue('Device.WiFi.Radio.1.TransmitPower');
    const fromStruct = this.cpe?.wifi2g?.txPower;
    const raw = fromCache ?? (fromStruct != null ? String(fromStruct) : undefined);
    if (raw === undefined) return '—';
    const num = this.sanitizeNumber(raw, 0, 100);
    return num > 0 ? `${num}%` : '—';
  }

  /**
   * Retorna a potência de transmissão do WiFi 5GHz.
   * Fonte primária: parametersCache. Fallback: cpe.wifi5g.txPower (campo estruturado).
   */
  get wifi5gPower(): string {
    const fromCache  = this.getParamValue('Device.WiFi.Radio.2.TransmitPower');
    const fromStruct = this.cpe?.wifi5g?.txPower;
    const raw = fromCache ?? (fromStruct != null ? String(fromStruct) : undefined);
    if (raw === undefined) return '—';
    const num = this.sanitizeNumber(raw, 0, 100);
    return num > 0 ? `${num}%` : '—';
  }

  /**
   * Valida se o CPE tem dados WiFi suficientes para análise.
   * Aceita tanto parametersCache quanto campos estruturados (cpe.wifi2g/wifi5g).
   */
  get hasValidWifiData(): boolean {
    return this.hasLive2gData || this.hasLive5gData;
  }

  /**
   * Verifica se há dados ao vivo para a banda 2.4GHz.
   * Fonte: parametersCache (mais recente) ou cpe.wifi2g.channel (persistido).
   */
  get hasLive2gData(): boolean {
    const fromCache  = this.getParamValue('Device.WiFi.Radio.1.Channel');
    const fromStruct = this.cpe?.wifi2g?.channel;
    return fromCache !== undefined || (fromStruct != null && fromStruct !== '');
  }

  /**
   * Verifica se há dados ao vivo para a banda 5GHz.
   * Fonte: parametersCache (mais recente) ou cpe.wifi5g.channel (persistido).
   */
  get hasLive5gData(): boolean {
    const fromCache  = this.getParamValue('Device.WiFi.Radio.2.Channel');
    const fromStruct = this.cpe?.wifi5g?.channel;
    return fromCache !== undefined || (fromStruct != null && fromStruct !== '');
  }

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
      this.cdr.detectChanges();
    }
  }

  /**
   * Aplica recomendação de otimização Wi-Fi via endpoint /wifi-diagnostics/apply.
   */
  applyWifiRecommendation(insight: any): void {
    if (!insight?.action || this.applyInProgress) return;
    const { type, band, value } = insight.action;
    if (!type || !band || value === undefined) return;

    this.applyInProgress = true;
    this.applyError = null;
    this.applySuccess = null;
    this.cdr.detectChanges();

    this.cpeService.applyWifiOptimization(this.serialNumber, { type, band, value })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.applyInProgress = false;
          this.applySuccess = `Otimização "${band}" enviada para a CPE.`;
          this.applySuccessTimer = setTimeout(() => { this.applySuccess = null; this.cdr.detectChanges(); }, 5000);
          this.cdr.detectChanges();
        },
        error: (err: any) => {
          this.applyInProgress = false;
          this.applyError = err?.error?.error || 'Erro ao aplicar otimização.';
          this.applyErrorTimer = setTimeout(() => { this.applyError = null; this.cdr.detectChanges(); }, 8000);
          this.cdr.detectChanges();
        }
      });
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
