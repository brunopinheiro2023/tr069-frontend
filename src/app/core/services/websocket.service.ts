import { Injectable, NgZone } from '@angular/core';
import { io, Socket } from 'socket.io-client';
import { Observable, share } from 'rxjs';
import { environment } from '../../../environments/environment';
import { Router } from '@angular/router';

@Injectable({
  providedIn: 'root'
})
export class WebSocketService {
  private socket: Socket;
  private sessionId: string; // Identidade resiliente para tolerar reconexões
  private activeRooms = new Set<string>();
  private pendingRooms = new Set<string>(); // Salas solicitadas antes da conexão estabelecida

  // Contagem de referências por sala: permite que múltiplos componentes compartilhem
  // a mesma inscrição CPE sem que um ngOnDestroy filho destrua a sala para os outros.
  private roomRefCount = new Map<string, number>();

  // Map para gerenciar Observables e evitar memory leaks reaproveitando conexões
  private observablesMap = new Map<string, Observable<any>>();

  constructor(private zone: NgZone, private router: Router) {
    // Gera sessionId único por instância (aba do navegador) usando fallback matemático
    // Funciona em HTTP sem TLS (Web Crypto API bloqueada fora de HTTPS)
    this.sessionId = this.generateSessionId();

    // SEGURANÇA: envia token JWT fresco e sessionId estático a cada (re)conexão
    this.socket = io(environment.wsUrl, {
      transports: ['websocket'],
      auth: (cb) => {
        const token = localStorage.getItem('jwt_token');
        const username = localStorage.getItem('username') || 'unknown';
        cb({ token: token || '', sessionId: this.sessionId, username });
      }
    });

    this.socket.on('connect', () => {
      console.log('Conectado ao WebSocket do Servidor ACS.');
      // Reemite inscrições pendentes que foram solicitadas antes da conexão.
      this.flushPendingRooms();
      // Reemite heartbeat imediatamente na reconexão para evitar perder lock
      this.reemitHeartbeatOnReconnect();
    });

    // Monitora falhas de autenticação em tempo real
    this.socket.on('connect_error', (err) => {
      if (err.message === 'INVALID_TOKEN' || err.message === 'UNAUTHENTICATED' || err.message === 'TOKEN_EXPIRED') {
        console.error('Sessão WebSocket bloqueada: Token JWT expirado ou ausente.');
        // Limpa tokens e redireciona para login
        localStorage.removeItem('jwt_token');
        localStorage.removeItem('username');
        this.zone.run(() => {
          this.router.navigate(['/login']);
        });
      }
    });

    // Listener global para erros de middleware (RBAC, expiração)
    this.socket.on('error', (err) => {
      if (err === 'TOKEN_EXPIRED' || err === 'INVALID_TOKEN') {
        console.error('Sessão expirada pelo middleware WebSocket.');
        localStorage.removeItem('jwt_token');
        localStorage.removeItem('username');
        this.zone.run(() => {
          this.router.navigate(['/login']);
        });
      }
    });
  }

  /** Reemite heartbeat para todas as CPEs ativas na reconexão */
  private reemitHeartbeatOnReconnect(): void {
    if (this.activeRooms.size === 0) return;
    for (const room of this.activeRooms) {
      if (room === 'all_cpes') {
        this.socket.emit('subscribe_all_cpes');
      } else if (room.startsWith('cpe_')) {
        this.socket.emit('subscribe_cpe', { serialNumber: room.slice(4) });
      }
    }
  }

  /**
   * Envia inscrições pendentes que foram solicitadas antes do socket conectar.
   * Isso evita que o técnico entre na tela de CPE antes do WS estar pronto e
   * nunca receba eventos específicos da CPE (config_success, cpe_updated).
   */
  private flushPendingRooms(): void {
    if (this.pendingRooms.size === 0) return;
    for (const room of this.pendingRooms) {
      this.activeRooms.add(room);
      if (room === 'all_cpes') {
        this.socket.emit('subscribe_all_cpes');
      } else if (room.startsWith('cpe_')) {
        this.socket.emit('subscribe_cpe', { serialNumber: room.slice(4) });
      }
    }
    this.pendingRooms.clear();
  }

  /** Gera sessionId UUID v4 com fallback matemático (funciona em HTTP sem TLS) */
  private generateSessionId(): string {
    return 'xxxx-4xxx-yxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    });
  }

