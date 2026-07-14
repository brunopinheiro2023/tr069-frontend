// Caminho: src/app/features/audit-logs/audit-logs.component.ts
// Página de visualização de logs: Audit Logs (HTTP paginado) + Server Logs (WebSocket tempo real).
// Restrito a admin/supervisor — verificado no backend e no frontend (sidebar *ngIf="isAdmin").

import {
  Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef, DestroyRef, inject,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { interval, Subscription } from 'rxjs';
import { AuditLogService } from '../../core/services/audit-log.service';
import { WebSocketService } from '../../core/services/websocket.service';
import { AuthService } from '../../core/services/auth.service';
import { ToastService } from '../../core/services/toast.service';
import {
  AuditLog, AuditLogFilters, AuditLogStats, AuditLogPaginatedResponse,
  ServerLogEntry, ServerLogLevel,
} from '../../core/models';

type Tab = 'audit' | 'server';

@Component({
  selector: 'app-audit-logs',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './audit-logs.component.html',
  styleUrls: ['./audit-logs.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AuditLogsComponent implements OnInit, OnDestroy {
  private destroyRef = inject(DestroyRef);
  private cdr = inject(ChangeDetectorRef);

  // Estado de aba ativa
  activeTab: Tab = 'audit';

  // ── Audit Logs (HTTP) ──
  auditLogs: AuditLog[] = [];
  auditLoading = false;
  auditStats: AuditLogStats | null = null;
  auditPage = 1;
  auditLimit = 50;
  auditTotal = 0;
  auditTotalPages = 0;
  autoRefresh = false;
  private autoRefreshSub?: Subscription;

  // Filtros de audit
  filterSerial = '';
  filterUsername = '';
  filterAction = '';
  filterChannel = '';
  filterResult = '';
  filterDateFrom = '';
  filterDateTo = '';

  // Opções de filtros (valores fixos do schema)
  readonly channelOptions = ['rest', 'socket', 'cwmp', 'scheduler', 'auth'];
  readonly resultOptions = ['requested', 'success', 'error', 'conflict', 'confirmed', 'inconclusive'];
  readonly actionOptions = [
    'LOGIN', 'LOGOUT', 'REBOOT', 'FACTORY_RESET', 'WIFI_OPTIMIZE',
    'SET_PARAMETER', 'GET_PARAMETER', 'CONFIG_DRIFT', 'WAN_DOWN', 'WAN_UP',
    'FIRMWARE_UPDATE', 'DIAGNOSTIC', 'BULK_REBOOT', 'BULK_FIRMWARE',
  ];

  // ── Server Logs (WebSocket tempo real) ──
  serverLogs: ServerLogEntry[] = [];
  serverLogStreaming = false;
  serverLogPaused = false;
  serverLogLevelFilter: ServerLogLevel | 'all' = 'all';
  serverLogEventFilter = '';
  private readonly MAX_SERVER_LOGS = 500;

  // Entrada expandida (detalhes)
  expandedLogId: string | null = null;
  expandedServerLogSeq: number | null = null;

  get isAdmin(): boolean { return this.authService.isAdmin(); }

  constructor(
    private auditLogService: AuditLogService,
    private wsService: WebSocketService,
    private authService: AuthService,
    private toast: ToastService,
  ) {}

  ngOnInit(): void {
    this.loadAuditLogs();
    this.loadAuditStats();
  }

  ngOnDestroy(): void {
    this.stopAutoRefresh();
    this.stopServerLogStream();
  }

  // ===========================================================================
  // AUDIT LOGS — HTTP REST com paginação e filtros
  // ===========================================================================

  /** Constrói objeto de filtros a partir dos campos do formulário */
  private buildFilters(): AuditLogFilters {
    const filters: AuditLogFilters = {
      page: this.auditPage,
      limit: this.auditLimit,
    };
    if (this.filterSerial.trim()) filters.serialNumber = this.filterSerial.trim();
    if (this.filterUsername.trim()) filters.username = this.filterUsername.trim();
    if (this.filterAction) filters.action = this.filterAction;
    if (this.filterChannel) filters.channel = this.filterChannel;
    if (this.filterResult) filters.result = this.filterResult;
    if (this.filterDateFrom) filters.dateFrom = this.filterDateFrom;
    if (this.filterDateTo) filters.dateTo = this.filterDateTo;
    return filters;
  }

  /** Carrega logs de auditoria com filtros atuais */
  loadAuditLogs(): void {
    this.auditLoading = true;
    this.auditLogService.list(this.buildFilters())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res: AuditLogPaginatedResponse) => {
          this.auditLogs = res.data;
          this.auditTotal = res.pagination.total;
          this.auditTotalPages = res.pagination.totalPages;
          this.auditLoading = false;
          this.cdr.markForCheck();
        },
        error: (err) => {
          this.auditLoading = false;
          this.toast.error('Erro ao carregar logs de auditoria.');
          this.cdr.markForCheck();
        },
      });
  }

  /** Carrega estatísticas agregadas */
  loadAuditStats(): void {
    const filters = this.buildFilters();
    delete filters.page;
    delete filters.limit;
    this.auditLogService.stats(filters)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (stats) => { this.auditStats = stats; this.cdr.markForCheck(); },
        error: () => { /* stats são opcionais — não mostrar erro */ },
      });
  }

  /** Aplica filtros e recarrega */
  applyFilters(): void {
    this.auditPage = 1;
    this.loadAuditLogs();
    this.loadAuditStats();
  }

  /** Limpa todos os filtros */
  clearFilters(): void {
    this.filterSerial = '';
    this.filterUsername = '';
    this.filterAction = '';
    this.filterChannel = '';
    this.filterResult = '';
    this.filterDateFrom = '';
    this.filterDateTo = '';
    this.auditPage = 1;
    this.loadAuditLogs();
    this.loadAuditStats();
  }

  /** Navega para página anterior */
  prevPage(): void {
    if (this.auditPage > 1) {
      this.auditPage--;
      this.loadAuditLogs();
    }
  }

  /** Navega para próxima página */
  nextPage(): void {
    if (this.auditPage < this.auditTotalPages) {
      this.auditPage++;
      this.loadAuditLogs();
    }
  }

  /** Toggle auto-refresh (polling a cada 10 segundos) */
  toggleAutoRefresh(): void {
    this.autoRefresh = !this.autoRefresh;
    if (this.autoRefresh) {
      this.startAutoRefresh();
    } else {
      this.stopAutoRefresh();
    }
  }

  private startAutoRefresh(): void {
    this.autoRefreshSub = interval(10000)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.loadAuditLogs());
  }

  private stopAutoRefresh(): void {
    this.autoRefreshSub?.unsubscribe();
    this.autoRefreshSub = undefined;
  }

  /** Expande/recolhe detalhes de um log */
  toggleLogDetails(id: string): void {
    this.expandedLogId = this.expandedLogId === id ? null : id;
  }

  /** Retorna o log atualmente expandido (ou null) */
  getExpandedLog(): AuditLog | null {
    if (!this.expandedLogId) return null;
    return this.auditLogs.find(l => l._id === this.expandedLogId) ?? null;
  }

  // ===========================================================================
  // SERVER LOGS — WebSocket tempo real
  // ===========================================================================

  /** Inicia streaming de logs do servidor via WebSocket */
  startServerLogStream(): void {
    if (this.serverLogStreaming) return;
    this.serverLogStreaming = true;
    this.serverLogPaused = false;
    this.serverLogs = [];

    // Subscreve na sala de server logs
    this.wsService.subscribeServerLogs();

    // Recebe batch inicial (histórico recente)
    this.wsService.onServerLogBatch()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((batch) => {
        this.serverLogs = batch.entries.slice(-this.MAX_SERVER_LOGS);
        this.cdr.markForCheck();
      });

    // Recebe cada nova entrada de log em tempo real
    this.wsService.onServerLog()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((entry) => {
        if (this.serverLogPaused) return;
        this.serverLogs.push(entry);
        // Ring buffer no frontend — limita a MAX_SERVER_LOGS entradas
        if (this.serverLogs.length > this.MAX_SERVER_LOGS) {
          this.serverLogs.shift();
        }
        this.cdr.markForCheck();
      });

    this.cdr.markForCheck();
  }

  /** Para streaming de logs do servidor */
  stopServerLogStream(): void {
    if (!this.serverLogStreaming) return;
    this.serverLogStreaming = false;
    this.wsService.unsubscribeServerLogs();
    this.cdr.markForCheck();
  }

  /** Pausa/recolhe streaming (não desconecta WebSocket) */
  togglePause(): void {
    this.serverLogPaused = !this.serverLogPaused;
  }

  /** Limpa logs exibidos na tela */
  clearServerLogs(): void {
    this.serverLogs = [];
  }

  /** Filtra logs por nível (aplicado no template via pipe) */
  get filteredServerLogs(): ServerLogEntry[] {
    let logs = this.serverLogs;

    // Filtro por nível
    if (this.serverLogLevelFilter !== 'all') {
      logs = logs.filter(l => l.level === this.serverLogLevelFilter);
    }

    // Filtro por texto do evento
    if (this.serverLogEventFilter.trim()) {
      const search = this.serverLogEventFilter.trim().toLowerCase();
      logs = logs.filter(l => {
        const event = String(l.data?.event || '').toLowerCase();
        return event.includes(search);
      });
    }

    return logs;
  }

  /** Expande/recolhe detalhes de um server log */
  toggleServerLogDetails(seq: number): void {
    this.expandedServerLogSeq = this.expandedServerLogSeq === seq ? null : seq;
  }

  // ===========================================================================
  // UTILS
  // ===========================================================================

  /** Troca de aba */
  switchTab(tab: Tab): void {
    this.activeTab = tab;
    if (tab === 'server' && !this.serverLogStreaming) {
      // Não inicia automaticamente — usuário clica em "Iniciar"
    }
    this.cdr.markForCheck();
  }

  /** Formata data ISO para exibição legível */
  formatDate(iso: string): string {
    if (!iso) return '—';
    const d = new Date(iso);
    return d.toLocaleString('pt-BR', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
  }

  /** Formata timestamp curto (HH:MM:SS.mmm) para server logs */
  formatTime(iso: string): string {
    if (!iso) return '—';
    const d = new Date(iso);
    return d.toLocaleTimeString('pt-BR', {
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      fractionalSecondDigits: 3,
    });
  }

  /** Classe CSS para badge de resultado */
  resultClass(result: string): string {
    switch (result) {
      case 'success': return 'badge--success';
      case 'error': return 'badge--error';
      case 'conflict': return 'badge--warning';
      case 'requested': return 'badge--info';
      case 'confirmed': return 'badge--success';
      case 'inconclusive': return 'badge--muted';
      default: return 'badge--muted';
    }
  }

  /** Classe CSS para badge de nível de log */
  levelClass(level: string): string {
    switch (level) {
      case 'error': return 'badge--error';
      case 'warn': return 'badge--warning';
      case 'info': return 'badge--info';
      case 'debug': return 'badge--muted';
      default: return 'badge--muted';
    }
  }

  /** Classe CSS para badge de canal */
  channelClass(channel: string): string {
    switch (channel) {
      case 'rest': return 'badge--info';
      case 'socket': return 'badge--success';
      case 'cwmp': return 'badge--warning';
      case 'scheduler': return 'badge--muted';
      case 'auth': return 'badge--info';
      default: return 'badge--muted';
    }
  }

  /** JSON stringify seguro para exibir detalhes */
  formatDetails(obj: any): string {
    if (!obj) return '{}';
    try {
      return JSON.stringify(obj, null, 2);
    } catch {
      return String(obj);
    }
  }

  /** TrackBy para performance da lista de audit logs */
  trackByLogId(index: number, log: AuditLog): string {
    return log._id;
  }

  /** TrackBy para performance da lista de server logs */
  trackByLogSeq(index: number, log: ServerLogEntry): number {
    return log.seq;
  }
}
