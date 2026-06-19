import { Component, Input, OnInit, OnChanges, OnDestroy, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subscription } from 'rxjs';
import { CpeService } from '../../../../../../core/services/cpe.service';
import { WebSocketService } from '../../../../../../core/services/websocket.service';
import { ButtonComponent } from '../../../../../../core/components/button/button.component';
import { SkeletonComponent } from '../../../../../../core/components/skeleton/skeleton.component';
import { WifiSaturationChartComponent } from './wifi-saturation-chart/wifi-saturation-chart.component';
import { CpeDevice, WifiDiagnosticsData, WifiBandDiagnostics } from '../../../../../../core/models';

/**
 * Ponto para gráfico de barras horizontais (distribuição de qualidade).
 */
interface QualityBarPoint {
  label: string;
  value: number;
  cssClass: string;
}

@Component({
  selector: 'app-cpe-diagnostics-tab',
  standalone: true,
  imports: [CommonModule, ButtonComponent, SkeletonComponent, WifiSaturationChartComponent],
  templateUrl: './cpe-diagnostics-tab.component.html',
  styleUrls: ['./cpe-diagnostics-tab.component.scss']
})
export class CpeDiagnosticsTabComponent implements OnInit, OnChanges, OnDestroy {
  @Input() cpe: CpeDevice | null = null;
  @Input() serialNumber: string = '';

  /** Relatório de diagnóstico tipado vindo do backend. */
  report: WifiDiagnosticsData | null = null;
  isAnalyzing = false;
  isApplying = false;
  applyingBand: string | null = null;
  feedbackMessage = '';
  feedbackType: 'success' | 'error' | '' = '';
  reportTimestamp = '';

  /** Dados derivados para os gráficos de distribuição de qualidade por banda. */
  qualityBars2g: QualityBarPoint[] = [];
  qualityBars5g: QualityBarPoint[] = [];

  /** Estado de execução por tipo de diagnóstico ativo. */
  diagnosticRunning: Record<string, boolean> = {
    IPPing: false, TraceRoute: false, Download: false, Upload: false, DNSLookup: false, UDPEcho: false,
  };

  /** ID do último diagnóstico de cada tipo (para cancelamento). */
  lastDiagnosticId: Record<string, string> = {
    IPPing: '', TraceRoute: '', Download: '', Upload: '', DNSLookup: '', UDPEcho: '',
  };

  /** Parâmetros de entrada preenchidos pelo técnico para cada tipo de diagnóstico. */
  diagnosticParams: Record<string, Record<string, string>> = {
    IPPing:     { Host: '8.8.8.8', NumberOfRepetitions: '4', Timeout: '5000', DataBlockSize: '32' },
    TraceRoute: { Host: '8.8.8.8', MaxHopCount: '30', Timeout: '5000', NumberOfTries: '3' },
    Download:   { DownloadURL: 'http://speedtest.net/speedtest.bin' },
    Upload:     { UploadURL: 'http://speedtest.net/upload', TestFileLength: '1000000' },
    DNSLookup:  { HostName: 'google.com', NumberOfRepetitions: '3', Timeout: '3' },
    UDPEcho:    { Enable: 'true', UDPPort: '7', SourceIPAddress: '' },
  };

  /** Estado de varredura de redes vizinhas. Permanece true até confirmação via WebSocket. */
  neighborScanInProgress = false;

  /** Mensagem de progresso exibida no overlay do gráfico de saturação. */
  neighborScanStatusMsg = 'Aguardando CPE...';

  /** Capacidades de diagnóstico da CPE (booleanos) */
  diagnosticCapabilities: {
    ipPingSupported: boolean;
    ipTraceRouteSupported: boolean;
    ipDownloadSupported: boolean;
    ipUploadSupported: boolean;
    ipUdpEchoSupported: boolean;
  } = {
    ipPingSupported: false,
    ipTraceRouteSupported: false,
    ipDownloadSupported: false,
    ipUploadSupported: false,
    ipUdpEchoSupported: false,
  };

