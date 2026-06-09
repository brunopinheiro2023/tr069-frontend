import { Injectable, NgZone } from '@angular/core'; // IMPORTAR NgZone
import { io, Socket } from 'socket.io-client';
import { Observable, Subject } from 'rxjs';
import { environment } from '../../../environments/environment';

@Injectable({
  providedIn: 'root'
})
export class WebSocketService {
  private socket: Socket;

  private cpeUpdatedSubject = new Subject<any>();
  private cpeOnlineSubject = new Subject<any>();
  private configSuccessSubject = new Subject<any>();
  private wifiDiagnosticsSubject = new Subject<any>();
  private wifiDataRefreshedSubject = new Subject<{ serialNumber: string; timestamp: string }>();
  private neighborScanCompletedSubject = new Subject<{ serialNumber: string; timestamp: string }>();
  private cpeAccessDeniedSubject = new Subject<{ serialNumber: string; lockedBy: string; lockedAt: string; lockedMinutes: number }>();
  private cpeAccessGrantedSubject = new Subject<{ serialNumber: string }>();
  private cpeValueChangeSubject = new Subject<{ serialNumber: string; changeType: string; changedParams: Array<{ name: string; value: string }>; timestamp: string }>();
  private telemetryUpdateSubject = new Subject<{ serialNumber: string; data: any; timestamp: string }>();
  private uploadTestStartedSubject = new Subject<{ deviceId: string; direction: string; url: string; timestamp: string }>();
  private uploadTestCompletedSubject = new Subject<{ deviceId: string; direction: string; results?: any; timestamp: string }>();
  private uploadTestErrorSubject = new Subject<{ deviceId: string; direction: string; error: string; results?: any; timestamp: string }>();
  private downloadTestStartedSubject = new Subject<{ deviceId: string; direction: string; url: string; timestamp: string }>();
  private downloadTestCompletedSubject = new Subject<{ deviceId: string; direction: string; results?: any; timestamp: string }>();
  private downloadTestErrorSubject = new Subject<{ deviceId: string; direction: string; error: string; results?: any; timestamp: string }>();
  private diagnosticsCompleteSubject = new Subject<{ serialNumber: string; timestamp: string }>();
  // Map para observables dinâmicos registrados via on() genérico
  private dynamicSubjects = new Map<string, Subject<any>>();

  // INJETA O NgZone NO CONSTRUTOR
  constructor(private zone: NgZone) {
    // SEGURANÇA: envia token JWT fresco a cada (re)conexão
    this.socket = io(environment.wsUrl, {
      auth: (cb) => {
        const token = localStorage.getItem('jwt_token');
        cb({ token: token || '' });
      }
    });

    this.socket.on('connect', () => {
      console.log('Conectado ao WebSocket do Servidor ACS.');
    });

    // Envolve as chamadas do socket dentro de this.zone.run()
    this.socket.on('cpe_updated', (data: any) => {
      this.zone.run(() => {
        this.cpeUpdatedSubject.next(data);
      });
    });

    this.socket.on('cpe_online', (data: any) => {
      this.zone.run(() => {
        this.cpeOnlineSubject.next(data);
      });
    });

    this.socket.on('config_success', (data: any) => {
      this.zone.run(() => {
        this.configSuccessSubject.next(data);
      });
    });

    // Diagnóstico Wi-Fi avançado emitido pelo backend (tempo real)
    this.socket.on('wifi_diagnostics_update', (data: any) => {
      this.zone.run(() => {
        this.wifiDiagnosticsSubject.next(data);
      });
    });

    // Conclusão da leitura Wi-Fi sob demanda (dados frescos disponíveis)
    this.socket.on('wifi_data_refreshed', (data: { serialNumber: string; timestamp: string }) => {
      this.zone.run(() => {
        this.wifiDataRefreshedSubject.next(data);
      });
    });

    this.socket.on('neighbor_scan_completed', (data: { serialNumber: string; timestamp: string }) => {
      this.zone.run(() => {
        this.neighborScanCompletedSubject.next(data);
      });
    });

    this.socket.on('cpe_access_denied', (data: any) => {
      this.zone.run(() => this.cpeAccessDeniedSubject.next(data));
    });

    this.socket.on('cpe_access_granted', (data: any) => {
      this.zone.run(() => this.cpeAccessGrantedSubject.next(data));
    });

    this.socket.on('cpe_value_change', (data: any) => {
      this.zone.run(() => this.cpeValueChangeSubject.next(data));
    });

    this.socket.on('telemetry_update', (data: any) => {
      this.zone.run(() => this.telemetryUpdateSubject.next(data));
    });

    // Eventos de teste de velocidade TR-143
    this.socket.on('upload_test_started', (data: { deviceId: string; direction: string; url: string; timestamp: string }) => {
      this.zone.run(() => this.uploadTestStartedSubject.next(data));
    });

    this.socket.on('upload_test_completed', (data: { deviceId: string; direction: string; timestamp: string }) => {
      this.zone.run(() => this.uploadTestCompletedSubject.next(data));
    });

    this.socket.on('upload_test_error', (data: { deviceId: string; direction: string; error: string; timestamp: string }) => {
      this.zone.run(() => this.uploadTestErrorSubject.next(data));
    });

    this.socket.on('download_test_started', (data: { deviceId: string; direction: string; url: string; timestamp: string }) => {
      this.zone.run(() => this.downloadTestStartedSubject.next(data));
    });

    this.socket.on('download_test_completed', (data: { deviceId: string; direction: string; results?: any; timestamp: string }) => {
      console.log('[WebSocketService] download_test_completed recebido do servidor:', data);
      this.zone.run(() => this.downloadTestCompletedSubject.next(data));
    });

    this.socket.on('download_test_error', (data: { deviceId: string; direction: string; error: string; timestamp: string }) => {
      this.zone.run(() => this.downloadTestErrorSubject.next(data));
    });

    this.socket.on('diagnostics_complete', (data: { serialNumber: string; timestamp: string }) => {
      this.zone.run(() => this.diagnosticsCompleteSubject.next(data));
    });
  }

