import { Component, Input, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subscription } from 'rxjs';
import { CpeService } from '../../../../../../core/services/cpe.service';
import { CapabilityService } from '../../../../../../core/services/capability.service';
import { DiagnosticParserService } from '../../../../../../core/services/diagnostic-parser.service';
import { WebSocketService } from '../../../../../../core/services/websocket.service';
import {
  CpeDevice,
  DiagnosticResult,
  DNSLookupResult,
  PingResult,
  SpeedTestResult,
  TraceRouteResult,
  UDPEchoResult
} from '../../../../../../core/models';
import { PingDiagnosticCardComponent } from './components/ping-diagnostic-card/ping-diagnostic-card.component';
import { TraceRouteDiagnosticCardComponent } from './components/traceroute-diagnostic-card/traceroute-diagnostic-card.component';
import { SpeedTestCardComponent } from './components/speed-test-card/speed-test-card.component';
import { DNSLookupCardComponent } from './components/dns-lookup-card/dns-lookup-card.component';
import { UDPEchoCardComponent } from './components/udp-echo-card/udp-echo-card.component';

/** Interface para o resultado em tempo real do teste de velocidade via WebSocket. */
interface LiveSpeedTestResult {
  throughput?: number;
  duration?: number;
  bytes: number;
  diagnosticsState: string;
}

/**
 * Componente pai da aba de Diagnósticos de Rede.
 * Gerencia componentes filhos independentes para cada tipo de diagnóstico.
 * Segue padrão pai-filho para melhor organização e manutenibilidade.
 */
