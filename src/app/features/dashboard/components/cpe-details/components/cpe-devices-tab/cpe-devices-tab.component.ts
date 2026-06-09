// Caminho do arquivo: frontend/src/app/features/dashboard/components/cpe-details/components/cpe-devices-tab/cpe-devices-tab.component.ts

import { Component, Input, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subscription } from 'rxjs';
import { CpeService } from '../../../../../../core/services/cpe.service';
import { WebSocketService } from '../../../../../../core/services/websocket.service';
import { ButtonComponent } from '../../../../../../core/components/button/button.component';
import { SkeletonComponent } from '../../../../../../core/components/skeleton/skeleton.component';
import { ConnectedDevicesData, WifiHost, EthernetDevice } from '../../../../../../core/models';

/**
 * Componente da aba "Dispositivos Conectados".
 * Exibe todos os dispositivos conectados à CPE (Wi-Fi + Ethernet cabo).
 *
 * REGRAS DE NEGÓCIO:
 *   1. Auto-refresh on-demand: só é executado quando o técnico ESTÁ nesta aba.
 *   2. Ao sair da aba (ngOnDestroy), o auto-refresh é encerrado.
 *   3. WebSocket wifi_data_refreshed atualiza a tabela automaticamente.
 *   4. O técnico é informado visualmente da frequência do monitoramento (60s).
 */
@Component({
  selector: 'app-cpe-devices-tab',
  standalone: true,
  imports: [CommonModule, ButtonComponent, SkeletonComponent],
  templateUrl: './cpe-devices-tab.component.html',
  styleUrls: ['./cpe-devices-tab.component.scss']
})
export class CpeDevicesTabComponent implements OnInit, OnDestroy {
  @Input() serialNumber: string = '';

  // Dados de dispositivos
  devicesData: ConnectedDevicesData | null = null;

  // Estados de UI
  isLoading: boolean = false;
  refreshing: boolean = false;

  /** Indica que há uma atualização em andamento em background (não bloqueia a tabela). */
  backgroundRefreshing: boolean = false;

  // Feedback ao usuário (toast inline)
  feedbackMessage: string = '';
  feedbackType: 'success' | 'error' | 'info' = 'info';

  // Contador regressivo para próximo auto-refresh (exibido ao técnico)
  nextRefreshInSeconds: number = 60;
  private countdownInterval: any;

  // ── MEDIÇÃO DE TEMPO DE RESPOSTA DA CPE ────────────────────────────────
  /** Timestamp (ms) quando o refresh foi solicitado. */
  private refreshStartTime: number | null = null;
  /** Duração da última resposta da CPE em milissegundos. */
  lastRefreshDurationMs: number | null = null;
  /** Horário da última atualização bem-sucedida. */
  lastRefreshAt: Date | null = null;
  /** Quantidade de retentativas realizadas na última rodada. */
  refreshRetryCount: number = 0;

  // ── RETRY COM BACKOFF EXPONENCIAL ──────────────────────────────────────
  /** Timeout de retry agendado (para poder cancelar em ngOnDestroy). */
  private retryTimeout: any;
  /** Timeout de failsafe para forçar fim do estado refreshing. */
  private refreshFailsafeTimeout: any;

  // Subscriptions
  private wsRefreshSub!: Subscription;
  private hostsRefreshInterval: any;

  /** Intervalo de auto-refresh em milissegundos: 60 segundos. */
  private readonly AUTO_REFRESH_MS = 60_000;

  constructor(
    private cpeService: CpeService,
    private wsService: WebSocketService
  ) {}

  ngOnInit(): void {
    // Carrega dados iniciais
    this.loadConnectedDevices();
    // Ouve evento WebSocket de refresh Wi-Fi
    this.listenWifiDataRefreshed();
    // Inicia auto-refresh on-demand (só roda enquanto nesta aba)
    this.startHostsAutoRefresh();
    // Inicia contador regressivo visível ao técnico
    this.startCountdownTimer();
  }

  ngOnDestroy(): void {
    // ENCERRA tudo ao sair da aba — isso é o requisito principal
    this.stopHostsAutoRefresh();
    this.stopCountdownTimer();
    if (this.wsRefreshSub) this.wsRefreshSub.unsubscribe();
    if (this.retryTimeout) { clearTimeout(this.retryTimeout); this.retryTimeout = null; }
    if (this.refreshFailsafeTimeout) { clearTimeout(this.refreshFailsafeTimeout); this.refreshFailsafeTimeout = null; }
  }

  // ── CARREGAMENTO DE DADOS ────────────────────────────────────────────────

