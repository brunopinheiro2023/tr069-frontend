// Caminho do arquivo: frontend/src/app/core/services/cpe.service.ts

import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of, throwError } from 'rxjs';
import { tap, timeout, catchError } from 'rxjs/operators';
import { environment } from '../../../environments/environment';
import {
  CpeDevice,
  PaginatedResponse,
  WifiDiagnosticsData,
  WifiHostsData,
  ConnectedDevicesData,
  CpePrediction,
  CommandResponse,
  CpeParameterPayload,
  TelemetryCacheResponse,
  TelemetryAnalysis,
  TelemetryHistoryResponse,
  DiagnosticHistoryResponse,
  DiagnosticResult,
  PingResult,
  TraceRouteResult,
  SpeedTestResult,
  DNSLookupResult,
  UDPEchoResult,
  WifiNeighborHistoryResponse,
  TelemetryAlert,
  TelemetrySnapshot,
} from '../models';

@Injectable({
  providedIn: 'root',
})
export class CpeService {
  private readonly API_URL = `${environment.apiUrl}/api/cpe`;

  // IMPLEMENTAÇÃO DE CACHE PARA SUPORTAR 6.000+ CPEs
  // Cache em memória para reduzir tráfego HTTP e latência percebida
  private cache = new Map<string, { data: any; timestamp: number }>();
  private CACHE_TTL = 30000; // 30 segundos de TTL (Time To Live)
  private readonly MAX_CACHE_SIZE = 100; // Limite máximo de itens no cache para evitar memory leak

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
   * @param filters - Objeto opcional com filtros (isOnline, manufacturer, productClass, softwareVersion, search, isCriticalGpon)
   * @returns Observable com resposta contendo data e pagination
   */
  getAllCpes(
    page: number = 1,
    limit: number = 50,
    filters?: {
      isOnline?: boolean;
      manufacturer?: string;
      productClass?: string;
      softwareVersion?: string;
      search?: string;
    },
  ): Observable<PaginatedResponse<CpeDevice>> {
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
        params += `&manufacturer=${encodeURIComponent(filters.manufacturer)}`;
      }
      // Se filtro productClass (modelo) foi fornecido
      if (filters.productClass) {
        params += `&productClass=${encodeURIComponent(filters.productClass)}`;
      }
      // Se filtro softwareVersion (firmware) foi fornecido
      if (filters.softwareVersion) {
        params += `&softwareVersion=${encodeURIComponent(filters.softwareVersion)}`;
      }
      // Se termo de busca global foi fornecido
      if (filters.search) {
        params += `&search=${encodeURIComponent(filters.search)}`;
      }
      // Filtro isCriticalGpon removido: backend ignora (opticalRx removido do schema EP28).
      // O filtro GPON crítico é aplicado localmente no frontend via campo _rx.
    }

    // Faz requisição GET com query string construída
    // Retorna Observable que o componente deve subscribe
    return this.http.get<PaginatedResponse<CpeDevice>>(
      `${this.API_URL}${params}`,
    );
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
   * @param skipCache - Se true, ignora cache e força requisição HTTP fresca
   * @returns Observable com dados da CPE
   */
  getCpeDetails(
    serialNumber: string,
    skipCache: boolean = false,
  ): Observable<CpeDevice> {
    // Constrói chave de cache baseada no serialNumber
    const cacheKey = `cpe_${serialNumber}`;

    if (!skipCache) {
      // 1. Tenta recuperar da memória RAM (Ultra rápido)
      let cached = this.cache.get(cacheKey);

      // 2. Tenta recuperar do SessionStorage (Sobrevive a F5/Refresh)
      if (!cached) {
        const sessionData = sessionStorage.getItem(cacheKey);
        if (sessionData) {
          try {
            cached = JSON.parse(sessionData);
            if (cached) this.cache.set(cacheKey, cached); // Restaura na RAM
          } catch (e) {
            sessionStorage.removeItem(cacheKey);
          }
        }
      }

      // 3. Valida se o cache existe e ainda está dentro do tempo de vida útil (TTL)
      if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
        return of(cached.data);
      }
    }

    // 4. Se não tem cache ou expirou, faz requisição HTTP e salva em ambos (RAM e Storage)
    return this.http.get<CpeDevice>(`${this.API_URL}/${serialNumber}`).pipe(
      tap((data) => {
        // OTIMIZAÇÃO: Invalida o cache se a CPE estiver offline, garantindo
        // que a próxima requisição verifique ativamente se ela voltou à rede.
        if (!data.isOnline) {
          this.clearCache(serialNumber);
          return;
        }

        if (this.cache.size >= this.MAX_CACHE_SIZE) {
          const oldestKey = this.cache.keys().next().value;
          this.cache.delete(oldestKey!);
          sessionStorage.removeItem(oldestKey!);
        }
        const cachePayload = { data, timestamp: Date.now() };
        this.cache.set(cacheKey, cachePayload);
        try {
          sessionStorage.setItem(cacheKey, JSON.stringify(cachePayload));
        } catch (e) {}
      }),
    );
  }

  /**
   * Dispara o Connection Request (Wake Up) para uma CPE específica.
   * @param serialNumber - O número de série da CPE alvo.
   */
  wakeUpCpe(serialNumber: string): Observable<CommandResponse> {
    return this.http.post<CommandResponse>(
      `${this.API_URL}/${serialNumber}/wake`,
      {},
    );
  }

  /**
   * Enfileira uma tarefa de alteração de parâmetros (SetParameterValues) no ACS.
   * @param serialNumber - O número de série da CPE alvo.
   * @param parameters - Array de objetos com nome, valor e tipo do parâmetro.
   */
  queueConfig(
    serialNumber: string,
    parameters: CpeParameterPayload[],
  ): Observable<CommandResponse> {
    const payload = { parameters };
    return this.http.post<CommandResponse>(
      `${this.API_URL}/${serialNumber}/config`,
      payload,
    );
  }

  updateRadioConfig(
    serialNumber: string,
    parameters: CpeParameterPayload[],
  ): Observable<CommandResponse> {
    return this.http
      .post<CommandResponse>(`${this.API_URL}/${serialNumber}/radio`, {
        parameters,
      })
      .pipe(
        timeout(60000), // 60 segundos de timeout
        catchError((err) => {
          if (err.name === 'TimeoutError') {
            return throwError(
              () =>
                new Error(
                  'A CPE não respondeu a tempo (timeout). Verifique se está online.',
                ),
            );
          }
          return throwError(() => err);
        }),
      );
  }

  updateWanConfig(
    serialNumber: string,
    payload: {
      pppoeUsername?: string;
      dnsServer1?: string;
      dnsServer2?: string;
      mtu?: number;
      vlanId?: number;
    },
  ): Observable<{ status: string; message: string }> {
    return this.http
      .put<{
        status: string;
        message: string;
      }>(`${this.API_URL}/${serialNumber}/wan-config`, payload)
      .pipe(
        timeout(60000),
        catchError((err) => {
          if (err.name === 'TimeoutError') {
            return throwError(
              () => new Error('Timeout: CPE não respondeu em 60s.'),
            );
          }
          return throwError(() => err);
        }),
      );
  }

  getWifiDiagnostics(
    serialNumber: string,
    forceRefresh = false,
    page: number = 1,
    limit: number = 50,
  ): Observable<WifiDiagnosticsData> {
    const params: any = { page: String(page), limit: String(limit) };
    if (forceRefresh) params.refresh = 'true';
    return this.http.get<WifiDiagnosticsData>(
      `${this.API_URL}/${serialNumber}/wifi-diagnostics`,
      { params },
    );
  }

  /**
   * Endpoint leve para acordar a CPE e coletar apenas Device.Hosts.
   * Usado pelo cpe-devices-tab para refresh de dispositivos conectados
   * sem executar o diagnóstico completo (insights, congestionamento, etc.).
   */
  refreshWifiHosts(serialNumber: string): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(
      `${this.API_URL}/${serialNumber}/wifi-hosts-refresh`,
      {},
    );
  }

  /**
   * Dispara coleta de configuração Wi-Fi (SSIDs, segurança, senha) na CPE.
   * Retorna 200 (cache fresco) ou 202 (coleta iniciada).
   * Frontend deve escutar cpe_updated via WebSocket para saber quando concluiu.
   */
  collectWifiConfig(
    serialNumber: string,
  ): Observable<{ status: string; message: string }> {
    return this.http.post<{ status: string; message: string }>(
      `${this.API_URL}/${serialNumber}/collect-wifi-config`,
      {},
    );
  }

  applyWifiCorrection(
    serialNumber: string,
    parameters: CpeParameterPayload[],
  ): Observable<CommandResponse> {
    return this.http.post<CommandResponse>(
      `${this.API_URL}/${serialNumber}/wifi-diagnostics/apply`,
      { parameters },
    );
  }

  /**
   * Solicita ao backend o acionamento da varredura REAL de redes vizinhas na CPE.
   * O backend enfileira DiagnosticsState='Requested' (TR-181) e dispara Connection Request.
   * @param serialNumber - Número de série da CPE
   */
  triggerNeighborScan(serialNumber: string): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(
      `${this.API_URL}/${serialNumber}/wifi-neighbor-scan`,
      {},
    );
  }

  /**
   * Aplica otimização de Wi-Fi via SetParameterValues (change_channel, adjust_power, toggle_band).
   * Retorna 202 quando enfileirado com sucesso.
   * @param serialNumber - Número de série da CPE
   * @param payload - Objeto com type, band e value
   */
  applyWifiOptimization(
    serialNumber: string,
    payload: { type: string; band: string; value: string },
  ): Observable<{ status: string; message: string }> {
    return this.http
      .post<{
        status: string;
        message: string;
      }>(`${this.API_URL}/${serialNumber}/wifi-optimization`, payload)
      .pipe(timeout(30000));
  }

  /**
   * Busca histórico de scans NeighboringWiFi (paginado, padrão últimos 20).
   * @param serialNumber - Número de série da CPE
   * @param limit - Quantidade máxima de registros (padrão: 20)
   */
  getWifiNeighborHistory(
    serialNumber: string,
    limit = 20,
  ): Observable<WifiNeighborHistoryResponse> {
    return this.http.get<WifiNeighborHistoryResponse>(
      `${this.API_URL}/${serialNumber}/diagnostics/wifi-neighbor/history`,
      { params: { limit: String(limit) } },
    );
  }

  /**
   * Busca a lista enriquecida de hosts Wi-Fi conectados cruzando Device.Hosts
   * com Device.WiFi.DataElements X_TP_ (QoE, speeds, SNR) e insights determinísticos.
   * Fonte: parâmetros já no MongoDB.
   * @param serialNumber - Número de série da CPE
   */
  getWifiHosts(serialNumber: string): Observable<WifiHostsData> {
    const cacheKey = `wifi_hosts_${serialNumber}`;
    let cached = this.cache.get(cacheKey);

    if (!cached) {
      const sessionData = sessionStorage.getItem(cacheKey);
      if (sessionData) {
        try {
          cached = JSON.parse(sessionData);
          if (cached) this.cache.set(cacheKey, cached);
        } catch (e) {
          sessionStorage.removeItem(cacheKey);
        }
      }
    }

    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      return of(cached.data as WifiHostsData);
    }

    return this.http
      .get<WifiHostsData>(`${this.API_URL}/${serialNumber}/wifi-hosts`)
      .pipe(
        tap((data) => {
          if (this.cache.size >= this.MAX_CACHE_SIZE) {
            const oldestKey = this.cache.keys().next().value;
            this.cache.delete(oldestKey!);
            sessionStorage.removeItem(oldestKey!);
          }
          const cachePayload = { data, timestamp: Date.now() };
          this.cache.set(cacheKey, cachePayload);
          try {
            sessionStorage.setItem(cacheKey, JSON.stringify(cachePayload));
          } catch (e) {}
        }),
      );
  }

  /**
   * Busca TODOS os dispositivos conectados à CPE (Wi-Fi + Ethernet).
   * Fonte: parâmetros já no MongoDB.
   * @param serialNumber - Número de série da CPE
   * @param page - Página atual (padrão: 1)
   * @param limit - Itens por página (padrão: 50, máximo: 200)
   * @param forceRefresh - Quando true, ignora o cache (usado após evento WS
   *   wifi_data_refreshed para garantir dados frescos — sem isso o CACHE_TTL
   *   de 30s serviria dados stale e a tabela "atualizada" não mudaria).
   */
  getConnectedDevices(
    serialNumber: string,
    page: number = 1,
    limit: number = 50,
    forceRefresh: boolean = false,
  ): Observable<ConnectedDevicesData> {
    const cacheKey = `connected_devices_${serialNumber}_${page}_${limit}`;
    let cached = this.cache.get(cacheKey);

    if (!cached) {
      const sessionData = sessionStorage.getItem(cacheKey);
      if (sessionData) {
        try {
          cached = JSON.parse(sessionData);
          if (cached) this.cache.set(cacheKey, cached);
        } catch (e) {
          sessionStorage.removeItem(cacheKey);
        }
      }
    }

    // forceRefresh bypassa o cache — usado pelo reloadDevicesDataSilently após
    // o backend confirmar (via WS) que a CPE respondeu com dados novos.
    if (
      !forceRefresh &&
      cached &&
      Date.now() - cached.timestamp < this.CACHE_TTL
    ) {
      return of(cached.data as ConnectedDevicesData);
    }

    return this.http
      .get<ConnectedDevicesData>(
        `${this.API_URL}/${serialNumber}/devices?page=${page}&limit=${limit}`,
      )
      .pipe(
        tap((data) => {
          if (this.cache.size >= this.MAX_CACHE_SIZE) {
            const oldestKey = this.cache.keys().next().value;
            this.cache.delete(oldestKey!);
            sessionStorage.removeItem(oldestKey!);
          }
          const cachePayload = { data, timestamp: Date.now() };
          this.cache.set(cacheKey, cachePayload);
          try {
            sessionStorage.setItem(cacheKey, JSON.stringify(cachePayload));
          } catch (e) {}
        }),
      );
  }

  /**
   * Limpa (cancela) todas as tarefas pendentes da fila da CPE.
   * Usado ao trocar de aba no frontend para evitar acúmulo de requisições obsoletas.
   * @param serialNumber - Número de série da CPE
   */
  clearPendingTasks(
    serialNumber: string,
  ): Observable<{ message: string; removedCount: number }> {
    return this.http.delete<{ message: string; removedCount: number }>(
      `${this.API_URL}/${serialNumber}/pending-tasks`,
    );
  }

  /**
   * Solicita ao motor heurístico a análise de risco de falha da CPE.
   * Retorna score de risco, fatores individualizados, causas prováveis e ações sugeridas.
   * @param serialNumber - Número de série da CPE
   */
  predictFailure(serialNumber: string): Observable<CpePrediction> {
    return this.http.get<CpePrediction>(
      `${this.API_URL}/${serialNumber}/predict-failure`,
    );
  }

  /**
   * Solicita telemetria sob demanda (on-demand monitoring) para uma CPE.
   * O backend enfileira DOIS jobs RabbitMQ (vitals + standard), dispara Connection Request,
   * e as respostas chegam via WebSocket no evento 'telemetry_update'.
   * @param serialNumber - Número de série da CPE
   */
  requestTelemetry(
    serialNumber: string,
  ): Observable<{ message: string; status: string }> {
    return this.http
      .post<{
        message: string;
        status: string;
      }>(`${environment.apiUrl}/api/cpe/${serialNumber}/telemetry`, {})
      .pipe(timeout(60_000));
  }

  /**
   * Solicita telemetria vitals (8 campos críticos) para resposta rápida (~2s).
   * Dados são armazenados em TelemetryVitals (flat, TTL 48h).
   * @param serialNumber - Número de série da CPE
   */
  requestVitals(
    serialNumber: string,
  ): Observable<{ message: string; status: string }> {
    return this.http
      .post<{
        message: string;
        status: string;
      }>(`${environment.apiUrl}/api/cpe/${serialNumber}/telemetry/vitals`, {})
      .pipe(timeout(30_000));
  }

  /**
   * Busca telemetria do cache Redis SEM disparar coleta na CPE.
   * Ideal para carregar a aba "Informações" com dados recentes.
   * Retorna { success, data, timestamp, ageSeconds } ou 404 se vazio.
   */
  getTelemetryCache(serialNumber: string): Observable<TelemetryCacheResponse> {
    return this.http
      .get<TelemetryCacheResponse>(
        `${environment.apiUrl}/api/cpe/${serialNumber}/telemetry/cache`,
      )
      .pipe(timeout(10_000));
  }

  /**
   * Analise avancada agregada: tendencia optica, reboots, anomalias de trafego,
   * comparacao OLT, correlacao termica, latencia/DNS e trafego por destino.
   */
  getTelemetryAnalysis(serialNumber: string): Observable<TelemetryAnalysis> {
    return this.http
      .get<TelemetryAnalysis>(
        `${environment.apiUrl}/api/cpe/${serialNumber}/telemetry/analysis`,
      )
      .pipe(timeout(30_000));
  }

  // ── Consultas históricas (Time-Series) ────────────────────────────────────

  getTelemetryRaw(
    serialNumber: string,
    hours: number = 6,
  ): Observable<TelemetryHistoryResponse> {
    return this.http
      .get<TelemetryHistoryResponse>(
        `${environment.apiUrl}/api/cpe/${serialNumber}/telemetry/raw`,
        { params: { hours: String(hours) } },
      )
      .pipe(timeout(30_000));
  }

  /**
   * Busca histórico de sinais vitais para os gráficos de performance.
   * Roteado internamente pelo backend:
   *   hours ≤ 48 → TelemetryVitals (flat, frequente)
   *   hours > 48 → TelemetryHourly (agregado por hora, normalizado para shape flat)
   */
  getTelemetryVitalsHistory(
    serialNumber: string,
    hours: number = 6,
  ): Observable<TelemetryHistoryResponse> {
    return this.http
      .get<TelemetryHistoryResponse>(
        `${environment.apiUrl}/api/cpe/${serialNumber}/telemetry/vitals-history`,
        { params: { hours: String(hours) } },
      )
      .pipe(timeout(30_000));
  }

  /**
   * Busca o documento TelemetryVitals mais recente da CPE (1 documento, sem período).
   * Usado para carga inicial da aba Info (padrão híbrido inicial-load + WebSocket override).
   */
  getLatestVitals(
    serialNumber: string,
  ): Observable<{ success: boolean; data: TelemetrySnapshot }> {
    return this.http
      .get<{
        success: boolean;
        data: TelemetrySnapshot;
      }>(`${this.API_URL}/${serialNumber}/telemetry/vitals/latest`)
      .pipe(timeout(10_000));
  }

  getTelemetryHourly(
    serialNumber: string,
    days: number = 7,
  ): Observable<TelemetryHistoryResponse> {
    return this.http
      .get<TelemetryHistoryResponse>(
        `${environment.apiUrl}/api/cpe/${serialNumber}/telemetry/hourly`,
        { params: { days: String(days) } },
      )
      .pipe(timeout(30_000));
  }

  getTelemetryDaily(
    serialNumber: string,
    days: number = 30,
  ): Observable<TelemetryHistoryResponse> {
    return this.http
      .get<TelemetryHistoryResponse>(
        `${environment.apiUrl}/api/cpe/${serialNumber}/telemetry/daily`,
        { params: { days: String(days) } },
      )
      .pipe(timeout(30_000));
  }

  /**
   * Busca histórico de diagnósticos executados na CPE.
   * Query params opcionais:
   *   - type: filtra por tipo (IPPing, TraceRoute, DNSLookup, Download, Upload, NeighboringWiFi)
   *   - limit: quantidade máxima de registros (padrão: 50, máx: 100)
   */
  getDiagnosticHistory(
    serialNumber: string,
    type?: string,
    limit: number = 50,
  ): Observable<DiagnosticHistoryResponse<DiagnosticResult>> {
    const params: any = { limit: String(limit) };
    if (type) params.type = type;
    return this.http.get<DiagnosticHistoryResponse<DiagnosticResult>>(
      `${environment.apiUrl}/api/cpe/${serialNumber}/diagnostics/history`,
      { params },
    );
  }

  /**
   * Aciona um diagnóstico ativo na CPE via TR-069 SetParameterValues.
   * O backend enfileira DiagnosticsState='Requested' + parâmetros de entrada.
   * @param serialNumber - Número de série da CPE
   * @param type - Tipo: 'IPPing' | 'TraceRoute' | 'Download' | 'Upload' | 'DNSLookup'
   * @param params - Parâmetros de entrada do diagnóstico (Host, DownloadURL, etc.)
   */
  runDiagnostic(
    serialNumber: string,
    type: string,
    params: Record<string, string> = {},
  ): Observable<CommandResponse> {
    return this.http.post<CommandResponse>(
      `${environment.apiUrl}/api/cpe/${serialNumber}/diagnostics/run`,
      { type, params },
    );
  }

  /**
   * Cancela um diagnóstico em andamento (ainda não enviado à CPE).
   * @param serialNumber - Número de série da CPE
   * @param diagnosticId - ID do diagnóstico no histórico
   */
  cancelDiagnostic(
    serialNumber: string,
    diagnosticId: string,
  ): Observable<{ success: boolean }> {
    return this.http.delete<{ success: boolean }>(
      `${environment.apiUrl}/api/cpe/${serialNumber}/diagnostics/${diagnosticId}/cancel`,
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
    connections: '1' | '2' | '3' = '1',
  ): Observable<{ message: string; direction: string; url: string }> {
    return this.http.post<{ message: string; direction: string; url: string }>(
      `${environment.apiUrl}/api/cpe/${serialNumber}/speed-test`,
      { direction, url, transport, connections },
    );
  }

  // ── HISTÓRICO ESPECÍFICO POR TIPO DE DIAGNÓSTICO ─────────────────────────────

  /**
   * Busca histórico de Ping da CPE.
   * @param serialNumber - Número de série da CPE
   * @param limit - Quantidade máxima de registros (padrão: 10)
   */
  getPingHistory(
    serialNumber: string,
    limit: number = 10,
  ): Observable<DiagnosticHistoryResponse<PingResult>> {
    return this.http.get<DiagnosticHistoryResponse<PingResult>>(
      `${environment.apiUrl}/api/cpe/${serialNumber}/diagnostics/ping/history`,
      { params: { limit: String(limit) } },
    );
  }

  /**
   * Busca histórico de TraceRoute da CPE.
   * @param serialNumber - Número de série da CPE
   * @param limit - Quantidade máxima de registros (padrão: 10)
   */
  getTraceRouteHistory(
    serialNumber: string,
    limit: number = 10,
  ): Observable<DiagnosticHistoryResponse<TraceRouteResult>> {
    return this.http.get<DiagnosticHistoryResponse<TraceRouteResult>>(
      `${environment.apiUrl}/api/cpe/${serialNumber}/diagnostics/traceroute/history`,
      { params: { limit: String(limit) } },
    );
  }

  /**
   * Busca histórico de Teste de Velocidade da CPE.
   * @param serialNumber - Número de série da CPE
   * @param direction - Direção opcional: 'Download' ou 'Upload'
   * @param limit - Quantidade máxima de registros (padrão: 10)
   */
  getSpeedTestHistory(
    serialNumber: string,
    direction?: 'Download' | 'Upload',
    limit: number = 10,
  ): Observable<DiagnosticHistoryResponse<SpeedTestResult>> {
    const params: any = { limit: String(limit) };
    if (direction) params.direction = direction;
    return this.http.get<DiagnosticHistoryResponse<SpeedTestResult>>(
      `${environment.apiUrl}/api/cpe/${serialNumber}/diagnostics/speed-test/history`,
      { params },
    );
  }

  /**
   * Busca histórico de DNS Lookup da CPE.
   * @param serialNumber - Número de série da CPE
   * @param limit - Quantidade máxima de registros (padrão: 10)
   */
  getDNSLookupHistory(
    serialNumber: string,
    limit: number = 10,
  ): Observable<DiagnosticHistoryResponse<DNSLookupResult>> {
    return this.http.get<DiagnosticHistoryResponse<DNSLookupResult>>(
      `${environment.apiUrl}/api/cpe/${serialNumber}/diagnostics/dns/history`,
      { params: { limit: String(limit) } },
    );
  }

  /**
   * Busca histórico de UDP Echo da CPE.
   * @param serialNumber - Número de série da CPE
   * @param limit - Quantidade máxima de registros (padrão: 10)
   */
  getUDPEchoHistory(
    serialNumber: string,
    limit: number = 10,
  ): Observable<DiagnosticHistoryResponse<UDPEchoResult>> {
    return this.http.get<DiagnosticHistoryResponse<UDPEchoResult>>(
      `${environment.apiUrl}/api/cpe/${serialNumber}/diagnostics/udp-echo/history`,
      { params: { limit: String(limit) } },
    );
  }

  /**
   * Envia um comando de reinicialização (Reboot) para a CPE alvo.
   * @param serialNumber - O número de série da CPE alvo.
   * @param skipBeforeSnapshot - Skip before snapshot (default: false)
   */
  rebootCpe(
    serialNumber: string,
    skipBeforeSnapshot = false,
  ): Observable<CommandResponse> {
    return this.http.post<CommandResponse>(
      `${this.API_URL}/${serialNumber}/reboot`,
      { skipBeforeSnapshot },
    );
  }

  /**
   * Exclui uma CPE do sistema.
   * @param serialNumber - O número de série da CPE alvo.
   */
  deleteCpe(serialNumber: string): Observable<CommandResponse> {
    return this.http.delete<CommandResponse>(`${this.API_URL}/${serialNumber}`);
  }

  // ── SISTEMA DE QUARENTENA ──────────────────────────────────────────────
  // CPEs quarentenadas têm todas as ações outbound suspensas (boot loop severo).
  // Inform ainda é processado — a CPE continua online mas não recebe comandos.

  /**
   * Lista todas as CPEs atualmente em quarentena.
   * @returns Observable com lista de CPEs quarentenadas (campos essenciais).
   */
  getQuarantinedCpes(): Observable<{ cpes: CpeDevice[]; count: number }> {
    return this.http.get<{ cpes: CpeDevice[]; count: number }>(
      `${this.API_URL}/quarantine`,
    );
  }

  /**
   * Coloca uma CPE em quarentena manual.
   * @param serialNumber - O número de série da CPE alvo.
   * @param reason - Motivo da quarentena (texto livre para o técnico).
   */
  quarantineCpe(
    serialNumber: string,
    reason: string,
  ): Observable<CommandResponse> {
    return this.http.post<CommandResponse>(
      `${this.API_URL}/${serialNumber}/quarantine`,
      { reason },
    );
  }

  /**
   * Liberta uma CPE da quarentena.
   * @param serialNumber - O número de série da CPE alvo.
   */
  releaseCpe(serialNumber: string): Observable<CommandResponse> {
    return this.http.delete<CommandResponse>(
      `${this.API_URL}/${serialNumber}/quarantine`,
    );
  }

  /**
   * Limpa o cache de um dispositivo específico (RAM e SessionStorage), forçando a busca de
   * novos dados na próxima requisição.
   * @param serialNumber - O número de série da CPE cujo cache será invalidado.
   */
  clearCache(serialNumber: string): void {
    const keysToClear = [
      `cpe_${serialNumber}`,
      `wifi_hosts_${serialNumber}`,
      `connected_devices_${serialNumber}`,
    ];

    keysToClear.forEach((key) => {
      this.cache.delete(key);
      try {
        sessionStorage.removeItem(key);
      } catch (e) {
        /* Ignora erros caso o sessionStorage não esteja disponível. */
      }
    });
  }

  /**
   * Busca o resumo de saúde da frota para o widget do dashboard.
   * Retorna métricas agregadas: totalCpes, online, offline, neverSeen, criticalAlerts,
   * byManufacturer, byFirmware, lastUpdated.
   */
  getHealthSummary(): Observable<{
    totalCpes: number;
    online: number;
    offline: number;
    neverSeen: number;
    criticalAlerts: number;
    byManufacturer: { name: string; count: number }[];
    byFirmware: { firmware: string; count: number }[];
    lastUpdated: string;
  }> {
    return this.http.get<{
      totalCpes: number;
      online: number;
      offline: number;
      neverSeen: number;
      criticalAlerts: number;
      byManufacturer: { name: string; count: number }[];
      byFirmware: { firmware: string; count: number }[];
      lastUpdated: string;
    }>(`${environment.apiUrl}/api/health-summary`);
  }

  /**
   * Busca alertas de telemetria ativos (status='active') — usado na carga inicial
   * do painel de alertas; atualizações em tempo real chegam via WebSocket.
   */
  getActiveAlerts(): Observable<{ data: TelemetryAlert[]; total: number }> {
    return this.http.get<{ data: TelemetryAlert[]; total: number }>(
      `${environment.apiUrl}/api/alerts/active`,
    );
  }

  /**
   * Reconhece um alerta (marcando como tratado pelo técnico).
   * @param alertId - ID do alerta no MongoDB
   */
  acknowledgeAlert(alertId: string): Observable<TelemetryAlert> {
    return this.http.post<TelemetryAlert>(
      `${environment.apiUrl}/api/alerts/${alertId}/acknowledge`,
      {},
    );
  }

  /**
   * Busca métricas de saúde dos workers (XML Parser Pool, RabbitMQ, Process Node).
   * Endpoint leve sem tocar MongoDB - permite polling real a baixo custo.
   */
  getWorkerHealth(): Observable<{
    xmlParser: {
      poolSize: number;
      activeWorkers: number;
      queueSize: number;
      totalParsed: number;
      avgProcessingTimeMs: number;
      p95ProcessingTimeMs: number;
      lastMemoryUsageMB: number;
      errors: number;
    };
    rabbitmq: {
      messageCount: number;
      consumerCount: number;
    };
    process: {
      rssMB: number;
      heapUsedMB: number;
      uptimeSeconds: number;
    };
    timestamp: string;
  }> {
    return this.http.get<{
      xmlParser: {
        poolSize: number;
        activeWorkers: number;
        queueSize: number;
        totalParsed: number;
        avgProcessingTimeMs: number;
        p95ProcessingTimeMs: number;
        lastMemoryUsageMB: number;
        errors: number;
      };
      rabbitmq: {
        messageCount: number;
        consumerCount: number;
      };
      process: {
        rssMB: number;
        heapUsedMB: number;
        uptimeSeconds: number;
      };
      timestamp: string;
    }>(`${environment.apiUrl}/api/system/health/workers`);
  }

  /**
   * Busca saúde do sistema (endpoint público /health — sem auth).
   * Retorna version, uptime, mongodb, redis, memory, admission, mongoCircuit.
   * Usado pelo painel de monitoramento ACS do dashboard.
   */
  getSystemHealth(): Observable<{
    status: string;
    version: string;
    uptime: number;
    timestamp: string;
    mongodb: string;
    redis: string;
    memory: { heapUsed: number; heapTotal: number; rss: number };
    admission: {
      circuitOpen: boolean;
      eventLoopLagMs: number;
      admitted: number;
      rejected: number;
    };
    mongoCircuit: { state: string; failureCount: number };
  }> {
    return this.http.get<{
      status: string;
      version: string;
      uptime: number;
      timestamp: string;
      mongodb: string;
      redis: string;
      memory: { heapUsed: number; heapTotal: number; rss: number };
      admission: {
        circuitOpen: boolean;
        eventLoopLagMs: number;
        admitted: number;
        rejected: number;
      };
      mongoCircuit: { state: string; failureCount: number };
    }>(`${environment.apiUrl}/health`);
  }

  /**
   * Busca breakdown do Health Score por CPE (5 componentes + total).
   */
  getHealthScoreBreakdown(serialNumber: string): Observable<{
    total: number;
    components: Record<string, { score: number; weight: number }>;
  }> {
    return this.http
      .get<any>(
        `${environment.apiUrl}/api/cpe/${serialNumber}/health-score-breakdown`,
      )
      .pipe(timeout(10_000));
  }

  /**
   * Busca alertas de telemetria específicos de uma CPE.
   */
  getCpeAlerts(serialNumber: string): Observable<{ data: any[] }> {
    return this.http
      .get<any>(`${environment.apiUrl}/api/cpe/${serialNumber}/alerts`)
      .pipe(timeout(10_000));
  }

  /**
   * Busca status de Modo Incidente da CPE.
   */
  getIncidentStatus(
    serialNumber: string,
  ): Observable<{ active: boolean; expiresInSeconds: number | null }> {
    return this.http
      .get<any>(`${environment.apiUrl}/api/cpe/${serialNumber}/incident-status`)
      .pipe(timeout(10_000));
  }

  /**
   * Busca última intervenção (AuditLog REBOOT + snapshots before/after).
   */
  getLastIntervention(serialNumber: string): Observable<{
    found: boolean;
    before?: any;
    after?: any;
    pending?: boolean;
  }> {
    return this.http
      .get<any>(
        `${environment.apiUrl}/api/cpe/${serialNumber}/last-intervention`,
      )
      .pipe(timeout(10_000));
  }
}
