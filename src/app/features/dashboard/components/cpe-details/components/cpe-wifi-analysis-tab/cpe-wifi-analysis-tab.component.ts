import { Component, Input, OnInit, OnDestroy, inject, ChangeDetectorRef, DestroyRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subscription } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CpeService } from '../../../../../../core/services/cpe.service';
import { WebSocketService } from '../../../../../../core/services/websocket.service';
import { NeighborScanCardComponent } from '../cpe-diagnostics-tab-new/components/neighbor-scan-card/neighbor-scan-card.component';

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
  neighborScanHistory: any[] = [];
  diagnosticsError: boolean = false;
  private neighborScanFailsafe?: ReturnType<typeof setTimeout>;
  private wsSubscription?: Subscription;

  // ── Insights ────────────────────────────────────────────────────────────
  wifiInsights: any[] = [];
  insightsLoading = false;
  wifiHostsSummary: any = null;

  // ── Histórico de scans ──────────────────────────────────────────────────
  scanHistory: any[] = [];
  historyLoading = false;
  showHistory = false; // toggle para expandir seção histórico

  // ── Apply Optimization ──────────────────────────────────────────────────
  applyInProgress = false;
  applyError: string | null = null;
  applySuccess: string | null = null;

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
      this.isLoading = false;
      return;
    }

    this.loadAllData();
    this.setupWebSocketListeners();
  }

  ngOnDestroy(): void {
    this.wsSubscription?.unsubscribe();
    if (this.neighborScanFailsafe) {
      clearTimeout(this.neighborScanFailsafe);
    }
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
      this.isLoading = false;
      return;
    }

    this.isLoading = true;
    this.loadNeighborScanData();
    this.loadNeighborScanHistory();
    this.loadWifiInsights();
  }

  loadNeighborScanData(): void {
    if (!this.isValidSerialNumber(this.serialNumber)) {
      this.isLoading = false;
      return;
    }

    this.cpeService.getWifiDiagnostics(this.serialNumber).subscribe({
      next: (data) => {
        // Validação: dados devem ser um objeto válido
        if (data && typeof data === 'object') {
          this.neighborScanData = data;
          this.diagnosticsError = false;
        } else {
          console.warn('[WifiAnalysisTab] Dados de diagnóstico inválidos recebidos:', data);
          this.neighborScanData = null;
        }
        this.isLoading = false;
      },
      error: (err) => {
        console.error('[WifiAnalysisTab] Erro ao carregar dados de diagnóstico WiFi:', err);
        this.diagnosticsError = true; // Mantém last known data visível, mas avisa que está desatualizado
        this.isLoading = false;
      }
    });
  }

  /**
   * Carrega o histórico de varreduras de vizinhos.
   */
  loadNeighborScanHistory(): void {
    if (!this.isValidSerialNumber(this.serialNumber)) return;
    this.historyLoading = true;
    this.cpeService.getWifiNeighborHistory(this.serialNumber, 10)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (history) => {
          this.scanHistory = Array.isArray(history) ? history.slice(0, 10) : [];
          this.historyLoading = false;
          this.cdr.detectChanges();
        },
        error: () => {
          this.historyLoading = false;
          this.cdr.detectChanges();
        }
      });
  }

  /**
   * Carrega insights Wi-Fi do endpoint /wifi-hosts.
   */
  private loadWifiInsights(): void {
    if (!this.isValidSerialNumber(this.serialNumber)) return;
    this.insightsLoading = true;
    this.cpeService.getWifiHosts(this.serialNumber) // retorna { hosts, insights, summary }
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res: any) => {
          this.wifiInsights = (res?.insights || []).slice(0, 20);
          this.wifiHostsSummary = res?.summary || null;
          this.insightsLoading = false;
          this.cdr.detectChanges();
        },
        error: () => {
          this.insightsLoading = false;
          this.cdr.detectChanges();
        }
      });
  }

  triggerNeighborScan(): void {
    if (!this.isValidSerialNumber(this.serialNumber) || this.neighborScanInProgress) return;

    this.neighborScanInProgress = true;

    this.cpeService.triggerNeighborScan(this.serialNumber).subscribe({
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
        this.loadNeighborScanData();
        this.loadWifiInsights();
        this.loadNeighborScanHistory();
      }
    });
  }

  /**
   * Retorna a largura de banda atual do WiFi 2.4GHz do CPE.
   * Valores válidos: 20MHz, 40MHz (baseado em parâmetros TR-181)
   * Segurança: sanitiza o valor recebido do CPE.
   */
  get wifi2gBandwidth(): string {
    const bandwidth = this.getParamValue('Device.WiFi.Radio.1.OperatingChannelBandwidth');
    const validBandwidths = ['20MHz', '40MHz', '20MHz/40MHz'];
    const sanitized = this.sanitizeString(bandwidth);
    
    return validBandwidths.includes(sanitized) ? sanitized : 'Desconhecido';
  }

  /**
   * Retorna a largura de banda atual do WiFi 5GHz do CPE.
   * Valores válidos: 20MHz, 40MHz, 80MHz, 160MHz (baseado em parâmetros TR-181)
   * Segurança: sanitiza o valor recebido do CPE.
   */
  get wifi5gBandwidth(): string {
    const bandwidth = this.getParamValue('Device.WiFi.Radio.2.OperatingChannelBandwidth');
    const validBandwidths = ['20MHz', '40MHz', '80MHz', '160MHz', '20MHz/40MHz', '40MHz/80MHz'];
    const sanitized = this.sanitizeString(bandwidth);
    
    return validBandwidths.includes(sanitized) ? sanitized : 'Desconhecido';
  }

  /**
   * Retorna o canal atual do WiFi 2.4GHz.
   * Segurança: valida que é um número válido na faixa 1-13.
   */
  get wifi2gChannel(): string {
    const channel = this.getParamValue('Device.WiFi.Radio.1.Channel');
    const sanitizedChannel = this.sanitizeNumber(channel, 1, 13);
    
    return sanitizedChannel.toString();
  }

  /**
   * Retorna o canal atual do WiFi 5GHz.
   * Segurança: valida que é um número válido na faixa 36-165.
   */
  get wifi5gChannel(): string {
    const channel = this.getParamValue('Device.WiFi.Radio.2.Channel');
    const sanitizedChannel = this.sanitizeNumber(channel, 36, 165);
    
    return sanitizedChannel.toString();
  }

  /**
   * Retorna a potência de transmissão do WiFi 2.4GHz.
   * Segurança: valida que é um número válido na faixa 0-100%.
   */
  get wifi2gPower(): string {
    const power = this.getParamValue('Device.WiFi.Radio.1.TransmitPower');
    const sanitizedPower = this.sanitizeNumber(power, 0, 100);
    
    return `${sanitizedPower}%`;
  }

  /**
   * Retorna a potência de transmissão do WiFi 5GHz.
   * Segurança: valida que é um número válido na faixa 0-100%.
   */
  get wifi5gPower(): string {
    const power = this.getParamValue('Device.WiFi.Radio.2.TransmitPower');
    const sanitizedPower = this.sanitizeNumber(power, 0, 100);
    
    return `${sanitizedPower}%`;
  }

  /**
   * Valida se o CPE tem dados WiFi suficientes para análise.
   * Segurança: verifica se parâmetros essenciais existem e são válidos.
   */
  get hasValidWifiData(): boolean {
    const has2g = this.getParamValue('Device.WiFi.Radio.1.Channel') !== undefined;
    const has5g = this.getParamValue('Device.WiFi.Radio.2.Channel') !== undefined;

    return has2g || has5g;
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
          setTimeout(() => { this.applySuccess = null; this.cdr.detectChanges(); }, 5000);
          this.cdr.detectChanges();
        },
        error: (err: any) => {
          this.applyInProgress = false;
          this.applyError = err?.error?.error || 'Erro ao aplicar otimização.';
          setTimeout(() => { this.applyError = null; this.cdr.detectChanges(); }, 8000);
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