  /** Configuração do teste de velocidade */
  speedTestDirection: 'download' | 'upload' = 'download';
  speedTestTransport: 'HTTP' | 'FTP' = 'HTTP';
  speedTestConnections: '1' | '2' | '3' = '1';
  speedTestUrl: string = '';
  speedTestRunning: boolean = false;
  speedTestResult: { throughput: number; bytes: number; duration: number } | null = null;

  /** URLs pré-configuradas para teste de velocidade (whitelist: speedtest.net, fast.com, cloudflare.com, ookla.com) */
  readonly SPEED_TEST_URLS = {
    download: 'http://speedtest.net/speedtest.bin',
    upload: 'http://speedtest.net/upload'
  };

  /** Histórico de diagnósticos executados */
  diagnosticHistory: any[] = [];
  loadingHistory = false;

  /** Timer de failsafe para garantir que o loading nunca fique preso. */
  private neighborScanFailsafe?: ReturnType<typeof setTimeout>;

  /** Aba ativa no painel de diagnóstico: 'overview' | 'saturation' | 'insights' */
  activeTab: 'overview' | 'saturation' | 'insights' = 'overview';

  /** Mensagem de acesso bloqueado (outro técnico está usando esta CPE). */
  cpeAccessDenied = false;
  cpeLockedBy = '';
  cpeLockedAt = '';

  /** Modo somente leitura quando acesso é negado. */
  readOnly = false;

  /** Armazena os IDs dos timeouts para limpeza e prevenção de memory leak */
  private diagnosticTimeouts = new Map<string, ReturnType<typeof setTimeout>>();

  /** Agrupa todas as subscrições de WebSocket para destruição em massa */
  private wsSubscriptions = new Subscription();

  constructor(
    private cpeService: CpeService,
    private wsService: WebSocketService
  ) {}