  onCpeUpdated(): Observable<any> { return this.cpeUpdatedSubject.asObservable(); }
  onCpeOnline(): Observable<any> { return this.cpeOnlineSubject.asObservable(); }
  onConfigSuccess(): Observable<any> { return this.configSuccessSubject.asObservable(); }
  onWifiDiagnosticsUpdate(): Observable<any> { return this.wifiDiagnosticsSubject.asObservable(); }
  onWifiDataRefreshed(): Observable<{ serialNumber: string; timestamp: string }> {
    return this.wifiDataRefreshedSubject.asObservable();
  }
  onNeighborScanCompleted(): Observable<{ serialNumber: string; timestamp: string }> {
    return this.neighborScanCompletedSubject.asObservable();
  }
  onCpeAccessDenied(): Observable<{ serialNumber: string; lockedBy: string; lockedAt: string; lockedMinutes: number }> {
    return this.cpeAccessDeniedSubject.asObservable();
  }
  onCpeAccessGranted(): Observable<{ serialNumber: string }> {
    return this.cpeAccessGrantedSubject.asObservable();
  }
  onCpeValueChange(): Observable<{ serialNumber: string; changeType: string; changedParams: Array<{ name: string; value: string }>; timestamp: string }> {
    return this.cpeValueChangeSubject.asObservable();
  }
  onTelemetryUpdate(): Observable<{ serialNumber: string; data: any; timestamp: string }> {
    return this.telemetryUpdateSubject.asObservable();
  }

  onUploadTestStarted(): Observable<{ deviceId: string; direction: string; url: string; timestamp: string }> {
    return this.uploadTestStartedSubject.asObservable();
  }

  onUploadTestCompleted(): Observable<{ deviceId: string; direction: string; results?: any; timestamp: string }> {
    return this.uploadTestCompletedSubject.asObservable();
  }

  onUploadTestError(): Observable<{ deviceId: string; direction: string; error: string; results?: any; timestamp: string }> {
    return this.uploadTestErrorSubject.asObservable();
  }

  onDownloadTestStarted(): Observable<{ deviceId: string; direction: string; url: string; timestamp: string }> {
    return this.downloadTestStartedSubject.asObservable();
  }

  onDownloadTestCompleted(): Observable<{ deviceId: string; direction: string; results?: any; timestamp: string }> {
    return this.downloadTestCompletedSubject.asObservable();
  }

  onDownloadTestError(): Observable<{ deviceId: string; direction: string; error: string; results?: any; timestamp: string }> {
    return this.downloadTestErrorSubject.asObservable();
  }

  onDiagnosticsComplete(): Observable<{ serialNumber: string; timestamp: string }> {
    return this.diagnosticsCompleteSubject.asObservable();
  }

  /**
   * Método genérico para escutar eventos WebSocket por nome.
   * Registra o listener no socket e retorna um Observable tipado.
   * Reutiliza o Subject se já foi registrado anteriormente.
   * @param eventName - Nome do evento Socket.IO
   */
  on(eventName: string): Observable<any> {
    if (!this.dynamicSubjects.has(eventName)) {
      const subject = new Subject<any>();
      this.dynamicSubjects.set(eventName, subject);
      this.socket.on(eventName, (data: any) => {
        this.zone.run(() => subject.next(data));
      });
    }
    return this.dynamicSubjects.get(eventName)!.asObservable();
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
    this.socket.emit('subscribe_all_cpes');
  }

  /**
   * Cancela inscrição na sala global de CPEs.
   */
  unsubscribeFromAllCpes(): void {
    this.socket.emit('unsubscribe_all_cpes');
  }

  /**
   * Inscreve-se em atualizações de uma CPE específica.
   * O backend começa a monitorar esta CPE.
   */
  subscribeToCpe(serialNumber: string): void {
    this.socket.emit('subscribe_cpe', { serialNumber });
  }

  /**
   * Cancela inscrição em atualizações de uma CPE específica.
   * O backend para de monitorar esta CPE.
   */
  unsubscribeFromCpe(serialNumber: string): void {
    this.socket.emit('unsubscribe_cpe', { serialNumber });
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
    }
  }
}
