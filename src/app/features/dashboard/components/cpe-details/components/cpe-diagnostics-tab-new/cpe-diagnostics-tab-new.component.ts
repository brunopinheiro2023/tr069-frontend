import { Component, Input, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subscription } from 'rxjs';
import { CpeService } from '../../../../../../core/services/cpe.service';
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
  styleUrls: ['./cpe-diagnostics-tab-new.component.scss']
})
export class CpeDiagnosticsTabNewComponent implements OnInit, OnDestroy {
  @Input() cpe: CpeDevice | null = null;
  @Input() serialNumber: string = '';
  @Input() readOnly: boolean = false;

  // Capabilities da CPE
  diagnosticCapabilities = {
    ipPingSupported: false,
    ipTraceRouteSupported: false,
    ipDownloadSupported: false,
    ipUploadSupported: false,
    ipUdpEchoSupported: false
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

  constructor(
    private cpeService: CpeService,
    private wsService: WebSocketService,
    private diagnosticParser: DiagnosticParserService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    console.log('[DiagnosticsNew] ngOnInit chamado, serialNumber:', this.serialNumber);
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
   */
  private loadDiagnosticHistories(): void {
    if (!this.serialNumber) return;

    this.cpeService.getPingHistory(this.serialNumber, 10).subscribe({
      next: (res) => { this.pingHistory = res.data || []; },
      error: (err) => { console.error('Erro ao carregar histórico de ping:', err); }
    });

    this.cpeService.getTraceRouteHistory(this.serialNumber, 10).subscribe({
      next: (res) => { this.traceRouteHistory = res.data || []; },
      error: (err) => { console.error('Erro ao carregar histórico de traceroute:', err); }
    });

    this.cpeService.getSpeedTestHistory(this.serialNumber, 'Download', 10).subscribe({
      next: (res) => { this.speedTestHistory = res.data || []; },
      error: (err) => { console.error('Erro ao carregar histórico de teste de velocidade:', err); }
    });

    this.cpeService.getDNSLookupHistory(this.serialNumber, 10).subscribe({
      next: (res) => { this.dnsLookupHistory = res.data || []; },
      error: (err) => { console.error('Erro ao carregar histórico de DNS lookup:', err); }
    });

    this.cpeService.getUDPEchoHistory(this.serialNumber, 10).subscribe({
      next: (res) => { this.udpEchoHistory = res.data || []; },
      error: (err) => { console.error('Erro ao carregar histórico de UDP echo:', err); }
    });
  }

  ngOnDestroy(): void {
    this.wsSub.unsubscribe();
    if (this.serialNumber) {
      this.wsService.unsubscribeFromCpe(this.serialNumber);
    }
  }

  /**
   * Carrega capabilities de diagnóstico da CPE.
   */
  private loadCapabilities(): void {
    if (!this.cpe?.parameters) return;

    const getCapability = (path: string): boolean => {
      const param = this.cpe!.parameters!.find(p => p.name === `Device.Capabilities.IP.Diagnostics.${path}`);
      return param?.value === 'true';
    };

    this.diagnosticCapabilities = {
      ipPingSupported: getCapability('IPPing'),
      ipTraceRouteSupported: getCapability('TraceRoute'),
      ipDownloadSupported: getCapability('Download'),
      ipUploadSupported: getCapability('Upload'),
      ipUdpEchoSupported: getCapability('UDPEcho')
    };
  }

  /**
   * Escuta eventos WebSocket para atualizar estado dos diagnósticos.
   * Quando a CPE completa um diagnóstico, o backend emite eventos específicos
   * que permitem atualizar o UI sem polling.
   */
  private listenForWebSocketEvents(): void {
    // Evento genérico: a CPE reportou DIAGNOSTICS COMPLETE
    this.wsSub.add(
      this.wsService.onDiagnosticsComplete().subscribe(event => {
        if (event.serialNumber !== this.serialNumber) return;
        // Recarrega o histórico de todos os diagnósticos
        this.loadDiagnosticHistories();
      })
    );

    // Teste de velocidade — Download concluído com sucesso
    this.wsSub.add(
      this.wsService.onDownloadTestCompleted().subscribe(event => {
        console.log('[WebSocket] download_test_completed recebido:', event);
        console.log('[WebSocket] serialNumber esperado:', this.serialNumber, 'deviceId recebido:', event.deviceId);
        if (event.deviceId !== this.serialNumber) {
          console.log('[WebSocket] Ignorando evento de outra CPE');
          return;
        }
        console.log('[WebSocket] Processando resultado:', event.results);
        this.diagnosticRunning.Download = false;
        this.speedTestError = null;
        this.speedTestResult = this.buildSpeedTestResult(event.results);
        console.log('[WebSocket] speedTestResult construído:', this.speedTestResult);
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
    return {
      throughput: results.throughputMbps !== undefined ? parseFloat(results.throughputMbps) : undefined,
      duration: results.durationSeconds !== undefined ? parseFloat(results.durationSeconds) : undefined,
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
      next: (res) => {
        console.log('Ping iniciado:', res.message);
      },
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
      next: (res) => {
        console.log('TraceRoute iniciado:', res.message);
      },
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
      next: (res) => {
        console.log('Teste de velocidade iniciado:', res.message);
      },
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
      next: (res) => {
        console.log('DNS Lookup iniciado:', res.message);
      },
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
      next: (res) => {
        console.log('UDP Echo iniciado:', res.message);
      },
      error: (err) => {
        console.error('Erro ao iniciar UDP echo:', err);
        this.diagnosticRunning.UDPEcho = false;
      }
    });
  }
}