  ngOnInit(): void {
    // Inicializa URL padrão de teste de velocidade
    this.speedTestUrl = this.SPEED_TEST_URLS.download;
    this.loadDiagnostics();
    this.loadDiagnosticHistory();
    this.listenRealtimeDiagnostics();
    this.listenNeighborScanCompleted();
    this.listenCpeLock();
    this.listenSpeedTestEvents();
    this.wsService.subscribeToCpe(this.serialNumber);
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['serialNumber'] && !changes['serialNumber'].firstChange) {
      this.wsService.unsubscribeFromCpe(changes['serialNumber'].previousValue);
      this.unsubscribeWs();
      this.report = null;
      this.cpeAccessDenied = false;
      this.readOnly = false;
      this.loadDiagnostics();
      this.listenRealtimeDiagnostics();
      this.listenNeighborScanCompleted();
      this.listenCpeLock();
      this.listenSpeedTestEvents(); // Correção: Garante que os testes de velocidade funcionem ao trocar de CPE
      this.wsService.subscribeToCpe(this.serialNumber);
    }
  }

  ngOnDestroy(): void {
    this.wsService.unsubscribeFromCpe(this.serialNumber);
    this.unsubscribeWs();
    clearTimeout(this.neighborScanFailsafe);
    this.diagnosticTimeouts.forEach(timeoutId => clearTimeout(timeoutId));
    this.diagnosticTimeouts.clear();
  }

  /**
   * Troca a aba ativa no painel de diagnóstico.
   */
  setActiveTab(tab: 'overview' | 'saturation' | 'insights'): void {
    this.activeTab = tab;
  }

  /**
   * Carrega diagnóstico via HTTP (primeira carga ou fallback).
   * Em seguida solicita atualização via WebSocket para receber dados em tempo real.
   */
  loadDiagnostics(): void {
    if (!this.serialNumber) return;

    this.isAnalyzing = true;
    this.clearFeedback();

    // O backend executa o diagnóstico imediatamente e também cria
    // um intervalo para enviar atualizações via WebSocket a cada 15s.
    this.wsService.requestWifiDiagnostics(this.serialNumber);
  }

  /**
   * Solicita ao backend o acionamento da varredura REAL de redes vizinhas na CPE.
   * O backend enfileira DiagnosticsState='Requested' (TR-181) e dispara Connection Request.
   */
  requestNeighborScan(): void {
    if (!this.serialNumber) return;
    this.neighborScanInProgress = true;
    this.neighborScanStatusMsg = 'Acionando varredura na CPE...';
    this.clearFeedback();

    // Failsafe: se em 75s o WebSocket não confirmar, sai do loading
    clearTimeout(this.neighborScanFailsafe);
    this.neighborScanFailsafe = setTimeout(() => {
      if (this.neighborScanInProgress) {
        this.neighborScanInProgress = false;
        this.setFeedback('Varredura expirou. A CPE pode não suportar este diagnóstico.', 'error');
      }
    }, 75000);

    this.cpeService.triggerNeighborScan(this.serialNumber).subscribe({
      next: () => {
        // Mantém neighborScanInProgress=true — só limpa quando WebSocket confirmar
        this.neighborScanStatusMsg = 'Scan em andamento na CPE (pode levar até 30s)...';
        this.setFeedback('Varredura solicitada. Aguardando CPE concluir o scan...', 'success');
      },
      error: (err) => {
        clearTimeout(this.neighborScanFailsafe);
        this.neighborScanInProgress = false;
        this.setFeedback(err?.error?.error || 'Não foi possível solicitar a varredura de redes vizinhas.', 'error');
      }
    });
  }

  /**
   * Recebe o evento (applyChannel) do componente wifi-saturation-chart
   * e aplica o canal recomendado pelo score de interferência ponderado.
   */
  applyChannelFromSaturation(evt: { channel: number; parameterPath: string; band: string }): void {
    const band = evt.band as '2.4GHz' | '5GHz';
    const parameters = [{ name: evt.parameterPath, value: String(evt.channel), type: 'xsd:unsignedInt' }];
    this.isApplying = true;
    this.applyingBand = band;
    this.clearFeedback();
    this.cpeService.applyWifiCorrection(this.serialNumber, parameters).subscribe({
      next: () => {
        this.setFeedback(`Canal ${band} alterado para ${evt.channel}. A CPE aplicará na próxima sessão.`, 'success');
        this.isApplying = false;
        this.applyingBand = null;
      },
      error: () => {
        this.setFeedback(`Não foi possível alterar o canal ${band}. Tente novamente.`, 'error');
        this.isApplying = false;
        this.applyingBand = null;
      },
    });
  }

  /**
   * Aplica correção de canal sugerida para uma banda específica.
   * Converte a sugestão do analisador em parâmetros TR-069/TR-181.
   */
  applyChannelSuggestion(band: '2.4GHz' | '5GHz'): void {
    if (!this.report) return;
    const suggestion = this.report.bands[band].channelSuggestion;
    if (!suggestion.shouldChange) return;

    const parameters = this.buildChannelParameters(band, suggestion.suggestedChannel);
    if (!parameters.length) return;

    this.isApplying = true;
    this.applyingBand = band;
    this.clearFeedback();

    this.cpeService.applyWifiCorrection(this.serialNumber, parameters).subscribe({
      next: () => {
        this.setFeedback(`Canal ${band} alterado para ${suggestion.suggestedChannel}. A CPE aplicará na próxima sessão.`, 'success');
        this.isApplying = false;
        this.applyingBand = null;
      },
      error: () => {
        this.setFeedback(`Não foi possível alterar o canal ${band}. Tente novamente.`, 'error');
        this.isApplying = false;
        this.applyingBand = null;
      }
    });
  }

  /**
   * Verifica se está aplicando correção em uma banda específica.
   */
  isApplyingBand(band: string): boolean {
    return this.isApplying && this.applyingBand === band;
  }

  /**
   * Classe CSS para o nível de severidade do congestionamento.
   */
  congestionClass(severity: string): string {
    switch (severity) {
      case 'Alto': return 'congestion-high';
      case 'Moderado': return 'congestion-moderate';
      default: return 'congestion-normal';
    }
  }

  /**
   * Classe CSS para a qualidade do sinal do cliente.
   */
  signalQualityClass(quality: string): string {
    switch (quality) {
      case 'Excelente': return 'signal-excellent';
      case 'Bom': return 'signal-good';
      case 'Fraco': return 'signal-weak';
      case 'Crítico': return 'signal-critical';
      default: return 'signal-unknown';
    }
  }

  /**
   * Retorna o total de clientes em ambas as bandas.
   */
  get totalClients(): number {
    if (!this.report) return 0;
    return this.report.bands['2.4GHz'].totalClients + this.report.bands['5GHz'].totalClients;
  }

  /**
   * Retorna o número de clientes com sinal crítico em ambas as bandas.
   */
  get criticalClients(): number {
    if (!this.report) return 0;
    return this.report.summary?.criticalClients ?? 0;
  }

  /**
   * Verifica se há congestionamento em qualquer banda.
   */
  get hasCongestion(): boolean {
    if (!this.report) return false;
    return this.report.summary?.hasCongestion ?? false;
  }

  // ---------------------------------------------------------------------------
  // WebSocket — tempo real
  // ---------------------------------------------------------------------------

  private listenRealtimeDiagnostics(): void {
    if (!this.serialNumber) return;

    this.wsSubscriptions.add(
      this.wsService.onWifiDiagnosticsUpdate().subscribe({
        next: (data: WifiDiagnosticsData) => {
          // Só processa se for da CPE atual
          if (data.serialNumber === this.serialNumber) {
            this.processReportData(data);
            this.isAnalyzing = false;
          }
        }
      })
    );

    this.wsSubscriptions.add(
      this.wsService.on('wifi_error').subscribe({
        next: (evt: any) => {
          if (evt.serialNumber === this.serialNumber) {
            // Em caso de erro, define um report vazio se ainda não houver
            if (!this.report) {
              this.report = {
                serialNumber: this.serialNumber,
                bands: {
                  '2.4GHz': { radio: {}, channelSuggestion: null, associatedDeviceCount: 0 },
                  '5GHz': { radio: {}, channelSuggestion: null, associatedDeviceCount: 0 },
                },
                ipPingSupported: false, ipTraceRouteSupported: false, ipDownloadSupported: false,
                ipUploadSupported: false, ipUdpEchoSupported: false, neighboringWiFiResultCount: 0,
                channelSaturation: null,
              } as any;
            }
            this.isAnalyzing = false;
            this.setFeedback(evt.error || 'Falha ao analisar a rede Wi-Fi.', 'error');
          }
        }
      })
    );
  }

  /**
   * Ouve o evento 'neighbor_scan_completed' emitido pelo backend quando os
   * resultados do NeighboringWiFiDiagnostic chegam via GetParameterValues follow-up.
   * Recarrega os dados de diagnóstico completo para atualizar os gráficos de saturação.
   */
  private listenNeighborScanCompleted(): void {
    if (!this.serialNumber) return;

    this.wsSubscriptions.add(
      this.wsService.on('neighbor_scan_completed').subscribe({
        next: (evt: any) => {
          if (evt.serialNumber !== this.serialNumber) return;

          clearTimeout(this.neighborScanFailsafe);
          this.neighborScanInProgress = false;

          if (evt.isRealData && evt.resultCount > 0) {
            this.setFeedback(
              `Varredura concluída: ${evt.resultCount} redes vizinhas detectadas. Gráficos atualizados.`,
              'success'
            );
          } else if (evt.reason === 'timeout') {
            this.setFeedback('Scan expirou após 2 retentativas. A CPE pode não ter concluído a varredura.', 'error');
          } else {
            this.setFeedback('Varredura concluída, mas sem redes vizinhas detectadas (dados de demonstração mantidos).', 'error');
          }

          this.loadDiagnostics(); // recarrega para pegar resultados reais do scan
        }
      })
    );
  }

  /**
   * Escuta eventos de trava/destrava de acesso exclusivo da CPE.
   * cpe_access_denied  → exibe banner + entra em modo somente leitura.
   * cpe_access_granted → remove banner + libera edição.
   */
  private listenCpeLock(): void {
    this.wsSubscriptions.add(
      this.wsService.onCpeAccessDenied().subscribe(evt => {
        if (evt.serialNumber !== this.serialNumber) return;
        this.cpeAccessDenied = true;
        this.readOnly = true;
        this.cpeLockedBy = evt.lockedBy;
        this.cpeLockedAt = evt.lockedMinutes === 0
          ? 'agora mesmo'
          : `há ${evt.lockedMinutes} min`;
      })
    );

    this.wsSubscriptions.add(
      this.wsService.onCpeAccessGranted().subscribe(evt => {
        if (evt.serialNumber !== this.serialNumber) return;
        this.cpeAccessDenied = false;
        this.readOnly = false;
      })
    );
  }

  /**
   * Aciona um diagnóstico ativo na CPE via TR-069 (SetParameterValues DiagnosticsState=Requested).
   * Parâmetros de entrada são filtrados pela whitelist do backend.
   */
  runDiagnostic(type: string): void {
    if (!this.serialNumber || this.diagnosticRunning[type]) return;
    this.diagnosticRunning[type] = true;
    this.clearFeedback();

    const params = this.diagnosticParams[type] || {};

    this.cpeService.runDiagnostic(this.serialNumber, type, params).subscribe({
      next: (res) => {
        this.setFeedback(
          res?.message || `${type} acionado. Aguardando CPE concluir o teste...`,
          'success'
        );
        // Armazena o ID do diagnóstico para cancelamento
        if (res?.diagnosticId) {
          this.lastDiagnosticId[type] = res.diagnosticId;
        }
        // Failsafe: libera o botão após 90s se não vier confirmação
        const tId = setTimeout(() => {
          this.diagnosticRunning[type] = false;
        }, 90000);
        this.diagnosticTimeouts.set(type, tId);
        // Recarrega histórico imediatamente para mostrar 'Requested'
        this.loadDiagnosticHistory();
      },
      error: (err) => {
        if (this.diagnosticTimeouts.has(type)) {
          clearTimeout(this.diagnosticTimeouts.get(type)!);
          this.diagnosticTimeouts.delete(type);
        }
        this.diagnosticRunning[type] = false;
        if (err.status === 409) {
          this.setFeedback('Já existe um diagnóstico em andamento para esta CPE.', 'error');
        } else {
          this.setFeedback(err?.error?.error || `Falha ao acionar ${type}.`, 'error');
        }
      },
    });
  }

  /**
   * Atualiza o parâmetro de entrada de um diagnóstico ao digitar no campo.
   */
  onDiagParamChange(type: string, field: string, value: string): void {
    if (!this.diagnosticParams[type]) this.diagnosticParams[type] = {};
    this.diagnosticParams[type][field] = value;
  }

  /**
   * Cancela um diagnóstico em andamento (ainda não enviado à CPE).
   */
  cancelDiagnostic(type: string, diagnosticId: string): void {
    if (!this.serialNumber || !diagnosticId) return;

    this.cpeService.cancelDiagnostic(this.serialNumber, diagnosticId).subscribe({
      next: () => {
        this.diagnosticRunning[type] = false;
        if (this.diagnosticTimeouts.has(type)) {
          clearTimeout(this.diagnosticTimeouts.get(type)!);
          this.diagnosticTimeouts.delete(type);
        }
        this.setFeedback(`${type} cancelado.`, 'success');
        this.loadDiagnosticHistory();
      },
      error: (err) => {
        this.setFeedback(err?.error?.error || 'Erro ao cancelar diagnóstico.', 'error');
      }
    });
  }

  private unsubscribeWs(): void {
    // Destrói ativamente todos os ouvintes criados
    this.wsSubscriptions.unsubscribe();

    // Instancia uma nova Subscription vazia caso o componente
    // permaneça vivo (ex: acionado via ngOnChanges)
    this.wsSubscriptions = new Subscription();
  }

  // ---------------------------------------------------------------------------
  // Feedback
  // ---------------------------------------------------------------------------

  private setFeedback(message: string, type: 'success' | 'error'): void {
    this.feedbackMessage = message;
    this.feedbackType = type;
  }

  private clearFeedback(): void {
    this.feedbackMessage = '';
    this.feedbackType = '';
  }

  // ---------------------------------------------------------------------------
  // Processamento de dados
  // ---------------------------------------------------------------------------

  private processReportData(data: WifiDiagnosticsData): void {
    this.report = data;
    this.reportTimestamp = new Date().toLocaleTimeString();

    // Atualiza capacidades de diagnóstico com base nos dados recebidos
    this.diagnosticCapabilities = {
      ipPingSupported: data.ipPingSupported ?? false,
      ipTraceRouteSupported: data.ipTraceRouteSupported ?? false,
      ipDownloadSupported: data.ipDownloadSupported ?? false,
      ipUploadSupported: data.ipUploadSupported ?? false,
      ipUdpEchoSupported: data.ipUdpEchoSupported ?? false,
    };

    // Gera barras de distribuição de qualidade para cada banda
    this.qualityBars2g = this.buildQualityBars(data.bands['2.4GHz']);
    this.qualityBars5g = this.buildQualityBars(data.bands['5GHz']);
  }

  /**
   * Formata bytes em formato legível (KB, MB, GB).
   */
  formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
  }

  /**
   * Handler do evento (change) do select de filtro de histórico.
   * Extrai o valor selecionado e delega para loadDiagnosticHistory.
   */
  onHistoryTypeChange(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    this.loadDiagnosticHistory(value || undefined);
  }

  /**
   * Atualiza a URL do teste de velocidade quando o usuário digita.
   */
  onSpeedTestUrlChange(value: string): void {
    if (this.speedTestDirection === 'download') {
      this.diagnosticParams['Download']['DownloadURL'] = value;
    } else {
      this.diagnosticParams['Upload']['UploadURL'] = value;
    }
    this.speedTestUrl = value;
  }

  /**
   * Traduz códigos de erro TR-143 para mensagens amigáveis.
   */
  private translateSpeedTestError(errorCode: string): string {
    const errorMap: Record<string, string> = {
      'Error_InitConnectionFailed': 'Falha ao estabelecer conexão com o servidor de teste. Verifique a URL e a conectividade da CPE.',
      'Error_NoResponse': 'Sem resposta do servidor de teste.',
      'Error_Timeout': 'Tempo limite excedido durante o teste.',
      'Error_DownloadFailed': 'Falha no download do arquivo de teste.',
      'Error_UploadFailed': 'Falha no upload do arquivo de teste.',
      'Error_InvalidURL': 'URL inválida fornecida.',
      'Error_Internal': 'Erro interno da CPE durante o teste.',
    };
    return errorMap[errorCode] || errorCode;
  }

  /**
   * Exibe o resultado do último teste de velocidade do histórico no card.
   */
  private displayLatestSpeedTestResult(diagType: 'Download' | 'Upload'): void {
    const latestResult = this.diagnosticHistory.find(h => h.diagnosticType === diagType && h.diagnosticsState === 'Complete');
    if (latestResult && latestResult.results) {
      const results = latestResult.results;
      const throughput = results.throughputMbps ? parseFloat(results.throughputMbps) : 0;
      const duration = results.durationSeconds ? parseFloat(results.durationSeconds) : 0;
      const bytes = results.TotalBytesReceived || results.TotalBytesSent || results.TestBytesReceived || results.TestBytesSent || 0;

      this.speedTestResult = {
        throughput,
        bytes: Number(bytes),
        duration
      };
    }
  }

  /**
   * Escuta eventos WebSocket de teste de velocidade TR-143.
   * Atualiza o estado de execução e carrega o resultado quando o teste é concluído.
   */
  private listenSpeedTestEvents(): void {
    // Upload iniciado
    this.wsSubscriptions.add(
      this.wsService.onUploadTestStarted().subscribe((data) => {
        if (data.deviceId === this.serialNumber) {
          this.speedTestRunning = true;
          this.setFeedback('Teste de Upload iniciado. Aguardando CPE concluir...', 'success');
        }
      })
    );

    // Upload concluído
    this.wsSubscriptions.add(
      this.wsService.onUploadTestCompleted().subscribe((data) => {
        if (data.deviceId === this.serialNumber) {
          this.speedTestRunning = false;
          this.loadDiagnosticHistory('Upload');
          this.setFeedback('Teste de Upload concluído.', 'success');
        }
      })
    );

    // Upload com erro
    this.wsSubscriptions.add(
      this.wsService.onUploadTestError().subscribe((data) => {
        if (data.deviceId === this.serialNumber) {
          this.speedTestRunning = false;
          this.loadDiagnosticHistory('Upload');
          this.setFeedback(`Erro no teste de Upload: ${this.translateSpeedTestError(data.error)}`, 'error');
        }
      })
    );

    // Download iniciado
    this.wsSubscriptions.add(
      this.wsService.onDownloadTestStarted().subscribe((data) => {
        if (data.deviceId === this.serialNumber) {
          this.speedTestRunning = true;
          this.setFeedback('Teste de Download iniciado. Aguardando CPE concluir...', 'success');
        }
      })
    );

    // Download concluído
    this.wsSubscriptions.add(
      this.wsService.onDownloadTestCompleted().subscribe((data) => {
        if (data.deviceId === this.serialNumber) {
          this.speedTestRunning = false;
          this.loadDiagnosticHistory('Download');
          this.setFeedback('Teste de Download concluído.', 'success');
        }
      })
    );

    // Download com erro
    this.wsSubscriptions.add(
      this.wsService.onDownloadTestError().subscribe((data) => {
        if (data.deviceId === this.serialNumber) {
          this.speedTestRunning = false;
          this.loadDiagnosticHistory('Download');
          this.setFeedback(`Erro no teste de Download: ${this.translateSpeedTestError(data.error)}`, 'error');
        }
      })
    );

    // Diagnóstico completo (genérico)
    this.wsSubscriptions.add(
      this.wsService.onDiagnosticsComplete().subscribe((data) => {
        if (data.serialNumber === this.serialNumber) {
          this.speedTestRunning = false;
          this.loadDiagnosticHistory();
        }
      })
    );
  }

  /**
   * Inicia o teste de velocidade (Download ou Upload).
   */
  runSpeedTest(): void {
    if (!this.serialNumber || this.speedTestRunning || !this.speedTestUrl) return;

    this.speedTestRunning = true;
    this.speedTestResult = null;
    this.clearFeedback();

    this.cpeService.runSpeedTest(
      this.serialNumber,
      this.speedTestDirection,
      this.speedTestUrl,
      this.speedTestTransport,
      this.speedTestConnections
    ).subscribe({
      next: (res) => {
        this.setFeedback(
          res?.message || 'Teste de velocidade iniciado. Aguardando CPE concluir...',
          'success'
        );
      },
      error: (err) => {
        this.speedTestRunning = false;
        this.setFeedback(`Erro ao iniciar teste: ${err?.error?.message || err?.message || 'Desconhecido'}`, 'error');
      }
    });
  }

  /**
   * Carrega histórico de diagnósticos do backend.
   */
  loadDiagnosticHistory(type?: string): void {
    if (!this.serialNumber) return;
    this.loadingHistory = true;

    this.cpeService.getDiagnosticHistory(this.serialNumber, type).subscribe({
      next: (res) => {
        this.diagnosticHistory = res.data || [];
        this.loadingHistory = false;

        // Exibe resultado do último teste de velocidade se disponível
        if (!type || type === 'Download') {
          this.displayLatestSpeedTestResult('Download');
        }
        if (!type || type === 'Upload') {
          this.displayLatestSpeedTestResult('Upload');
        }
      },
      error: () => {
        this.diagnosticHistory = [];
        this.loadingHistory = false;
      }
    });
  }

  /**
   * Formata timestamp do histórico para exibição.
   */
  formatHistoryTime(timestamp: string): string {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Agora mesmo';
    if (diffMins < 60) return `${diffMins} min atrás`;
    if (diffHours < 24) return `${diffHours} h atrás`;
    if (diffDays < 7) return `${diffDays} d atrás`;
    return date.toLocaleDateString('pt-BR');
  }

  /**
   * Classe CSS para badge de severidade de insight.
   */
  insightSeverityClass(severity: string): string {
    switch (severity) {
      case 'critical': return 'insight-critical';
      case 'warning':  return 'insight-warning';
      default:         return 'insight-info';
    }
  }

  /**
   * Ícone Material Symbols para a categoria do insight.
   */
  insightCategoryIcon(category: string): string {
    const icons: Record<string, string> = {
      canal:         'cell_tower',
      sinal:         'signal_wifi_bad',
      qoe:           'sentiment_dissatisfied',
      configuracao:  'settings',
      saturacao:     'density_medium',
    };
    return icons[category] ?? 'info';
  }

  /**
   * Classe CSS para o label de QoE do host.
   */
  qoeLabelClass(label: string): string {
    switch (label) {
      case 'Excelente': return 'qoe-excellent';
      case 'Bom':       return 'qoe-good';
      case 'Regular':   return 'qoe-regular';
      case 'Ruim':      return 'qoe-poor';
      default:          return 'qoe-na';
    }
  }

  /**
   * Converte a distribuição de qualidade em pontos para gráfico de barras.
   */
  private buildQualityBars(band: WifiBandDiagnostics): QualityBarPoint[] {
    const dist = band.qualityDistribution || {};
    const total = band.totalClients || 1;
    const map: Record<string, string> = {
      'Excelente': 'bar-excellent',
      'Bom': 'bar-good',
      'Fraco': 'bar-weak',
      'Crítico': 'bar-critical',
      'Desconhecido': 'bar-unknown'
    };
    return (Object.entries(dist) as [string, number][])
      .filter(([_, count]) => count > 0)
      .map(([label, count]) => ({
        label,
        value: Math.round((count / total) * 100),
        cssClass: map[label] || 'bar-unknown'
      }));
  }

  /**
   * Constrói os parâmetros TR-069/TR-181 para mudança de canal.
   * Respeita o perfil da CPE (TR-098 vs TR-181).
   */
  private buildChannelParameters(band: '2.4GHz' | '5GHz', channel: number): Array<{ name: string; value: string; type: string }> {
    if (!this.report || !this.cpe) return [];
    const profile = this.report.profile || 'TR-181';
    const params: Array<{ name: string; value: string; type: string }> = [];

    if (profile === 'TR-181') {
      const radioIdx = band === '2.4GHz' ? '1' : '2';
      params.push({
        name: `Device.WiFi.Radio.${radioIdx}.Channel`,
        value: String(channel),
        type: 'xsd:unsignedInt'
      });
    } else {
      // TR-098: precisa do índice WLANConfiguration resolvido.
      // Como não temos acesso ao resolveTr098WlanIndex no frontend,
      // usamos o caminho mais comum (1 para 2.4GHz, 2 para 5GHz).
      const wlanIdx = band === '2.4GHz' ? '1' : '2';
      params.push({
        name: `InternetGatewayDevice.LANDevice.1.WLANConfiguration.${wlanIdx}.Channel`,
        value: String(channel),
        type: 'xsd:unsignedInt'
      });
    }
    return params;
  }
}