@Component({
  selector: 'app-cpe-diagnostics-tab-new',
  standalone: true,
  imports: [
    CommonModule,
    PingDiagnosticCardComponent,
    TraceRouteDiagnosticCardComponent,
    SpeedTestCardComponent,
    DNSLookupCardComponent,
    UDPEchoCardComponent
  ],
  templateUrl: './cpe-diagnostics-tab-new.component.html',
  styleUrls: ['./cpe-diagnostics-tab-new.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class CpeDiagnosticsTabNewComponent implements OnInit, OnDestroy {
  @Input() cpe: CpeDevice | null = null;
  @Input() serialNumber: string = '';
  @Input() readOnly: boolean = false;
  /** CPE está offline — bloqueia execução de diagnósticos. */
  @Input() isCpeOffline: boolean = false;

  // Capabilities da CPE — preenchidas via CapabilityService (backend /capabilities/diagnostics).
  // Antes eram lidas de cpe.parameters buscando paths inexistentes (Device.Capabilities.IP.*),
  // o que fazia TODOS os cards exibirem "Não suportado" mesmo em CPEs que suportam.
  diagnosticCapabilities = {
    ipPingSupported: false,
    ipTraceRouteSupported: false,
    ipDownloadSupported: false,
    ipUploadSupported: false,
    ipUdpEchoSupported: false,
    ipDnsLookupSupported: false
  };

  // Estado de execução de cada diagnóstico
  diagnosticRunning = {
    IPPing: false,
    TraceRoute: false,
    Download: false,
    Upload: false,
    DNSLookup: false,
    UDPEcho: false
  };

  // Resultados de cada diagnóstico
  pingResult: PingResult | null = null;
  traceRouteResult: TraceRouteResult | null = null;
  speedTestResult: LiveSpeedTestResult | null = null;
  speedTestError: string | null = null;
  dnsLookupResult: DNSLookupResult | null = null;
  udpEchoResult: UDPEchoResult | null = null;

  // Histórico de cada diagnóstico
  pingHistory: PingResult[] = [];
  traceRouteHistory: TraceRouteResult[] = [];
  speedTestHistory: SpeedTestResult[] = [];
  dnsLookupHistory: DNSLookupResult[] = [];
  udpEchoHistory: UDPEchoResult[] = [];

  // Parâmetros de cada diagnóstico
  pingHost: string = '8.8.8.8';
  traceRouteHost: string = '8.8.8.8';
  speedTestDirection: 'download' | 'upload' = 'download';
  speedTestUrl: string = 'http://speedtest.tele2.net/10MB.zip';
  speedTestConnections: number = 1;
  dnsHostName: string = 'google.com';
  udpPort: number = 7;
  udpSourceIPAddress: string = '';

  private wsSub = new Subscription();
  /** Debounce de recargas: wifi_data_refreshed é emitido múltiplas vezes em sequência
   *  (telemetria, diagnóstico, etc.). Sem debounce, cada emissão dispara 5 chamadas HTTP
   *  simultâneas — com 3 emissões em 2s = 15 requisições. Debounce de 500ms agrupa em 1. */
  private reloadTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private cpeService: CpeService,
    private capabilityService: CapabilityService,
    private wsService: WebSocketService,
    private diagnosticParser: DiagnosticParserService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.loadCapabilities();
    this.loadDiagnosticHistories();
    this.listenForWebSocketEvents();
    // Inscreve-se na sala da CPE para receber eventos WebSocket específicos
    if (this.serialNumber) {
      this.wsService.subscribeToCpe(this.serialNumber);
    }
  }

  /**
   * Formata um item do histórico de diagnóstico para exibição amigável.
   * @param item O resultado do diagnóstico a ser formatado.
   */
  public formatHistoryItem(item: DiagnosticResult): string {
    return this.diagnosticParser.formatDiagnosticResult(item);
  }

  /**
   * Carrega o histórico de cada diagnóstico específico.
   * Chamado no ngOnInit e quando wifi_data_refreshed chega via WebSocket.
   * Use debouncedReload() para chamadas via WebSocket (agrupa múltiplas emissões).
   */
  private loadDiagnosticHistories(): void {
    if (!this.serialNumber) return;

    // Helper: se o doc mais recente do histórico tem estado final (Complete/Error_*),
    // o diagnóstico terminou — resetamos diagnosticRunning para desbloquear o card.
    const isFinalState = (state: string | undefined): boolean =>
      !!state && !['Requested', 'Running'].includes(state);

    this.cpeService.getPingHistory(this.serialNumber, 10).subscribe({
      next: (res) => {
        this.pingHistory = res.data || [];
        if (this.pingHistory.length > 0) {
          const latest = this.pingHistory[0] as any;
          const r = latest.results || {};
          this.pingResult = {
            averageResponseTime: r.averageResponseTime,
            minResponseTime: r.minResponseTime,
            maxResponseTime: r.maxResponseTime,
            successCount: r.successCount,
            failureCount: r.failureCount,
            diagnosticsState: latest.diagnosticsState,
            host: latest.host || '',
            timestamp: latest.timestamp || ''
          };
          if (isFinalState(latest.diagnosticsState)) {
            this.diagnosticRunning.IPPing = false;
          }
        }
        this.cdr.markForCheck();
      },
      error: (err) => { console.error('Erro ao carregar histórico de ping:', err); }
    });

    this.cpeService.getTraceRouteHistory(this.serialNumber, 10).subscribe({
      next: (res) => {
        this.traceRouteHistory = res.data || [];
        if (this.traceRouteHistory.length > 0) {
          const latest = this.traceRouteHistory[0] as any;
          const r = latest.results || {};
          this.traceRouteResult = {
            hopCount: r.hopCount,
            responseTime: r.responseTime,
            diagnosticsState: latest.diagnosticsState,
            hops: r.hops,
            host: latest.host || '',
            timestamp: latest.timestamp || ''
          };
          if (isFinalState(latest.diagnosticsState)) {
            this.diagnosticRunning.TraceRoute = false;
          }
        }
        this.cdr.markForCheck();
      },
      error: (err) => { console.error('Erro ao carregar histórico de traceroute:', err); }
    });

    // SpeedTest: carrega histórico da direção atualmente selecionada no card.
    // Antes carregava só 'Download' — se o usuário fez upload, não aparecia no histórico inicial.
    const currentDirection: 'Download' | 'Upload' =
      this.speedTestDirection === 'upload' ? 'Upload' : 'Download';
    this.cpeService.getSpeedTestHistory(this.serialNumber, currentDirection, 10).subscribe({
      next: (res) => {
        this.speedTestHistory = res.data || [];
        if (this.speedTestHistory.length > 0) {
          const latest = this.speedTestHistory[0] as any;
          const r = latest.results || {};
          this.speedTestResult = {
            throughput: r.throughputMbps,
            duration: r.durationSeconds,
            bytes: r.testBytes || r.totalBytes || 0,
            diagnosticsState: latest.diagnosticsState
          };
          if (isFinalState(latest.diagnosticsState)) {
            this.diagnosticRunning[currentDirection] = false;
          }
        }
        this.cdr.markForCheck();
      },
      error: (err) => { console.error('Erro ao carregar histórico de teste de velocidade:', err); }
    });

    this.cpeService.getDNSLookupHistory(this.serialNumber, 10).subscribe({
      next: (res) => {
        this.dnsLookupHistory = res.data || [];
        if (this.dnsLookupHistory.length > 0) {
          const latest = this.dnsLookupHistory[0] as any;
          const r = latest.results || {};
          this.dnsLookupResult = {
            diagnosticsState: latest.diagnosticsState,
            dnsServer: '',
            hostName: latest.hostName || '',
            results: [],
            timestamp: latest.timestamp || ''
          };
          // O backend retorna successCount/resultCount/resolvedIPs em results, não results[]
          // Adaptamos para o formato esperado pelo card (successCount/resultCount)
          if (r.successCount !== undefined) {
            (this.dnsLookupResult as any).successCount = r.successCount;
          }
          if (r.resultCount !== undefined) {
            (this.dnsLookupResult as any).resultCount = r.resultCount;
          }
          if (isFinalState(latest.diagnosticsState)) {
            this.diagnosticRunning.DNSLookup = false;
          }
        }
        this.cdr.markForCheck();
      },
      error: (err) => { console.error('Erro ao carregar histórico de DNS lookup:', err); }
    });

    this.cpeService.getUDPEchoHistory(this.serialNumber, 10).subscribe({
      next: (res) => {
        this.udpEchoHistory = res.data || [];
        if (this.udpEchoHistory.length > 0) {
          const latest = this.udpEchoHistory[0] as any;
          const r = latest.results || {};
          this.udpEchoResult = {
            packetsReceived: r.packetsReceived,
            packetsResponded: r.packetsResponded,
            bytesReceived: r.bytesReceived,
            bytesResponded: r.bytesResponded,
            diagnosticsState: latest.diagnosticsState,
            timestamp: latest.timestamp || ''
          };
          if (isFinalState(latest.diagnosticsState)) {
            this.diagnosticRunning.UDPEcho = false;
          }
        }
        this.cdr.markForCheck();
      },
      error: (err) => { console.error('Erro ao carregar histórico de UDP echo:', err); }
    });
  }

  /**
   * Debounce de loadDiagnosticHistories para chamadas via WebSocket.
   * wifi_data_refreshed pode ser emitido 3-5x em sequência rápida (telemetria chunks +
   * diagnóstico). Sem debounce = 15-25 chamadas HTTP simultâneas. Com 500ms debounce = 5.
   */
  private debouncedReload(): void {
    if (this.reloadTimer) clearTimeout(this.reloadTimer);
    this.reloadTimer = setTimeout(() => {
      this.reloadTimer = null;
      this.loadDiagnosticHistories();
      this.cdr.markForCheck();
    }, 500);
  }

  ngOnDestroy(): void {
    if (this.reloadTimer) { clearTimeout(this.reloadTimer); this.reloadTimer = null; }
    this.wsSub.unsubscribe();
    if (this.serialNumber) {
      this.wsService.unsubscribeFromCpe(this.serialNumber);
    }
  }

  /**
   * Carrega capabilities de diagnóstico da CPE via backend.
   * Usa o CapabilityService, que consulta /api/cpe/:sn/capabilities/diagnostics —
   * o mesmo motor (capabilityRegistry.js) usado pelo runDiagnostic no strict check,
   * garantindo consistência entre o que o frontend exibe e o que o backend aceita.
   *
   * O CapabilityService já tem cache em memória (5min) e fallback permissivo quando
   * o CpeModel está em aprendizado (confidence='learning') — CPEs recém-adicionadas
   * ou após firmware update não ficam com todos os cards bloqueados.
   */
  private loadCapabilities(): void {
    if (!this.serialNumber) return;

    this.capabilityService.getCapabilities(this.serialNumber, 'diagnostics').subscribe({
      next: (response) => {
        const caps = response.capabilities || {};
        this.diagnosticCapabilities = {
          ipPingSupported:      caps['ipping'] ?? false,
          ipTraceRouteSupported: caps['traceroute'] ?? false,
          ipDownloadSupported:  caps['download'] ?? false,
          ipUploadSupported:    caps['upload'] ?? false,
          ipUdpEchoSupported:   caps['udpecho'] ?? false,
          ipDnsLookupSupported: caps['dnslookup'] ?? false
        };
        this.cdr.markForCheck();
      },
      error: (err) => {
        console.error('Erro ao carregar capabilities de diagnóstico:', err);
        // Em caso de erro, mantém defaults (false) — o usuário pode ainda tentar
        // disparar via ?strict=false no backend se necessário.
      }
    });
  }

  /**
   * Escuta eventos WebSocket para atualizar estado dos diagnósticos.
   * Quando a CPE completa um diagnóstico, o backend emite eventos específicos
   * que permitem atualizar o UI sem polling.
   */
  private listenForWebSocketEvents(): void {
    // Evento genérico: a CPE reportou DIAGNOSTICS COMPLETE (evento "8 DIAGNOSTICS COMPLETE").
    // ATENÇÃO: este evento é emitido ANTES do follow-up GPV que lê os resultados da CPE.
    // Os resultados ainda não estão no DB neste momento — recarregar o histórico aqui
    // retorna dados vazios. A recarga efetiva acontece no evento wifi_data_refreshed abaixo.
    this.wsSub.add(
      this.wsService.onDiagnosticsComplete().subscribe(event => {
        if (event.serialNumber !== this.serialNumber) return;
        // Apenas marca que um diagnóstico completou — a recarga do histórico
        // acontece quando wifi_data_refreshed chega (após o GPV de follow-up).
      })
    );

    // Evento: resultados de diagnóstico salvos no DB (backend emite wifi_data_refreshed
    // após handleGetParameterValuesResponse salvar os resultados no DiagnosticHistory
    // e modelos tipados). Este é o momento correto para recarregar o histórico.
    // Usa debounce porque wifi_data_refreshed é emitido múltiplas vezes em sequência
    // (telemetria chunks + diagnóstico + outros GPVs on-demand).
    this.wsSub.add(
      this.wsService.onWifiDataRefreshed().subscribe(event => {
        if (event.serialNumber !== this.serialNumber) return;
        this.debouncedReload();
      })
    );

    // Teste de velocidade — Download concluído com sucesso
    this.wsSub.add(
      this.wsService.onDownloadTestCompleted().subscribe(event => {
        if (event.deviceId !== this.serialNumber) return;
        this.diagnosticRunning.Download = false;
        this.speedTestError = null;
        this.speedTestResult = this.buildSpeedTestResult(event.results);
        this.loadSpeedTestHistory('Download');
        this.cdr.markForCheck();
      })
    );

    // Teste de velocidade — Upload concluído com sucesso
    this.wsSub.add(
      this.wsService.onUploadTestCompleted().subscribe(event => {
        if (event.deviceId !== this.serialNumber) return;
        this.diagnosticRunning.Upload = false;
        this.speedTestError = null;
        this.speedTestResult = this.buildSpeedTestResult(event.results);
        this.loadSpeedTestHistory('Upload');
        this.cdr.markForCheck();
      })
    );

    // Teste de velocidade — Download falhou
    this.wsSub.add(
      this.wsService.onDownloadTestError().subscribe(event => {
        if (event.deviceId !== this.serialNumber) return;
        this.diagnosticRunning.Download = false;
        this.speedTestResult = null;
        this.speedTestError = event.error;
        this.cdr.markForCheck();
      })
    );

    // Teste de velocidade — Upload falhou
    this.wsSub.add(
      this.wsService.onUploadTestError().subscribe(event => {
        if (event.deviceId !== this.serialNumber) return;
        this.diagnosticRunning.Upload = false;
        this.speedTestResult = null;
        this.speedTestError = event.error;
        this.cdr.markForCheck();
      })
    );
  }

  /**
   * Converte o resultsMap vindo do WebSocket para o formato SpeedTestResult do card.
   * O backend calcula throughputMbps e durationSeconds via TR-143.
   */
  private buildSpeedTestResult(results: any): LiveSpeedTestResult | null {
    if (!results) return null;
    // parseFloat pode retornar NaN se o valor for string não-numérica.
    // NaN é !== undefined mas é inválido para exibição — converte para undefined.
    const safeFloat = (v: any): number | undefined => {
      if (v === undefined || v === null) return undefined;
      const n = parseFloat(v);
      return Number.isNaN(n) ? undefined : n;
    };
    return {
      throughput: safeFloat(results.throughputMbps),
      duration: safeFloat(results.durationSeconds),
      bytes: results.TotalBytesReceived || results.TotalBytesSent || results.TestBytesReceived || results.TestBytesSent || 0,
      diagnosticsState: results.DiagnosticsState || 'Complete',
    };
  }

  /**
   * Carrega histórico específico de teste de velocidade por direção.
   */
  private loadSpeedTestHistory(direction: 'Download' | 'Upload'): void {
    if (!this.serialNumber) return;
    this.cpeService.getSpeedTestHistory(this.serialNumber, direction, 10).subscribe({
      next: (res) => { this.speedTestHistory = res.data || []; },
      error: (err) => { console.error(`Erro ao carregar histórico de ${direction}:`, err); }
    });
  }

  // ===================== HANDLERS DOS COMPONENTES FILHOS =====================

  onPingRun(host: string): void {
    this.pingHost = host;
    this.diagnosticRunning.IPPing = true;
    this.cpeService.runDiagnostic(this.serialNumber, 'IPPing', { Host: host }).subscribe({
      next: () => {},
      error: (err) => {
        console.error('Erro ao iniciar ping:', err);
        this.diagnosticRunning.IPPing = false;
      }
    });
  }

  onTraceRouteRun(host: string): void {
    this.traceRouteHost = host;
    this.diagnosticRunning.TraceRoute = true;
    this.cpeService.runDiagnostic(this.serialNumber, 'TraceRoute', { Host: host }).subscribe({
      next: () => {},
      error: (err) => {
        console.error('Erro ao iniciar traceroute:', err);
        this.diagnosticRunning.TraceRoute = false;
      }
    });
  }

  onSpeedTestRun(data: { direction: 'download' | 'upload'; url: string; connections: number }): void {
    this.speedTestDirection = data.direction;
    this.speedTestUrl = data.url;
    this.speedTestConnections = data.connections;
    this.diagnosticRunning[data.direction === 'download' ? 'Download' : 'Upload'] = true;
    this.cpeService.runSpeedTest(
      this.serialNumber,
      data.direction,
      data.url,
      'HTTP',
      String(data.connections) as '1' | '2' | '3'
    ).subscribe({
      next: () => {},
      error: (err) => {
        console.error('Erro ao iniciar teste de velocidade:', err);
        this.diagnosticRunning[data.direction === 'download' ? 'Download' : 'Upload'] = false;
        const detail = err?.error?.detail || err?.error?.error || err?.message || 'Erro ao iniciar teste.';
        this.speedTestError = detail;
      }
    });
  }

  onDNSLookupRun(hostName: string): void {
    this.dnsHostName = hostName;
    this.diagnosticRunning.DNSLookup = true;
    this.cpeService.runDiagnostic(this.serialNumber, 'DNSLookup', { HostName: hostName }).subscribe({
      next: () => {},
      error: (err) => {
        console.error('Erro ao iniciar DNS lookup:', err);
        this.diagnosticRunning.DNSLookup = false;
      }
    });
  }

  onUDPEchoRun(data: { udpPort: number; sourceIPAddress: string }): void {
    this.udpPort = data.udpPort;
    this.udpSourceIPAddress = data.sourceIPAddress;
    this.diagnosticRunning.UDPEcho = true;
    this.cpeService.runDiagnostic(this.serialNumber, 'UDPEcho', {
      UDPPort: String(data.udpPort),
      SourceIPAddress: data.sourceIPAddress
    }).subscribe({
      next: () => {},
      error: (err) => {
        console.error('Erro ao iniciar UDP echo:', err);
        this.diagnosticRunning.UDPEcho = false;
      }
    });
  }
}
