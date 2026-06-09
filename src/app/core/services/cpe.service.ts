// Caminho do arquivo: frontend/src/app/core/services/cpe.service.ts

import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { tap } from 'rxjs/operators';
import { environment } from '../../../environments/environment';
import { CpeDevice, PaginatedResponse, WifiDiagnosticsData, WifiHostsData, ConnectedDevicesData, CpePrediction } from '../models';

@Injectable({
  providedIn: 'root'
})
export class CpeService {
  private readonly API_URL = `${environment.apiUrl}/api/cpe`;

  // IMPLEMENTAÇÃO DE CACHE PARA SUPORTAR 6.000+ CPEs
  // Cache em memória para reduzir tráfego HTTP e latência percebida
  private cache = new Map<string, { data: CpeDevice, timestamp: number }>();
  private CACHE_TTL = 30000; // 30 segundos de TTL (Time To Live)

  constructor(private http: HttpClient) {}

  /**
   * Busca a lista de CPEs cadastradas no banco de dados com PAGINAÇÃO.
   * IMPLEMENTAÇÃO DE PAGINAÇÃO PARA SUPORTAR 6.000+ CPEs.
   * 
   * Não retorna a árvore de parâmetros inteira para economizar banda,
   * apenas os dados cruciais (IP, Status, Sinal GPON, Wi-Fi).
   * 
   * @param page - Número da página (padrão: 1)
   * @param limit - Itens por página (padrão: 50, máximo: 100)
   * @param filters - Objeto opcional com filtros (isOnline, manufacturer)
   * @returns Observable com resposta contendo data e pagination
   */
  getAllCpes(page: number = 1, limit: number = 50, filters?: { isOnline?: boolean; manufacturer?: string }): Observable<PaginatedResponse<CpeDevice>> {
    // Inicia construção da query string com parâmetros de paginação
    let params = `?page=${page}&limit=${limit}`;
    
    // Se objeto de filtros foi fornecido, adiciona filtros à query string
    if (filters) {
      // Se filtro isOnline foi fornecido, adiciona como parâmetro
      if (filters.isOnline !== undefined) {
        params += `&isOnline=${filters.isOnline}`;
      }
      // Se filtro manufacturer foi fornecido, adiciona como parâmetro
      if (filters.manufacturer) {
        params += `&manufacturer=${filters.manufacturer}`;
      }
    }
    
    // Faz requisição GET com query string construída
    // Retorna Observable que o componente deve subscribe
    return this.http.get<PaginatedResponse<CpeDevice>>(`${this.API_URL}${params}`);
  }

  /**
   * Busca os detalhes completos de uma CPE específica.
   * IMPLEMENTAÇÃO DE CACHE PARA SUPORTAR 6.000+ CPEs.
   * 
   * Verifica se os dados estão no cache antes de fazer requisição HTTP.
   * Se estiver no cache e não expirou (TTL 30s), retorna do cache.
   * Caso contrário, faz requisição HTTP e armazena no cache.
   * 
   * @param serialNumber - Número de série da CPE
   * @returns Observable com dados da CPE
   */
  getCpeDetails(serialNumber: string): Observable<CpeDevice> {
    // Constrói chave de cache baseada no serialNumber
    const cacheKey = `cpe_${serialNumber}`;
    
    // Verifica se existe cache válido para esta CPE
    const cached = this.cache.get(cacheKey);
    
    // Se cache existe e não expirou (timestamp atual < timestamp cache + TTL)
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      // Retorna Observable com dados do cache (of() cria Observable a partir de valor)
      return of(cached.data);
    }

