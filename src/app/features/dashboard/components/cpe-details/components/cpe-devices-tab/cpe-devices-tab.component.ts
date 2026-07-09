// Caminho do arquivo: frontend/src/app/features/dashboard/components/cpe-details/components/cpe-devices-tab/cpe-devices-tab.component.ts

import { Component, Input, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subscription, EMPTY, timer } from 'rxjs';
import { switchMap, filter, take, timeout, retry, catchError } from 'rxjs/operators';
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
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, ButtonComponent, SkeletonComponent],
  templateUrl: './cpe-devices-tab.component.html',
  styleUrls: ['./cpe-devices-tab.component.scss']
})
export class CpeDevicesTabComponent implements OnInit, OnDestroy {
  @Input() serialNumber: string = '';
  /** CPE está offline — bloqueia refresh de dispositivos (requer comunicação CWMP). */
  @Input() isCpeOffline: boolean = false;
  /** LOCK-1: Usuário em modo somente leitura (outro técnico é Driver). */
  @Input() isViewOnly: boolean = false;

  // Dados de dispositivos
  devicesData: ConnectedDevicesData | null = null;

  // Estados de UI
  isLoading: boolean = false;
  refreshing: boolean = false;

  // Paginação
  currentPage: number = 1;
  itemsPerPage: number = 50;
  totalPages: number = 1;

  /** Indica que há uma atualização em andamento em background (não bloqueia a tabela). */
  backgroundRefreshing: boolean = false;

  // Feedback ao usuário (toast inline)
  feedbackMessage: string = '';
  feedbackType: 'success' | 'error' | 'info' = 'info';

  // Contador regressivo para próximo auto-refresh (exibido ao técnico)
  nextRefreshInSeconds: number = 60;
  private countdownInterval: ReturnType<typeof setInterval> | null = null;

  // ── MEDIÇÃO DE TEMPO DE RESPOSTA DA CPE ────────────────────────────────
  /**
   * Timestamp (ms) quando o refresh MANUAL foi solicitado.
   * Resetado para null ao concluir/falhar — garante que o auto-refresh (que
   * NÃO seta este campo) não compute duração errada baseada num refresh
   * manual anterior. Apenas refreshs manuais medem tempo de resposta.
   */
  private refreshStartTime: number | null = null;
  /** Duração da última resposta da CPE em milissegundos. */
  lastRefreshDurationMs: number | null = null;
  /** Horário da última atualização bem-sucedida. */
  lastRefreshAt: Date | null = null;
  /** Quantidade de retentativas realizadas na última rodada. */
  refreshRetryCount: number = 0;

  // ── RETRY COM BACKOFF EXPONENCIAL (pipeline RxJS) ──────────────────────
  /** Subscription do pipeline de refresh+retry ativo (cancelável em ngOnDestroy). */
  private refreshSub?: Subscription;
  private readonly RETRY_BACKOFF_MS = [15_000, 30_000, 60_000];
  private readonly RESPONSE_TIMEOUT_MS = 30_000;
  private readonly MAX_RETRIES = 3;

  /** Timeout do toast de feedback (para poder cancelar em ngOnDestroy). */
  private feedbackTimeout: ReturnType<typeof setTimeout> | null = null;

  // Subscriptions — todas trackeadas para cleanup centralizado em ngOnDestroy.
  private wsRefreshSub!: Subscription;
  private httpSubs = new Subscription();
  private hostsRefreshInterval: ReturnType<typeof setInterval> | null = null;

  /** Intervalo de auto-refresh em milissegundos: 60 segundos. */
  private readonly AUTO_REFRESH_MS = 60_000;

  constructor(
    private cpeService: CpeService,
    private wsService: WebSocketService,
    private cdr: ChangeDetectorRef
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
    if (this.refreshSub) this.refreshSub.unsubscribe();
    this.httpSubs.unsubscribe();
    if (this.feedbackTimeout) { clearTimeout(this.feedbackTimeout); this.feedbackTimeout = null; }
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

    const sub = this.cpeService.getConnectedDevices(this.serialNumber, this.currentPage, this.itemsPerPage).subscribe({
      next: (data) => {
        this.devicesData = data;
        this.totalPages = data.pagination?.pages || 1;
        this.isLoading = false;
        this.cdr.markForCheck();
      },
      error: () => {
        this.setFeedback('Erro ao carregar dispositivos conectados.', 'error');
        this.isLoading = false;
        this.cdr.markForCheck();
      }
    });
    this.httpSubs.add(sub);
  }