  // Delega o repasse para o método genérico 'on'
  onCpeUpdated(): Observable<any> { return this.on('cpe_updated'); }
  onCpeOnline(): Observable<any> { return this.on('cpe_online'); }
  onCpeBatchUpdate(): Observable<{ eventName: string; items: any[]; count: number }> { return this.on('cpe_batch_update'); }
  onConfigSuccess(): Observable<any> { return this.on('config_success'); }
  onWifiDiagnosticsUpdate(): Observable<any> { return this.on('wifi_diagnostics_update'); }
  onWifiDataRefreshed(): Observable<{ serialNumber: string; timestamp: string }> { return this.on('wifi_data_refreshed'); }
  onNeighborScanCompleted(): Observable<{ serialNumber: string; timestamp: string }> { return this.on('neighbor_scan_completed'); }
  onCpeAccessDenied(): Observable<{ serialNumber: string; lockedBy: string; lockedAt: string; lockedMinutes: number }> { return this.on('cpe_access_denied'); }
  onCpeAccessGranted(): Observable<{ serialNumber: string; isDriver: boolean }> { return this.on('cpe_access_granted'); }
  onPresenceConflict(): Observable<{ serialNumber: string; driver: string; message: string }> { return this.on('presence_conflict'); }
  onDriverPromoted(): Observable<{ serialNumber: string; newDriver: string }> { return this.on('driver_promoted'); }
  onDriverAcquired(): Observable<{ serialNumber: string; username: string }> { return this.on('driver_acquired'); }
  onViewOnly(): Observable<{ serialNumber: string; driver: string; message: string }> { return this.on('view_only'); }
  onForceViewOnly(): Observable<{ serialNumber: string; message: string }> { return this.on('force_view_only'); }
  onDriverReleased(): Observable<{ serialNumber: string }> { return this.on('driver_released'); }
  onViewersUpdated(): Observable<{ serialNumber: string; viewers: string[] }> { return this.on('viewers_updated'); }
  onCpeLocked(): Observable<{ serialNumber: string; source: string }> { return this.on('cpe_locked'); }
  onCpeUnlocked(): Observable<{ serialNumber: string }> { return this.on('cpe_unlocked'); }
  onCpeValueChange(): Observable<{ serialNumber: string; changeType: string; changedParams: Array<{ name: string; value: string }>; timestamp: string }> { return this.on('cpe_value_change'); }
  onTelemetryStarted(): Observable<{ serialNumber: string; requestedBy: string; message: string }> { return this.on('telemetry_started'); }
  onTelemetryUpdate(): Observable<{ serialNumber: string; data: any; timestamp: string }> { return this.on('telemetry_update'); }
  onTelemetryProgress(): Observable<{ serialNumber: string; completedChunks: number; totalChunks: number; percent: number; partial?: boolean; faultCode?: number }> { return this.on('telemetry_progress'); }
  onTelemetryComplete(): Observable<{ serialNumber: string; timestamp: string; totalChunks: number; source?: string; partial?: boolean }> { return this.on('telemetry_complete'); }
  onTelemetryAlert(): Observable<{ serialNumber: string; metric: string; severity: 'warning' | 'critical'; value: number; message: string; timestamp: string }> { return this.on('telemetry_alert'); }
  onTelemetryAlertResolved(): Observable<{ serialNumber: string; metric: string; timestamp: string }> { return this.on('telemetry_alert_resolved'); }
  onTelemetryAlertBatch(): Observable<{ alerts: Array<{ serialNumber: string; metric: string; severity: string; value: number; message: string; timestamp: string }>; count: number; timestamp: string }> { return this.on('telemetry_alert_batch'); }
  onUploadTestStarted(): Observable<{ deviceId: string; direction: string; url: string; timestamp: string }> { return this.on('upload_test_started'); }
  onUploadTestCompleted(): Observable<{ deviceId: string; direction: string; results?: any; timestamp: string }> { return this.on('upload_test_completed'); }
  onUploadTestError(): Observable<{ deviceId: string; direction: string; error: string; results?: any; timestamp: string }> { return this.on('upload_test_error'); }
  onDownloadTestStarted(): Observable<{ deviceId: string; direction: string; url: string; timestamp: string }> { return this.on('download_test_started'); }
  onDownloadTestCompleted(): Observable<{ deviceId: string; direction: string; results?: any; timestamp: string }> { return this.on('download_test_completed'); }
  onDownloadTestError(): Observable<{ deviceId: string; direction: string; error: string; results?: any; timestamp: string }> { return this.on('download_test_error'); }
  onDiagnosticsComplete(): Observable<{ serialNumber: string; timestamp: string }> { return this.on('diagnostics_complete'); }
  onAnalysisUpdate(): Observable<{ serialNumber: string; analysis: any; timestamp: string }> { return this.on('analysis_update'); }

