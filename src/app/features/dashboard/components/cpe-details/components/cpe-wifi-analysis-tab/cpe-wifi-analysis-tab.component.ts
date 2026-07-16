import {
  Component,
  Input,
  OnInit,
  OnDestroy,
  inject,
  ChangeDetectorRef,
  DestroyRef,
  ChangeDetectionStrategy,
} from '@angular/core';
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
import {
  CpeDevice,
  WifiInsight,
  WifiHostsData,
  WifiDiagnosticsData,
} from '@app/core/models';

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
  /** CPE está offline — bloqueia scan de vizinhos e otimização. */
  @Input() isCpeOffline: boolean = false;
  /** LOCK-1: Usuário em modo somente leitura (outro técnico é Driver). */
  @Input() isViewOnly: boolean = false;

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
  applyWaitingConfirmation = false;
  applyError: string | null = null;
  applySuccess: string | null = null;
  private applySuccessTimer?: ReturnType<typeof setTimeout>;
  private applyErrorTimer?: ReturnType<typeof setTimeout>;
  private applyFailsafe?: ReturnType<typeof setTimeout>;

  // ── Loading Coordenado ────────────────────────────────────────────────────
  private loadingCount = 0;

  private destroyRef = inject(DestroyRef);
  private cdr = inject(ChangeDetectorRef);

  constructor(
    private cpeService: CpeService,
    private wsService: WebSocketService,
  ) {}

  ngOnInit(): void {
    // Validação de entrada: serialNumber deve ser uma string não vazia
    if (!this.isValidSerialNumber(this.serialNumber)) {
      console.error(
        '[WifiAnalysisTab] Serial number inválido:',
        this.serialNumber,
      );
      this.diagnosticsError = true;
      return;
    }

    // Inscreve-se na sala da CPE para receber eventos WebSocket específicos
    this.wsService.subscribeToCpe(this.serialNumber);

    // forceRefresh=true ao abrir: bypassa cache Redis (90s) e recalcula com dados
    // atuais do MongoDB. Garante que insights reflitam o canal/bandwidth configurado
    // mais recente, mesmo se o cache Redis ainda tiver valores antigos.
    this.loadAllData(true);
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
    if (this.applyErrorTimer) clearTimeout(this.applyErrorTimer);
    if (this.applyFailsafe) clearTimeout(this.applyFailsafe);
  }

  /**
   * Valida se o serial number é válido.
   * Segurança: previne uso de serial numbers inválidos ou maliciosos.
   */
  private isValidSerialNumber(serial: string): boolean {
    return (
      typeof serial === 'string' &&
      serial.trim().length > 0 &&
      serial.length <= 64
    );
  }

  /**
   * Busca o valor de um parâmetro no array parametersCache do CPE.
   * Substitui o acesso indevido como dicionário (this.cpe.parameters[path]).
   */
  private getParamValue(path: string): string | undefined {
    const cache = this.cpe?.parametersCache;
    if (!Array.isArray(cache)) return undefined;
    return cache.find((p: { name: string; value?: string }) => p.name === path)
      ?.value;
  }

  /**
   * Carrega todos os dados da aba de análise WiFi.
   * O loading só termina quando todos os dados são carregados ou em caso de erro.
   */
  loadAllData(forceRefresh = false): void {
    if (!this.isValidSerialNumber(this.serialNumber)) {
      return;
    }

    this.loadNeighborScanData(forceRefresh);
    this.loadNeighborScanHistory();
    this.loadWifiInsights(forceRefresh);
  }

  loadNeighborScanData(forceRefresh = false): void {
    if (!this.isValidSerialNumber(this.serialNumber)) {
      return;
    }

    this.startLoading();
    this.cpeService
      .getWifiDiagnostics(this.serialNumber, forceRefresh)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (data) => {
          // Validação: dados devem ser um objeto válido
          if (data && typeof data === 'object') {
            this.neighborScanData = data;
            this.diagnosticsError = false;
          } else {
            console.warn(
              '[WifiAnalysisTab] Dados de diagnóstico inválidos recebidos:',
              data,
            );
            this.neighborScanData = null;
          }
          this.stopLoading();
        },
        error: (err) => {
          console.error(
            '[WifiAnalysisTab] Erro ao carregar dados de diagnóstico WiFi:',
            err,
          );
          this.diagnosticsError = true; // Mantém last known data visível, mas avisa que está desatualizado
          this.stopLoading();
        },
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
    this.cpeService
      .getWifiNeighborHistory(this.serialNumber, 10)
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
        },
      });
  }

  /**
   * Carrega insights Wi-Fi do endpoint /wifi-hosts.
   */
  private loadWifiInsights(forceRefresh = false): void {
    if (!this.isValidSerialNumber(this.serialNumber)) {
      return;
    }
    this.insightsLoading = true;
    this.startLoading();
    this.cpeService
      .getWifiHosts(this.serialNumber, forceRefresh) // retorna { hosts, insights, summary }
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
        },
      });
  }

  triggerNeighborScan(): void {
    if (
      !this.isValidSerialNumber(this.serialNumber) ||
      this.neighborScanInProgress
    )
      return;

    this.neighborScanInProgress = true;

    this.cpeService
      .triggerNeighborScan(this.serialNumber)
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
          console.error(
            '[WifiAnalysisTab] Erro ao acionar varredura de vizinhos:',
            err,
          );
          this.neighborScanInProgress = false;
        },
      });
  }

  setupWebSocketListeners(): void {
    this.wsSubscription = this.wsService
      .on('neighbor_scan_completed')
      .subscribe((event) => {
        // Validação de segurança: verifica estrutura do evento
        if (
          event &&
          typeof event === 'object' &&
          event.serialNumber === this.serialNumber
        ) {
          this.neighborScanInProgress = false;
          if (this.neighborScanFailsafe) {
            clearTimeout(this.neighborScanFailsafe);
          }
          // Atualiza contagem imediatamente via evento WebSocket — não espera o endpoint
          // recarregar. event.resultCount = freshResults.length (cwmpController L.2956).
          // Evita que o card mostre "0 redes" se o cache do /wifi-diagnostics ainda não expirou.
          if (typeof event.resultCount === 'number') {
            this.neighborScanData = {
              ...(this.neighborScanData || ({} as WifiDiagnosticsData)),
              neighboringWiFiResultCount: event.resultCount,
            } as WifiDiagnosticsData;
            this.cdr.markForCheck();
          }
          this.loadNeighborScanData(true);
          this.loadWifiInsights(true);
          this.loadNeighborScanHistory();
        }
      });

    // cpe_updated: emitido após SPV (mudança manual de canal/bandwidth via nosso sistema).
    // O pai cpe-details já atualiza this.cpe via mergeCpe, mas NÃO dispara recálculo dos
    // insights. Aqui detectamos mudança em wifi2g/wifi5g.channel ou .bandwidth e forçamos
    // reload com forceRefresh=true (bypassa cache Redis 90s).
    //
    // Guard !== undefined: o evento cpe_updated é emitido por múltiplas origens (SPV, GPV,
    // handleInform) com payloads parciais. O SPV handler envia wifi2g completo (com channel),
    // mas o GPV handler envia só wifi2g.bandwidth (sem channel). Sem o guard, campos
    // ausentes (undefined) no payload disparariam reloads falsos em cada Inform/GPV.
    this.wsSubscription.add(
      this.wsService.onCpeUpdated().subscribe((updatedCpe) => {
        if (!updatedCpe || updatedCpe.serialNumber !== this.serialNumber)
          return;
        const old2gCh = this.cpe?.wifi2g?.channel;
        const old5gCh = this.cpe?.wifi5g?.channel;
        const old2gBw = this.cpe?.wifi2g?.bandwidth;
        const old5gBw = this.cpe?.wifi5g?.bandwidth;
        const new2gCh = updatedCpe.wifi2g?.channel;
        const new5gCh = updatedCpe.wifi5g?.channel;
        const new2gBw = updatedCpe.wifi2g?.bandwidth;
        const new5gBw = updatedCpe.wifi5g?.bandwidth;
        const channelChanged =
          (new2gCh !== undefined && new2gCh !== old2gCh) ||
          (new5gCh !== undefined && new5gCh !== old5gCh);
        const bandwidthChanged =
          (new2gBw !== undefined && new2gBw !== old2gBw) ||
          (new5gBw !== undefined && new5gBw !== old5gBw);
        if (channelChanged || bandwidthChanged) {
          this.loadAllData(true);
        }
      }),
    );

    // Auto-otimização de canal aplicada pelo scheduler — mostra notificação visual
    // para o técnico/admin conectado, indicando que o sistema trocou o canal
    // automaticamente. Recarrega insights para refletir o novo canal.
    this.wsSubscription.add(
      this.wsService.onAutoWifiOptimizeApplied().subscribe((event) => {
        if (!event || event.serialNumber !== this.serialNumber) return;
        const channelInfo =
          event.previousChannel != null && event.newChannel != null
            ? `canal ${event.previousChannel} → ${event.newChannel}`
            : 'canal alterado';
        this.applySuccess = `Auto-otimização (${event.band}): ${channelInfo}.`;
        this.applySuccessTimer = setTimeout(() => {
          this.applySuccess = null;
          this.cdr.markForCheck();
        }, 8000);
        this.cdr.markForCheck();
        // Recarrega dados para refletir o novo canal aplicado
        this.loadAllData(true);
      }),
    );

    // Resultado da verificação pós-SPV de otimização Wi-Fi manual (REST API).
    // O backend emite este evento 30s após enfileirar o SetParameterValues,
    // verificando se a CPE aplicou o valor solicitado.
    // CRÍTICO: o loading (applyInProgress) só desliga aqui, não no POST 200.
    this.wsSubscription.add(
      this.wsService.onWifiOptimizationResult().subscribe((event) => {
        this.handleWifiOptimizationResult(event);
      }),
    );
  }

  /**
   * Helper unificado: retorna a largura de banda de uma banda (elimina duplicação wifi2g/wifi5g).
   * @param band '2.4GHz' ou '5GHz'
   */
  private getWifiBandwidth(band: '2.4GHz' | '5GHz'): string {
    const radioIdx = band === '2.4GHz' ? 1 : 2;
    const fromCache = this.getParamValue(
      `Device.WiFi.Radio.${radioIdx}.OperatingChannelBandwidth`,
    );
    const fromStruct = (
      band === '2.4GHz'
        ? this.cpe?.wifi2g?.bandwidth
        : this.cpe?.wifi5g?.bandwidth
    ) as string | undefined;
    return (
      normalizeBandwidth(fromCache) ?? normalizeBandwidth(fromStruct) ?? '—'
    );
  }

  /** Largura de banda atual do WiFi 2.4GHz. */
  get wifi2gBandwidth(): string {
    return this.getWifiBandwidth('2.4GHz');
  }
  /** Largura de banda atual do WiFi 5GHz. */
  get wifi5gBandwidth(): string {
    return this.getWifiBandwidth('5GHz');
  }

  /**
   * Helper unificado: retorna o canal de uma banda com detecção de auto mode.
   * @param band '2.4GHz' ou '5GHz'
   */
  private getWifiChannel(band: '2.4GHz' | '5GHz'): string {
    const radioIdx = band === '2.4GHz' ? 1 : 2;
    const fromCache = this.getParamValue(
      `Device.WiFi.Radio.${radioIdx}.Channel`,
    );
    const autoEnable = this.getParamValue(
      `Device.WiFi.Radio.${radioIdx}.AutoChannelEnable`,
    );
    const autoStruct = (
      band === '2.4GHz'
        ? this.cpe?.wifi2g?.autoChannelEnable
        : this.cpe?.wifi5g?.autoChannelEnable
    ) as boolean | null | undefined;
    const channel =
      fromCache ??
      String(
        band === '2.4GHz'
          ? this.cpe?.wifi2g?.channel
          : (this.cpe?.wifi5g?.channel ?? ''),
      );
    // Auto mode: canal='0'/'auto', AutoChannelEnable=true (cache ou campo estruturado)
    if (
      channel === '0' ||
      String(channel).toLowerCase() === 'auto' ||
      autoEnable === 'true' ||
      autoStruct === true
    )
      return 'Auto';
    if (!channel || channel === 'undefined') return '—';
    const num = Number(channel);
    // Fora do range (CHANNEL_RANGE centralizado) → '—' em vez de exibir valor inválido/lixo
    const range = CHANNEL_RANGE[band] || CHANNEL_RANGE['2.4GHz'];
    if (isNaN(num) || num < range.min || num > range.max) return '—';
    return num.toString();
  }

  /** Canal atual do WiFi 2.4GHz (detecta auto mode). */
  get wifi2gChannel(): string {
    return this.getWifiChannel('2.4GHz');
  }
  /** Canal atual do WiFi 5GHz (detecta auto mode). */
  get wifi5gChannel(): string {
    return this.getWifiChannel('5GHz');
  }

  /**
   * Helper unificado: indica se o rádio de uma banda está em modo automático.
   * @param band '2.4GHz' ou '5GHz'
   */
  private getWifiAutoMode(band: '2.4GHz' | '5GHz'): boolean {
    const radioIdx = band === '2.4GHz' ? 1 : 2;
    const channel = this.getParamValue(`Device.WiFi.Radio.${radioIdx}.Channel`);
    const autoEnable = this.getParamValue(
      `Device.WiFi.Radio.${radioIdx}.AutoChannelEnable`,
    );
    const autoStruct = (
      band === '2.4GHz'
        ? this.cpe?.wifi2g?.autoChannelEnable
        : this.cpe?.wifi5g?.autoChannelEnable
    ) as boolean | null | undefined;
    return (
      channel === '0' ||
      String(channel).toLowerCase() === 'auto' ||
      autoEnable === 'true' ||
      autoStruct === true
    );
  }

  /** Indica se o rádio 2.4GHz está em modo automático. */
  get wifi2gAutoMode(): boolean {
    return this.getWifiAutoMode('2.4GHz');
  }
  /** Indica se o rádio 5GHz está em modo automático. */
  get wifi5gAutoMode(): boolean {
    return this.getWifiAutoMode('5GHz');
  }

  /**
   * Helper unificado: retorna a potência de transmissão de uma banda.
   * @param band '2.4GHz' ou '5GHz'
   */
  private getWifiPower(band: '2.4GHz' | '5GHz'): string {
    const radioIdx = band === '2.4GHz' ? 1 : 2;
    const fromCache = this.getParamValue(
      `Device.WiFi.Radio.${radioIdx}.TransmitPower`,
    );
    const fromStruct =
      band === '2.4GHz' ? this.cpe?.wifi2g?.txPower : this.cpe?.wifi5g?.txPower;
    const raw =
      fromCache ?? (fromStruct != null ? String(fromStruct) : undefined);
    if (raw === undefined) return '—';
    const num = sanitizeNumber(raw, 0, 100);
    return num > 0 ? `${num}%` : '—';
  }

  /** Potência de transmissão do WiFi 2.4GHz. */
  get wifi2gPower(): string {
    return this.getWifiPower('2.4GHz');
  }
  /** Potência de transmissão do WiFi 5GHz. */
  get wifi5gPower(): string {
    return this.getWifiPower('5GHz');
  }

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
    const fromCache = this.getParamValue(
      `Device.WiFi.Radio.${radioIdx}.Channel`,
    );
    const fromStruct =
      band === '2.4GHz' ? this.cpe?.wifi2g?.channel : this.cpe?.wifi5g?.channel;
    return fromCache !== undefined || (fromStruct != null && fromStruct !== '');
  }

  /** Verifica se há dados ao vivo para a banda 2.4GHz. */
  get hasLive2gData(): boolean {
    return this.hasLiveBandData('2.4GHz');
  }
  /** Verifica se há dados ao vivo para a banda 5GHz. */
  get hasLive5gData(): boolean {
    return this.hasLiveBandData('5GHz');
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
      this.cdr.markForCheck();
    }
  }

  /**
   * Aplica recomendação de otimização Wi-Fi via endpoint /wifi-optimization.
   *
   * Loading: o overlay global é ativado automaticamente pelo loading.interceptor.ts
   * para o POST applyWifiOptimization (não tem header X-Skip-Loading). As requests
   * de refresh (loadAllData) usam X-Skip-Loading para não causar flicker do overlay.
   */
  applyWifiRecommendation(insight: WifiInsight): void {
    if (!insight?.action || this.applyInProgress) return;
    const { type, band, value } = insight.action;
    if (!type || !band || value === undefined) return;

    this.applyInProgress = true;
    this.applyWaitingConfirmation = false;
    this.applyError = null;
    this.applySuccess = null;
    this.cdr.markForCheck();

    this.cpeService
      .applyWifiOptimization(this.serialNumber, { type, band, value })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          // POST 200 = task enfileirada na CPE, NÃO confirmada.
          // Mantém applyInProgress=true e aguarda wifi_optimization_result via WS.
          // O backend verifica em 30s se a CPE aplicou o valor e emite o evento.
          this.applyWaitingConfirmation = true;
          this.applySuccess = `Otimização "${band}" enviada. Aguardando confirmação da CPE...`;
          this.cdr.markForCheck();

          // Failsafe: se o WS não emitir em 65s (30s verify + margem),
          // desliga loading e recarrega com dados disponíveis.
          if (this.applyFailsafe) clearTimeout(this.applyFailsafe);
          this.applyFailsafe = setTimeout(() => {
            if (this.applyInProgress) {
              this.applyInProgress = false;
              this.applyWaitingConfirmation = false;
              this.applySuccess = null;
              this.applyError =
                'Tempo limite aguardando confirmação da CPE. Verifique o status manualmente.';
              this.applyErrorTimer = setTimeout(() => {
                this.applyError = null;
                this.cdr.markForCheck();
              }, 8000);
              this.loadAllData(true);
              this.cdr.markForCheck();
            }
          }, 65000);
        },
        error: (err: {
          status?: number;
          error?: { error?: string; message?: string };
        }) => {
          this.applyInProgress = false;
          this.applyWaitingConfirmation = false;
          if (this.applyFailsafe) {
            clearTimeout(this.applyFailsafe);
            this.applyFailsafe = undefined;
          }
          // 409 = recomendação desatualizada — mostra mensagem completa e recarrega análise
          if (err?.status === 409) {
            this.applyError =
              err?.error?.message ||
              'Recomendação desatualizada. Recarregue a análise.';
            // Auto-recarrega para que o técnico veja a sugestão atualizada
            this.loadAllData(true);
          } else {
            this.applyError =
              err?.error?.message ||
              err?.error?.error ||
              'Erro ao aplicar otimização.';
          }
          this.applyErrorTimer = setTimeout(() => {
            this.applyError = null;
            this.cdr.markForCheck();
          }, 8000);
          this.cdr.markForCheck();
        },
      });
  }

  /**
   * Processa o resultado da otimização Wi-Fi recebido via WebSocket.
   * Chamado quando o backend emite wifi_optimization_result (30s pós-enqueue).
   */
  private handleWifiOptimizationResult(event: {
    serialNumber: string;
    type: string;
    band: string;
    expectedValue: string | number;
    actualValue: string | number;
    success: boolean;
    message: string;
  }): void {
    if (!event || event.serialNumber !== this.serialNumber) return;
    if (!this.applyInProgress) return;

    if (this.applyFailsafe) {
      clearTimeout(this.applyFailsafe);
      this.applyFailsafe = undefined;
    }

    this.applyInProgress = false;
    this.applyWaitingConfirmation = false;

    if (event.success) {
      this.applySuccess = `Otimização "${event.band}" confirmada pela CPE.`;
      this.applySuccessTimer = setTimeout(() => {
        this.applySuccess = null;
        this.cdr.markForCheck();
      }, 5000);
      // Recarrega análise com dados frescos — CPE já aplicou o novo valor.
      // forceRefresh=true para bypassar cache Redis (TTL 90s) que ainda teria o canal antigo.
      this.loadAllData(true);
    } else {
      this.applyError =
        event.message || 'CPE não aplicou a otimização solicitada.';
      this.applyErrorTimer = setTimeout(() => {
        this.applyError = null;
        this.cdr.markForCheck();
      }, 8000);
    }
    this.cdr.markForCheck();
  }

  /**
   * Filtra apenas insights NÃO-actionable (sinal, QoE, SNR, throughput, ruído).
   * Insights actionable (canal, largura, potência) são exibidos no card de otimização
   * (neighbor-scan-card) para centralizar as sugestões aplicáveis em um único lugar.
   */
  get nonActionableInsights(): WifiInsight[] {
    return (this.wifiInsights || []).filter((i) => !i?.actionable);
  }

  /**
   * Helpers para o template de insights.
   */
  insightSeverityClass(severity: string): string {
    if (severity === 'critical')
      return 'border-red-400 bg-red-50 dark:bg-red-900/20';
    if (severity === 'warning')
      return 'border-yellow-400 bg-yellow-50 dark:bg-yellow-900/20';
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
    return d.toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  }
}