  /**
   * Busca todos os dispositivos conectados (Wi-Fi + Ethernet) do backend.
   * Fonte: parâmetros já no MongoDB.
   */
  loadConnectedDevices(): void {
    if (!this.serialNumber) return;
    this.isLoading = true;
    this.clearFeedback();

    this.cpeService.getConnectedDevices(this.serialNumber).subscribe({
      next: (data) => {
        this.devicesData = data;
        this.isLoading = false;
      },
      error: () => {
        this.setFeedback('Erro ao carregar dispositivos conectados.', 'error');
        this.isLoading = false;
      }
    });
  }

  /**
   * Solicita leitura SOB DEMANDA dos parâmetros Wi-Fi diretamente na CPE.
   * O backend enfileira GetParameterValues e dispara Connection Request.
   * Quando a CPE responder, o WebSocket wifi_data_refreshed atualiza a tabela.
   *
   * LÓGICA DE GARANTIA:
   *   1. Sempre exibe os dados do MongoDB primeiro (fallback imediato).
   *   2. Dispara o refresh em background (não bloqueia a tabela).
   *   3. Mede o tempo de resposta da CPE.
   *   4. Se a CPE não responder em 30s, agenda retry com backoff (15s → 30s → 60s).
   *   5. Após 3 tentativas, usa os dados do cache e informa o técnico.
   */
  refreshDevicesData(): void {
    if (!this.serialNumber) return;
    if (this.refreshing || this.backgroundRefreshing) return;

    this.doRefreshAttempt(0);
  }

  /**
   * Executa uma tentativa de refresh com medição de tempo.
   * @param attempt Número da tentativa (0 = primeira, 1 = retry 1, etc.)
   */
  private doRefreshAttempt(attempt: number): void {
    if (!this.serialNumber) return;

    this.refreshing = true;
    this.backgroundRefreshing = true;
    this.refreshStartTime = Date.now();
    this.refreshRetryCount = attempt;
    this.clearFeedback();

    // Cancela failsafe anterior se houver
    if (this.refreshFailsafeTimeout) { clearTimeout(this.refreshFailsafeTimeout); }

    this.cpeService.getWifiDiagnostics(this.serialNumber, true).subscribe({
      next: (res: any) => {
        if (attempt === 0) {
          this.setFeedback('Atualização solicitada. Aguardando a CPE responder...', 'info');
        } else {
          this.setFeedback(`Retentativa ${attempt}/3 solicitada. Aguardando CPE...`, 'info');
        }

        // Failsafe: se a CPE não responder em 30s, tenta novamente
        this.refreshFailsafeTimeout = setTimeout(() => {
          this.handleRefreshTimeout(attempt);
        }, 30_000);
      },
      error: (err: any) => {
        this.refreshing = false;
        if (err.status === 409) {
          this.setFeedback('Uma atualização já está em andamento na fila da CPE. Aguarde...', 'info');
          this.backgroundRefreshing = false;
        } else {
          this.setFeedback('Erro ao solicitar atualização. Usando dados do cache.', 'error');
          this.backgroundRefreshing = false;
        }
      }
    });
  }

  /**
   * Chamado quando o failsafe de 30s dispara (CPE não respondeu).
   * Agenda retry com backoff exponencial ou desiste após 3 tentativas.
   */
  private handleRefreshTimeout(attempt: number): void {
    if (!this.refreshing) return; // já foi resolvido pelo WebSocket

    const nextAttempt = attempt + 1;
    if (nextAttempt > 3) {
      // Desiste após 3 tentativas (total ~ 105s)
      this.refreshing = false;
      this.backgroundRefreshing = false;
      this.setFeedback('A CPE não respondeu após 3 tentativas. Dados do cache em exibição.', 'error');
      return;
    }

    // Backoff: 15s, 30s, 60s
    const backoffDelays = [15_000, 30_000, 60_000];
    const delay = backoffDelays[attempt] || 60_000;

    this.refreshing = false; // libera para nova tentativa
    this.setFeedback(`CPE lenta. Nova tentativa em ${delay / 1000}s...`, 'info');

    this.retryTimeout = setTimeout(() => {
      this.doRefreshAttempt(nextAttempt);
    }, delay);
  }

  // ── AUTO-REFRESH (ON-DEMAND) ───────────────────────────────────────────