    // Se não tem cache ou expirou, faz requisição HTTP
    return this.http.get<CpeDevice>(`${this.API_URL}/${serialNumber}`).pipe(
      // tap intercepta a resposta sem modificar o fluxo
      // Armazena os dados no cache para futuras requisições
      tap(data => {
        this.cache.set(cacheKey, { data, timestamp: Date.now() });
      })
    );
  }

  /**
   * Dispara o Connection Request (Wake Up) para uma CPE específica.
   * @param serialNumber - O número de série da CPE alvo.
   */
  wakeUpCpe(serialNumber: string): Observable<any> {
    return this.http.post(`${this.API_URL}/${serialNumber}/wake`, {});
  }

  /**
   * Enfileira uma tarefa de alteração de parâmetros (SetParameterValues) no ACS.
   * @param serialNumber - O número de série da CPE alvo.
   * @param parameters - Array de objetos { name, value, type }.
   */
  queueConfig(serialNumber: string, parameters: any[]): Observable<any> {
    const payload = { parameters };
    return this.http.post(`${this.API_URL}/${serialNumber}/config`, payload);
  }

  updateRadioConfig(serialNumber: string, parameters: any[]): Observable<any> {
    return this.http.post(`${this.API_URL}/${serialNumber}/radio`, { parameters });
  }

  getWifiDiagnostics(serialNumber: string, forceRefresh = false): Observable<WifiDiagnosticsData> {
    const url = `${this.API_URL}/${serialNumber}/wifi-diagnostics${forceRefresh ? '?refresh=true' : ''}`;
    return this.http.get<WifiDiagnosticsData>(url);
  }

  applyWifiCorrection(serialNumber: string, parameters: any[]): Observable<any> {
    return this.http.post(`${this.API_URL}/${serialNumber}/wifi-diagnostics/apply`, { parameters });
  }

  /**
   * Solicita ao backend o acionamento da varredura REAL de redes vizinhas na CPE.
   * O backend enfileira DiagnosticsState='Requested' (TR-181) e dispara Connection Request.
   * @param serialNumber - Número de série da CPE
   */
  triggerNeighborScan(serialNumber: string): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(`${this.API_URL}/${serialNumber}/wifi-neighbor-scan`, {});
  }

  /**
   * Aplica otimização automática Wi-Fi via HTTP (fallback quando WebSocket não disponível).
   * @param serialNumber - Número de série da CPE
   * @param type - Tipo de otimização (change_channel, adjust_power, toggle_band)
   * @param band - Banda (2.4GHz ou 5GHz)
   * @param value - Valor da otimização (canal, potência, etc.)
   */
  applyWifiOptimization(serialNumber: string, type: string, band: string, value: any): Observable<any> {
    return this.http.post(`${this.API_URL}/${serialNumber}/wifi-optimization`, { type, band, value });
  }

  /**
   * Busca a lista enriquecida de hosts Wi-Fi conectados cruzando Device.Hosts
   * com Device.WiFi.DataElements X_TP_ (QoE, speeds, SNR) e insights determinísticos.
   * Fonte: parâmetros já no MongoDB.
   * @param serialNumber - Número de série da CPE
   */
  getWifiHosts(serialNumber: string): Observable<WifiHostsData> {
    return this.http.get<WifiHostsData>(`${this.API_URL}/${serialNumber}/wifi-hosts`);
  }

  /**
   * Busca TODOS os dispositivos conectados à CPE (Wi-Fi + Ethernet).
   * Fonte: parâmetros já no MongoDB.
   * @param serialNumber - Número de série da CPE
   */
  getConnectedDevices(serialNumber: string): Observable<ConnectedDevicesData> {
    return this.http.get<ConnectedDevicesData>(`${this.API_URL}/${serialNumber}/devices`);
  }

  /**
   * Limpa (cancela) todas as tarefas pendentes da fila da CPE.
   * Usado ao trocar de aba no frontend para evitar acúmulo de requisições obsoletas.
   * @param serialNumber - Número de série da CPE
   */
  clearPendingTasks(serialNumber: string): Observable<{ message: string; removedCount: number }> {
    return this.http.delete<{ message: string; removedCount: number }>(`${this.API_URL}/${serialNumber}/pending-tasks`);
  }

  /**
   * Solicita ao motor heurístico a análise de risco de falha da CPE.
   * Retorna score de risco, fatores individualizados, causas prováveis e ações sugeridas.
   * @param serialNumber - Número de série da CPE
   */
  predictFailure(serialNumber: string): Observable<CpePrediction> {
    return this.http.get<CpePrediction>(`${this.API_URL}/${serialNumber}/predict-failure`);
  }

  /**
   * Solicita telemetria sob demanda (on-demand monitoring) para uma CPE.
   * O backend enfileira um job RabbitMQ, dispara Connection Request,
   * e a resposta chega via WebSocket no evento 'telemetry_update'.
   * @param serialNumber - Número de série da CPE
   * @param activeTab - Aba ativa no frontend ('system', 'wifi', 'optical', 'all')
   */
  requestTelemetry(serialNumber: string, activeTab: string = 'all'): Observable<{ message: string; status: string }> {
    return this.http.post<{ message: string; status: string }>(
      `${environment.apiUrl}/api/cpe/${serialNumber}/telemetry`,
      { activeTab }
    );
  }

  /**
   * Busca telemetria do cache Redis SEM disparar coleta na CPE.
   * Ideal para carregar a aba "Informações" com dados recentes.
   * Retorna { success, data, timestamp, ageSeconds } ou 404 se vazio.
   */
  getTelemetryCache(serialNumber: string): Observable<{
    success: boolean;
    serialNumber: string;
    data: any;
    timestamp: number;
    ageSeconds: number;
    message: string;
  }> {
    return this.http.get<any>(
      `${environment.apiUrl}/api/cpe/${serialNumber}/telemetry/cache`
    );
  }

  /**
   * Analise avancada agregada: tendencia optica, reboots, anomalias de trafego,
   * comparacao OLT, correlacao termica, latencia/DNS e trafego por destino.
   */
  getTelemetryAnalysis(serialNumber: string): Observable<any> {
    return this.http.get<any>(
      `${environment.apiUrl}/api/cpe/${serialNumber}/telemetry/analysis`
    );
  }

  // ── Consultas históricas (Time-Series) ────────────────────────────────────

  getTelemetryRaw(serialNumber: string, hours: number = 6): Observable<{ success: boolean; data: any[]; hours: number; count: number }> {
    return this.http.get<{ success: boolean; data: any[]; hours: number; count: number }>(
      `${environment.apiUrl}/api/cpe/${serialNumber}/telemetry/raw`,
      { params: { hours: String(hours) } }
    );
  }

  getTelemetryHourly(serialNumber: string, days: number = 7): Observable<{ success: boolean; data: any[]; days: number; count: number }> {
    return this.http.get<{ success: boolean; data: any[]; days: number; count: number }>(
      `${environment.apiUrl}/api/cpe/${serialNumber}/telemetry/hourly`,
      { params: { days: String(days) } }
    );
  }

  getTelemetryDaily(serialNumber: string, days: number = 30): Observable<{ success: boolean; data: any[]; days: number; count: number }> {
    return this.http.get<{ success: boolean; data: any[]; days: number; count: number }>(
      `${environment.apiUrl}/api/cpe/${serialNumber}/telemetry/daily`,
      { params: { days: String(days) } }
    );
  }

  /**
   * Busca histórico de diagnósticos executados na CPE.
   * Query params opcionais:
   *   - type: filtra por tipo (IPPing, TraceRoute, DNSLookup, Download, Upload, NeighboringWiFi)
   *   - limit: quantidade máxima de registros (padrão: 50, máx: 100)
   */
  getDiagnosticHistory(serialNumber: string, type?: string, limit: number = 50): Observable<{ success: boolean; data: any[]; count: number }> {
    const params: any = { limit: String(limit) };
    if (type) params.type = type;
    return this.http.get<{ success: boolean; data: any[]; count: number }>(
      `${environment.apiUrl}/api/cpe/${serialNumber}/diagnostics/history`,
      { params }
    );
  }

  /**
   * Aciona um diagnóstico ativo na CPE via TR-069 SetParameterValues.
   * O backend enfileira DiagnosticsState='Requested' + parâmetros de entrada.
   * @param serialNumber - Número de série da CPE
   * @param type - Tipo: 'IPPing' | 'TraceRoute' | 'Download' | 'Upload' | 'DNSLookup'
   * @param params - Parâmetros de entrada do diagnóstico (Host, DownloadURL, etc.)
   */
  runDiagnostic(serialNumber: string, type: string, params: Record<string, string> = {}): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(
      `${environment.apiUrl}/api/cpe/${serialNumber}/diagnostics/run`,
      { type, params }
    );
  }

  /**
   * Aciona um teste de velocidade TR-143 (Download ou Upload).
   * @param serialNumber - Número de série da CPE
   * @param direction - Direção: 'download' ou 'upload'
   * @param url - URL do servidor de teste
   * @param transport - Transporte: 'HTTP' ou 'FTP'
   * @param connections - Número de conexões: '1', '2' ou '3'
   */
  runSpeedTest(
    serialNumber: string,
    direction: 'download' | 'upload',
    url: string,
    transport: 'HTTP' | 'FTP' = 'HTTP',
    connections: '1' | '2' | '3' = '1'
  ): Observable<{ message: string; direction: string; url: string }> {
    return this.http.post<{ message: string; direction: string; url: string }>(
      `${environment.apiUrl}/api/cpe/${serialNumber}/speed-test`,
      { direction, url, transport, connections }
    );
  }

  // ── HISTÓRICO ESPECÍFICO POR TIPO DE DIAGNÓSTICO ─────────────────────────────

  /**
   * Busca histórico de Ping da CPE.
   * @param serialNumber - Número de série da CPE
   * @param limit - Quantidade máxima de registros (padrão: 10)
   */
  getPingHistory(serialNumber: string, limit: number = 10): Observable<{ success: boolean; data: any[] }> {
    return this.http.get<{ success: boolean; data: any[] }>(
      `${environment.apiUrl}/api/cpe/${serialNumber}/diagnostics/ping/history`,
      { params: { limit: String(limit) } }
    );
  }

  /**
   * Busca histórico de TraceRoute da CPE.
   * @param serialNumber - Número de série da CPE
   * @param limit - Quantidade máxima de registros (padrão: 10)
   */
  getTraceRouteHistory(serialNumber: string, limit: number = 10): Observable<{ success: boolean; data: any[] }> {
    return this.http.get<{ success: boolean; data: any[] }>(
      `${environment.apiUrl}/api/cpe/${serialNumber}/diagnostics/traceroute/history`,
      { params: { limit: String(limit) } }
    );
  }

  /**
   * Busca histórico de Teste de Velocidade da CPE.
   * @param serialNumber - Número de série da CPE
   * @param direction - Direção opcional: 'Download' ou 'Upload'
   * @param limit - Quantidade máxima de registros (padrão: 10)
   */
  getSpeedTestHistory(serialNumber: string, direction?: 'Download' | 'Upload', limit: number = 10): Observable<{ success: boolean; data: any[] }> {
    const params: any = { limit: String(limit) };
    if (direction) params.direction = direction;
    return this.http.get<{ success: boolean; data: any[] }>(
      `${environment.apiUrl}/api/cpe/${serialNumber}/diagnostics/speed-test/history`,
      { params }
    );
  }

  /**
   * Busca histórico de DNS Lookup da CPE.
   * @param serialNumber - Número de série da CPE
   * @param limit - Quantidade máxima de registros (padrão: 10)
   */
  getDNSLookupHistory(serialNumber: string, limit: number = 10): Observable<{ success: boolean; data: any[] }> {
    return this.http.get<{ success: boolean; data: any[] }>(
      `${environment.apiUrl}/api/cpe/${serialNumber}/diagnostics/dns/history`,
      { params: { limit: String(limit) } }
    );
  }

  /**
   * Busca histórico de UDP Echo da CPE.
   * @param serialNumber - Número de série da CPE
   * @param limit - Quantidade máxima de registros (padrão: 10)
   */
  getUDPEchoHistory(serialNumber: string, limit: number = 10): Observable<{ success: boolean; data: any[] }> {
    return this.http.get<{ success: boolean; data: any[] }>(
      `${environment.apiUrl}/api/cpe/${serialNumber}/diagnostics/udp-echo/history`,
      { params: { limit: String(limit) } }
    );
  }

  /**
   * Busca histórico de WiFi Neighbor Scan da CPE.
   * @param serialNumber - Número de série da CPE
   * @param limit - Quantidade máxima de registros (padrão: 10)
   */
  getWiFiNeighborHistory(serialNumber: string, limit: number = 10): Observable<{ success: boolean; data: any[] }> {
    return this.http.get<{ success: boolean; data: any[] }>(
      `${environment.apiUrl}/api/cpe/${serialNumber}/diagnostics/wifi-neighbor/history`,
      { params: { limit: String(limit) } }
    );
  }
}