  /**
   * Recarrega os dados SEM acionar o skeleton de loading — usado quando o
   * WebSocket avisa que a CPE respondeu, para atualizar a tabela em tempo
   * real sem apagar a tabela já renderizada (evita flicker).
   *
   * CRÍTICO: usa forceRefresh=true para bypassar o cache de 30s do CpeService.
   * Sem isso, se a CPE responder em <30s (caso comum), o cache serviria dados
   * stale e a tabela "atualizada em tempo real" não mudaria — feedback verde
   * com dados antigos.
   */
  private reloadDevicesDataSilently(): void {
    if (!this.serialNumber) return;
    const sub = this.cpeService.getConnectedDevices(this.serialNumber, this.currentPage, this.itemsPerPage, true).subscribe({
      next: (data) => {
        this.devicesData = data;
        this.totalPages = data.pagination?.pages || 1;
        this.cdr.markForCheck();
      },
      error: () => { /* mantém os dados já exibidos em tela silenciosamente */ }
    });
    this.httpSubs.add(sub);
  }

  nextPage(): void {
    if (this.currentPage < this.totalPages) {
      this.currentPage++;
      this.loadConnectedDevices();
    }
  }

  prevPage(): void {
    if (this.currentPage > 1) {
      this.currentPage--;
      this.loadConnectedDevices();
    }
  }