  /** Getter para verificar se socket está conectado sem expor campo privado */
  get isConnected(): boolean {
    return this.socket?.connected ?? false;
  }

  /**
   * Método genérico para escutar eventos WebSocket usando Observables Reativos nativos.
   * Previne memory leaks garantindo a criação segura e a desmontagem limpa dos listeners.
   * @param eventName - Nome do evento Socket.IO
   */
  on<T = any>(eventName: string): Observable<T> {
    if (!this.observablesMap.has(eventName)) {
      const observable = new Observable<T>((subscriber) => {
        const listener = (data: T) => {
          // REINTEGRAÇÃO DA ZONA: Garante que os eventos disparem o Change Detection.
          // Componentes (como CpeInfoTab) não utilizam markForCheck() manualmente.
          // Isso reativa a renderização instantânea dos dados e dos flash-updates na UI.
          this.zone.run(() => subscriber.next(data));
        };

        // Aciona a escuta apenas no 1º subscriber
        this.socket.on(eventName, listener);

        // Função de Teardown (Executa automaticamente no unsubscribe)
        // Desvincula evento do Socket.io liberando recursos
        return () => {
          this.socket.off(eventName, listener);
          this.observablesMap.delete(eventName);
        };
      }).pipe(share()); // Compartilha a mesma conexão para todos os componentes locais

      this.observablesMap.set(eventName, observable);
    }
    return this.observablesMap.get(eventName) as Observable<T>;
  }

  /**
   * Solicita diagnóstico Wi-Fi via WebSocket (mais rápido que HTTP polling).
   * O backend responde com evento 'wifi_diagnostics_update'.
   */
  requestWifiDiagnostics(serialNumber: string): void {
    this.socket.emit('request_wifi_diagnostics', { serialNumber });
  }

  /**
   * Aplica otimização automática Wi-Fi via WebSocket.
   * Envia evento para o backend executar SetParameterValues na CPE.
   */
  applyWifiOptimization(serialNumber: string, type: string, band: string, value: any): void {
    this.socket.emit('apply_wifi_optimization', { serialNumber, type, band, value });
  }

  /**
   * Inscreve-se na sala global de CPEs (tela de listagem/dashboard).
   * Recebe eventos cpe_online e cpe_updated de qualquer CPE.
   */
  subscribeToAllCpes(): void {
    this.activeRooms.add('all_cpes');
    this.socket.emit('subscribe_all_cpes');
  }

  /**
   * Cancela inscrição na sala global de CPEs.
   */
  unsubscribeFromAllCpes(): void {
    this.activeRooms.delete('all_cpes');
    this.socket.emit('unsubscribe_all_cpes');
  }

  /**
   * Inscreve-se em atualizações de uma CPE específica.
   * O backend começa a monitorar esta CPE.
   * Se o socket ainda não estiver conectado, a inscrição é enfileirada e enviada
   * automaticamente quando a conexão for estabelecida.
   */
  subscribeToCpe(serialNumber: string): void {
    const room = `cpe_${serialNumber}`;
    const currentCount = this.roomRefCount.get(room) || 0;
    this.roomRefCount.set(room, currentCount + 1);

    // Se já era >= 1, a sala já está ativa/pendente — não precisa reemitir.
    if (currentCount > 0) return;

    if (this.socket.connected) {
      this.activeRooms.add(room);
      this.socket.emit('subscribe_cpe', { serialNumber });
    } else {
      this.pendingRooms.add(room);
    }
  }

  /**
   * Cancela inscrição em atualizações de uma CPE específica.
   * Usa contagem de referências: só emite unsubscribe_cpe para o backend quando
   * o último interessado (ex: CpeDetailsComponent) destruir sua referência.
   * Componentes filhos de aba podem chamar sem quebrar a sala para o pai.
   */
  unsubscribeFromCpe(serialNumber: string): void {
    const room = `cpe_${serialNumber}`;
    const currentCount = this.roomRefCount.get(room) || 0;
    if (currentCount <= 1) {
      this.roomRefCount.delete(room);
      this.activeRooms.delete(room);
      this.pendingRooms.delete(room);
      if (this.socket.connected) {
        this.socket.emit('unsubscribe_cpe', { serialNumber });
      }
    } else {
      this.roomRefCount.set(room, currentCount - 1);
    }
  }

  /**
   * Emite heartbeat para renovar TTL do Driver no Redis.
   * @param serialNumber - Número de série da CPE
   */
  emitDriverKeepalive(serialNumber: string): void {
    // sessionId e username são extraídos no middleware backend (socket.data)
    this.socket.emit('driver_keepalive', { serialNumber });
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
    }
  }
}