  /**
   * Inicia o auto-refresh de dispositivos a cada 60 segundos.
   * Só é executado enquanto o técnico está nesta aba (Dispositivos Conectados).
   * Chama refreshWifiData (acorda a CPE + GetParameterValues inclui Device.Hosts.)
   * e ignora conflitos 409 (refresh já em andamento).
   * SEGURO: sempre limpa o intervalo anterior antes de criar um novo.
   */
  private startHostsAutoRefresh(): void {
    this.stopHostsAutoRefresh();
    this.hostsRefreshInterval = setInterval(() => {
      if (!this.serialNumber || this.refreshing) return;
      this.cpeService.getWifiDiagnostics(this.serialNumber, true).subscribe({
        error: () => { /* ignora 409 e erros de rede sem exibir feedback */ }
      });
      // Reseta contador regressivo
      this.nextRefreshInSeconds = 60;
    }, this.AUTO_REFRESH_MS);
  }

  /**
   * Encerra o auto-refresh. Chamado em ngOnDestroy quando o técnico sai da aba.
   */
  private stopHostsAutoRefresh(): void {
    if (this.hostsRefreshInterval) {
      clearInterval(this.hostsRefreshInterval);
      this.hostsRefreshInterval = null;
    }
  }

  // ── CONTADOR REGRESSIVO (VISÍVEL AO TÉCNICO) ─────────────────────────────

  /**
   * Inicia um timer que decrementa a cada 1 segundo, mostrando ao técnico
   * quantos segundos faltam para o próximo auto-refresh.
   */
  private startCountdownTimer(): void {
    this.stopCountdownTimer();
    this.countdownInterval = setInterval(() => {
      this.nextRefreshInSeconds--;
      if (this.nextRefreshInSeconds <= 0) {
        this.nextRefreshInSeconds = 60;
      }
    }, 1_000);
  }

  private stopCountdownTimer(): void {
    if (this.countdownInterval) {
      clearInterval(this.countdownInterval);
      this.countdownInterval = null;
    }
  }

  // ── WEBSOCKET ───────────────────────────────────────────────────────────

  /**
   * Ouve o evento 'wifi_data_refreshed' emitido pelo backend quando a CPE
   * responde ao GetParameterValues solicitado pelo refreshWifiData.
   * Atualiza a tabela automaticamente em tempo real.
   * MEDE o tempo de resposta da CPE e exibe ao técnico.
   */
  private listenWifiDataRefreshed(): void {
    if (!this.serialNumber) return;
    this.wsRefreshSub = this.wsService.onWifiDataRefreshed().subscribe({
      next: (evt) => {
        if (evt.serialNumber === this.serialNumber) {
          // Cancela failsafe e retry pendentes
          if (this.refreshFailsafeTimeout) { clearTimeout(this.refreshFailsafeTimeout); this.refreshFailsafeTimeout = null; }
          if (this.retryTimeout) { clearTimeout(this.retryTimeout); this.retryTimeout = null; }

          // Calcula tempo de resposta
          if (this.refreshStartTime) {
            this.lastRefreshDurationMs = Date.now() - this.refreshStartTime;
            this.lastRefreshAt = new Date();
          }
          this.refreshing = false;
          this.backgroundRefreshing = false;
          this.refreshRetryCount = 0;

          const durationSec = this.lastRefreshDurationMs ? (this.lastRefreshDurationMs / 1000).toFixed(1) : '?';
          this.setFeedback(`Dados atualizados em tempo real. Resposta da CPE: ${durationSec}s.`, 'success');
          this.loadConnectedDevices();
        }
      }
    });
  }

  // ── HELPERS DE FEEDBACK ─────────────────────────────────────────────────

  private setFeedback(message: string, type: 'success' | 'error' | 'info'): void {
    this.feedbackMessage = message;
    this.feedbackType = type;
    setTimeout(() => this.clearFeedback(), 5_000);
  }

  private clearFeedback(): void {
    this.feedbackMessage = '';
  }

  // ── HELPERS DE DADOS ────────────────────────────────────────────────────

  /** Conta dispositivos Wi-Fi ativos (não inativos). */
  get activeWifiCount(): number {
    return this.devicesData?.wifiDevices?.filter(d => d.status !== 'inativo').length || 0;
  }

  /** Conta dispositivos Ethernet ativos. */
  get activeEthernetCount(): number {
    return this.devicesData?.ethernetDevices?.filter(d => d.active).length || 0;
  }

  /** Retorna uma string legível do tempo de resposta da CPE. */
  get lastRefreshDurationText(): string {
    if (!this.lastRefreshDurationMs) return '';
    const s = this.lastRefreshDurationMs / 1000;
    return s < 60 ? `${s.toFixed(1)}s` : `${Math.floor(s / 60)}m ${(s % 60).toFixed(0)}s`;
  }

  /** Retorna uma string legível do horário da última atualização. */
  get lastRefreshAtText(): string {
    if (!this.lastRefreshAt) return '';
    return this.lastRefreshAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }
}