  /**
   * Solicita leitura SOB DEMANDA dos parâmetros Wi-Fi diretamente na CPE.
   * O backend enfileira GetParameterValues e dispara Connection Request.
   * Quando a CPE responder, o WebSocket wifi_data_refreshed atualiza a tabela
   * (via listenWifiDataRefreshed, que roda durante todo o ciclo de vida do componente).
   *
   * LÓGICA DE GARANTIA (pipeline RxJS único, cancelável via this.refreshSub):
   *   1. Sempre exibe os dados do MongoDB primeiro (fallback imediato).
   *   2. Dispara o refresh em background (não bloqueia a tabela).
   *   3. Se a CPE não responder em 30s, o retry re-executa a chamada com backoff (15s → 30s → 60s).
   *   4. Após 3 tentativas, desiste e informa o técnico — dados do cache continuam em exibição.
   */
  refreshDevicesData(): void {
    if (!this.serialNumber) return;
    if (this.refreshing || this.backgroundRefreshing) return;

    this.refreshing = true;
    this.backgroundRefreshing = true;
    this.refreshStartTime = Date.now();
    this.refreshRetryCount = 0;
    this.nextRefreshInSeconds = this.AUTO_REFRESH_MS / 1000; // reseta o countdown visível
    this.clearFeedback();
    this.setFeedback('Atualização solicitada. Aguardando a CPE responder...', 'info');

    this.refreshSub?.unsubscribe();
    this.refreshSub = this.cpeService.refreshWifiHosts(this.serialNumber).pipe(
      // Erros da chamada HTTP inicial (ex: 409 já em andamento) não devem entrar no retry.
      catchError((err: any) => {
        this.refreshing = false;
        this.backgroundRefreshing = false;
        this.refreshStartTime = null; // descarta medição — não houve resposta da CPE
        if (err?.status === 409) {
          this.setFeedback('Uma atualização já está em andamento na fila da CPE. Aguarde...', 'info');
        } else {
          this.setFeedback('Erro ao solicitar atualização. Usando dados do cache.', 'error');
        }
        this.cdr.markForCheck();
        return EMPTY;
      }),
      // Espera o evento WS específico desta CPE; timeout de 30s dispara o retry.
      switchMap(() => this.wsService.onWifiDataRefreshed().pipe(
        filter(evt => evt.serialNumber === this.serialNumber),
        take(1),
        timeout(this.RESPONSE_TIMEOUT_MS)
      )),
      retry({
        count: this.MAX_RETRIES,
        delay: (_err, retryCount) => {
          this.refreshRetryCount = retryCount;
          const delayMs = this.RETRY_BACKOFF_MS[retryCount - 1] ?? 60_000;
          this.setFeedback(`CPE lenta. Nova tentativa ${retryCount}/${this.MAX_RETRIES} em ${delayMs / 1000}s...`, 'info');
          this.cdr.markForCheck();
          return timer(delayMs);
        }
      }),
      catchError(() => {
        this.setFeedback('A CPE não respondeu após 3 tentativas. Dados do cache em exibição.', 'error');
        this.refreshing = false;
        this.backgroundRefreshing = false;
        this.refreshStartTime = null; // descarta medição — CPE não respondeu
        this.cdr.markForCheck();
        return EMPTY;
      })
    ).subscribe(() => {
      // Sucesso: o próprio listenWifiDataRefreshed já tratou o reload dos dados
      // e a medição de tempo (lastRefreshDurationMs). Aqui apenas garante o estado.
      this.refreshing = false;
      this.backgroundRefreshing = false;
      this.refreshStartTime = null; // medição já consumida por listenWifiDataRefreshed
      this.cdr.markForCheck();
    });
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
      // backgroundRefreshing cobre a janela em que refreshing já foi liberado
      // pelo pipeline de retry mas ainda há uma tentativa aguardando resposta da CPE.
      if (!this.serialNumber || this.refreshing || this.backgroundRefreshing) return;
      // refreshWifiHosts é mais leve — não computa insights/congestionamento que esta aba não usa
      const sub = this.cpeService.refreshWifiHosts(this.serialNumber).subscribe({
        error: () => { /* ignora 409 e erros de rede sem exibir feedback */ }
      });
      this.httpSubs.add(sub);
      // Reseta contador regressivo sincronizado com o disparo real do auto-refresh
      this.nextRefreshInSeconds = this.AUTO_REFRESH_MS / 1000;
      this.cdr.markForCheck();
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
        this.nextRefreshInSeconds = this.AUTO_REFRESH_MS / 1000;
      }
      this.cdr.markForCheck();
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
   * responde ao GetParameterValues solicitado pelo refreshWifiHosts.
   * Atualiza a tabela automaticamente em tempo real.
   *
   * DISTINÇÃO manual vs auto-refresh:
   *   - Manual (refreshStartTime setado): mede tempo de resposta + exibe toast
   *     de sucesso com a duração.
   *   - Auto-refresh (refreshStartTime null): recarrega silenciosamente, sem
   *     toast — evita poluir a UI com um toast a cada 60s.
   */
  private listenWifiDataRefreshed(): void {
    if (!this.serialNumber) return;
    this.wsRefreshSub = this.wsService.onWifiDataRefreshed().subscribe({
      next: (evt) => {
        if (evt.serialNumber !== this.serialNumber) return;

        const isManualRefresh = this.refreshStartTime !== null;
        // Calcula tempo de resposta APENAS em refresh manual (auto-refresh não
        // seta refreshStartTime — sem isso a duração seria o tempo desde o
        // último manual, podendo ser vários minutos, valor enganoso).
        if (isManualRefresh) {
          this.lastRefreshDurationMs = Date.now() - (this.refreshStartTime as number);
          this.lastRefreshAt = new Date();
        }
        this.refreshing = false;
        this.backgroundRefreshing = false;
        this.refreshRetryCount = 0;

        if (isManualRefresh) {
          const durationSec = this.lastRefreshDurationMs ? (this.lastRefreshDurationMs / 1000).toFixed(1) : '?';
          this.setFeedback(`Dados atualizados em tempo real. Resposta da CPE: ${durationSec}s.`, 'success');
          // SINCRONIZAÇÃO: reinicia auto-refresh + countdown para alinhar o
          // contador visível com o próximo disparo real do intervalo. Sem isso,
          // o countdown diria "60s" mas o auto-refresh poderia disparar em
          // qualquer momento (intervalo original não foi reiniciado).
          this.nextRefreshInSeconds = this.AUTO_REFRESH_MS / 1000;
          this.startHostsAutoRefresh();
        }
        this.reloadDevicesDataSilently();
        this.cdr.markForCheck();
      }
    });
  }

  // ── HELPERS DE FEEDBACK ─────────────────────────────────────────────────

  private setFeedback(message: string, type: 'success' | 'error' | 'info'): void {
    if (this.feedbackTimeout) { clearTimeout(this.feedbackTimeout); }
    this.feedbackMessage = message;
    this.feedbackType = type;
    this.cdr.markForCheck();
    this.feedbackTimeout = setTimeout(() => this.clearFeedback(), 5_000);
  }

  private clearFeedback(): void {
    this.feedbackMessage = '';
    this.cdr.markForCheck();
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

  /** trackBy por MAC — evita recriar as linhas da tabela a cada refresh de 60s (OnPush + *ngFor). */
  trackByMac(_index: number, item: WifiHost | EthernetDevice): string {
    return item.macAddress;
  }
}
