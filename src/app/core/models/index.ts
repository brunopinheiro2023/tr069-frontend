// =============================================================================
// CAMINHO DO ARQUIVO: frontend/src/app/core/models/index.ts
// =============================================================================
// Interfaces tipadas que espelham o schema MongoDB do backend (Cpe.js).
// Elimina o uso de `any` nos componentes, ativando o type-checking do TypeScript
// e prevenindo regressões em tempo de compilação.
//
// Sempre que o backend alterar o schema, este arquivo deve ser atualizado.
// =============================================================================

/** Resposta padrão para comandos RPC enfileirados (Set, Reboot, etc). */
export interface CommandResponse {
  message: string;
  taskId?: string; // ID da tarefa no RabbitMQ/Redis para rastreamento
  diagnosticId?: string; // ID do diagnóstico para cancelamento
}

/** Parâmetro para envio em um comando SetParameterValues. */
export interface CpeParameterPayload {
  name: string;
  value: string | number | boolean;
  type?: string;
}

/**
 * Parâmetro individual da árvore TR-069 / TR-181 da CPE.
 * O backend armazena como array de objetos para evitar chaves com pontos no MongoDB.
 */
export interface CpeParameter {
  /** Path completo do parâmetro. Ex: Device.WiFi.SSID.1.SSID */
  name: string;
  /** Valor atual retornado pela CPE (sempre string no banco). */
  value: string;
  /** Tipo SOAP. Ex: xsd:string, xsd:boolean, xsd:unsignedInt */
  type?: string;
  /** Indica se o ACS tem permissão para alterar via SetParameterValues. */
  writable?: boolean;
}

/**
 * Parâmetro do cache interno do ACS (campo `parametersCache` do Mongoose).
 * Difere de CpeParameter: inclui metadados de cache (lastSeen, cachedAt).
 */
export interface CpeParameterCached {
  name: string;
  value: string;
  lastSeen?: string;  // ISO 8601 — última vez visto na CPE
  cachedAt?: string;  // ISO 8601 — quando foi armazenado no cache
}

/**
 * Dados de uma banda Wi-Fi (2.4GHz ou 5GHz) extraídos do Inform.
 */
export interface CpeWifiBand {
  ssid?: string;
  status?: string; // 'Up' | 'Down' | 'Enabled' | 'Lowerlayerdown' | etc.
  channel?: number;
  enable?: boolean;
}

/**
 * Tarefa pendente enfileirada no ACS para execução na próxima sessão TR-069.
 */
export interface CpePendingTask {
  name: string; // Ex: 'SetParameterValues', 'Reboot', 'GetParameterValues'
  intent?: string; // Granularidade de dedup: 'config', 'radio', 'wifi-correction'
  payload?: any; // Payload dinâmico dependendo do método RPC
  issuedBy?: string; // ID do técnico (ObjectId do MongoDB como string)
  issuedByName?: string; // Snapshot do nome para auditoria
  status?: 'pending' | 'sent' | 'done' | 'failed';
  createdAt?: string; // ISO 8601
}

/**
 * Documento completo de uma CPE, espelhando o schema MongoDB.
 */
export interface CpeDevice {
  _id?: string; // MongoDB ObjectId
  serialNumber: string;
  oui: string;
  manufacturer: string;
  productClass?: string;

  // Dados de gerência
  softwareVersion?: string;
  hardwareVersion?: string;
  connectionRequestURL?: string;
  connectionRequestUsername?: string;
  connectionRequestPassword?: string;

  // Árvore de parâmetros TR-069 / TR-181
  parameters?: CpeParameter[];
  /**
   * Cache de parâmetros TR-069 retornado pelo backend (campo real do MongoDB).
   * Inclui metadados de timestamp. Substitui o acesso por `parameters` que não é
   * populado diretamente pelo endpoint getCpeDetails.
   */
  parametersCache?: CpeParameterCached[];
  wanIp?: string;
  wanSubnetMask?: string;
  wanGateway?: string;
  wanDnsIsp?: string;
  wanDnsManual?: string[];
  wanMtu?: number;
  wanVlanId?: number;
  pppoeUsername?: string;
  wanConfigUpdatedAt?: string; // ISO 8601
  isOnline?: boolean;
  lastInform?: string; // ISO 8601

  // Métricas ópticas GPON/EPON
  opticalRx?: number; // dBm (ex: -23.5)
  opticalTx?: number; // dBm (ex: 2.1)

  // Health Score calculado pelo backend a cada hora
  healthScore?: number;          // 0-100
  healthScoreUpdatedAt?: string; // ISO 8601

  // Wi-Fi
  wifi2g?: CpeWifiBand;
  wifi5g?: CpeWifiBand;

  // Fila de comandos
  pendingTasks?: CpePendingTask[];

  // Timestamps do Mongoose
  createdAt?: string;
  updatedAt?: string;
}

/**
 * Resposta paginada padrão do backend para listagens (ex: GET /api/cpe).
 */
export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    total: number;
    totalPages: number;
    currentPage: number;
    limit: number;
  };
}

/**
 * Diagnóstico de rede completo retornado pelo analisador do backend.
 * Inclui Wi-Fi, IPPing, TraceRoute, Download, Upload, DNS e WiFi vizinho.
 */
export interface WifiDiagnosticsData {
  serialNumber: string;
  manufacturer?: string;
  profile?: string;
  timestamp?: string;

  bands: {
    '2.4GHz': WifiBandDiagnostics;
    '5GHz': WifiBandDiagnostics;
  };

  summary: {
    totalClients: number;
    hasCongestion: boolean;
    criticalClients: number;
  };
  alerts: WifiAlert[];
  recommendations?: WifiRecommendation[];
  channelSaturation?: ChannelSaturationData;

  // ── Diagnósticos de rede (IPPing, TraceRoute, Download, Upload, DNS) ─────
  pingAverageResponseTime?: number;      // Tempo médio de ping (ms)
  pingSuccessCount?: number;             // Pings com sucesso
  pingFailureCount?: number;             // Pings com falha
  pingMinResponseTime?: number;          // Tempo mínimo (ms)
  pingMaxResponseTime?: number;          // Tempo máximo (ms)

  traceRouteResponseTime?: number;       // Tempo total TraceRoute (ms)
  traceRouteHopCount?: number;           // Número de hops

  downloadTestBytesReceived?: number;    // Bytes recebidos no teste
  downloadTestTotalBytesReceived?: number; // Total acumulado

  uploadTestBytesSent?: number;          // Bytes enviados no teste
  uploadTestTotalBytesSent?: number;     // Total acumulado

  dnsLookupSuccessCount?: number;        // Lookups DNS com sucesso
  dnsLookupResultCount?: number;         // Resultados DNS retornados
  dnsDiagnosticsState?: string;          // Estado do diagnóstico DNS

  neighboringWiFiResultCount?: number;   // Redes WiFi vizinhas detectadas

  // ── Estado dos diagnósticos (string retornada pela CPE) ──────────────────
  pingDiagnosticsState?: string;         // None | Requested | Complete | Error_*
  traceRouteDiagnosticsState?: string;
  downloadDiagnosticsState?: string;
  uploadDiagnosticsState?: string;

  // ── Host/URL do último diagnóstico executado ─────────────────────────────
  pingHost?: string;
  traceRouteHost?: string;

  // ── Array de hops do TraceRoute ───────────────────────────────────────────
  traceRouteHops?: Array<{ host: string; hopCount: number; rtt: number }>;

  // ── Array de resultados DNS Lookup ────────────────────────────────────────
  dnsLookupResults?: Array<{ ipAddress: string; status: string }>;

  // ── Estado e contadores UDPEcho ───────────────────────────────────────────
  udpechoEnabled?: boolean;
  udpechoPacketsReceived?: number;
  udpechoPacketsResponded?: number;
  udpechoBytesReceived?: number;
  udpechoBytesResponded?: number;
  udpechoUDPPort?: number;
  udpechoSourceIP?: string;

  // ── Capacidades de diagnóstico (booleanos) ───────────────────────────────
  ipPingSupported?: boolean;
  ipTraceRouteSupported?: boolean;
  ipDownloadSupported?: boolean;
  ipUploadSupported?: boolean;
  ipUdpEchoSupported?: boolean;

  pagination?: {
    page: number;
    limit: number;
  };
}

export interface WifiBandDiagnostics {
  congestion: {
    isCongested: boolean;
    severity: string;
    errorRate: number;
    discardRate: number;
    message: string;
  };
  channelSuggestion: {
    shouldChange: boolean;
    currentChannel: number;
    suggestedChannel: number;
    reason: string;
  };
  clientAnalysis: WifiClient[];
  qualityDistribution: Record<string, number>;
  totalClients: number;
}

export interface WifiClient {
  macAddress: string;
  ipAddress?: string;
  quality: string; // 'Excelente' | 'Bom' | 'Fraco' | 'Crítico'
  rssi: number; // dBm
  recommendation?: string;
}

/** Cliente Wi-Fi unificado: mesclagem de WifiClient (RSSI/qualidade) + WifiHost (IP/SSID/QoE). */
export interface MergedWifiClient {
  macAddress: string;
  hostName: string;
  ipAddress: string | null;
  active: boolean;
  status: 'ativo' | 'ocioso' | 'inativo';
  band: string;
  ssid: string | null;
  clientType: string | null;
  rssi: number | null;
  quality: string | null;
  recommendation: string | null;
  qoe: number | null;
  qoeLabel: string;
  downSpeedMbps: number | null;
  upSpeedMbps: number | null;
  operatingStandard: string | null;
}

export interface WifiAlert {
  band: string;
  type: 'warning' | 'error' | 'info';
  severity: 'low' | 'medium' | 'high' | 'critical';
  message: string;
  recommendation?: string;
}

export interface WifiRecommendation {
  id?: string;
  title: string;
  description: string;
  parameters?: { name: string; value: string; type: string }[];
}

/**
 * Dados de saturação de canais por banda (saída do wifiNeighborScanService).
 * channels é um mapa canal → dados (ex: { 1: {...}, 6: {...}, 11: {...} })
 */
export interface ChannelSaturationData {
  serialNumber?: string;
  isRealData: boolean;
  timestamp?: string;
  bands?: {
    '2.4GHz': ChannelSaturationBand;
    '5GHz': ChannelSaturationBand;
  };
}

export interface ChannelSaturationBand {
  band: string;
  timestamp?: string;
  demo?: boolean;            // true quando são dados simulados (sem varredura real)
  totalNeighbors?: number;   // soma total de vizinhos na banda
  channels: Record<number, ChannelEntry>;
  suggestion?: ChannelSuggestion; // sugestão de troca de canal com aplicação automática
}

export interface ChannelEntry {
  channel: number;
  neighborCount: number;
  interferenceScore?: number;   // score ponderado (RSSI + sobreposição + largura)
  avgRssi?: number | null;      // RSSI médio dos vizinhos diretos (dBm)
  noiseLevel: number;           // dBm estimado
  congestionLevel: 'Alto' | 'Médio' | 'Baixo';
}

export interface ChannelSuggestion {
  bestChannel: number;
  currentChannel: number;
  currentScore: number;
  bestScore: number;
  improvement: number;
  shouldChange: boolean;
  reason: string;
  parameterPath: string;
}

/**
 * Host Wi-Fi enriquecido (Device.Hosts × Device.WiFi.DataElements X_TP_).
 * Resultado do endpoint GET /api/cpe/:serial/wifi-hosts.
 */
export interface WifiHost {
  macAddress: string;
  hostName: string;
  ipAddress: string | null;
  active: boolean;
  status: 'ativo' | 'ocioso' | 'inativo'; // determinado por tráfego (bytesSent/bytesReceived)
  band: '2.4GHz' | '5GHz' | 'Desconhecida' | string;
  ssid: string | null;           // nome da rede Wi-Fi ao qual o host está conectado
  clientType: string | null;     // X_TP_ClientType: 'Android', 'IP Camera', 'iPhone', etc.

  // Métricas DataElements X_TP_ (null quando firmware não expõe)
  qoe: number | null;               // 0–100 (TP-Link X_TP_QoE)
  qoeLabel: 'Excelente' | 'Bom' | 'Regular' | 'Ruim' | 'N/A';
  downSpeedMbps: number | null;     // X_TP_DownSpeed
  upSpeedMbps: number | null;       // X_TP_UpSpeed
  operatingStandard: string | null; // ex: '802.11ax', '802.11ac', '802.11n'
  clientEfficiencyRate: number | null; // % X_TP_ClientEfficiencyRate
  noiseDbm: number | null;          // X_TP_Noise
  signalStrengthDbm: number | null; // X_TP_SignalStrength (DataElements)
  snrDb: number | null;             // X_TP_Snr
}

/** Ação corretiva proposta por um insight (quando actionable=true). */
export interface WifiInsightAction {
  type: 'set_channel' | 'set_power' | 'enable_beamforming' | 'info';
  band: '2.4GHz' | '5GHz';
  parameter: string;  // caminho TR-181 para SetParameterValues
  value: string;
}

/** Insight determinístico gerado pelo wifiInsightsService. */
export interface WifiInsight {
  id: string;
  severity: 'info' | 'warning' | 'critical';
  category: 'canal' | 'sinal' | 'qoe' | 'configuracao' | 'saturacao';
  title: string;
  description: string;
  sourceParam: string;  // parâmetro TR-181 que originou o insight
  actionable: boolean;
  action?: WifiInsightAction;
}

/** Resposta completa do endpoint GET /api/cpe/:serial/wifi-hosts. */
export interface WifiHostsData {
  serialNumber: string;
  manufacturer: string | null;
  timestamp: string;
  dataElementsAvailable: boolean;  // false quando CPE não expõe X_TP_ DataElements
  totalHosts: number;
  hosts: WifiHost[];
  insights: WifiInsight[];
  insightsSummary: {
    total: number;
    critical: number;
    warnings: number;
    info: number;
  };
}

/**
 * Dispositivo conectado via Ethernet (cabo).
 */
export interface EthernetDevice {
  macAddress: string;
  hostName: string;
  ipAddress: string | null;
  active: boolean;
  connectionType: 'Ethernet';
  portName: string | null;  // X_TP_IfNameAlias: ex: 'LAN1', 'LAN2'
  clientType: string | null;
}

/**
 * Resposta completa do endpoint GET /api/cpe/:serial/devices.
 * Inclui dispositivos Wi-Fi + Ethernet conectados à CPE.
 */
export interface ConnectedDevicesData {
  serialNumber: string;
  manufacturer: string | null;
  timestamp: string;
  wifiDevices: WifiHost[];
  ethernetDevices: EthernetDevice[];
  totalDevices: number;
}

/**
 * Notificação toast exibida na interface.
 */
export interface ToastNotification {
  id: number;
  message: string;
  type: 'success' | 'info' | 'error' | 'warning';
}

// =============================================================================
// PREDIÇÃO DE FALHAS (Motor Heurístico — futuramente substituído por LSTM)
// =============================================================================

export interface CpePredictionFactor {
  score: number | null;       // 0-100 (pior = maior), null se indisponível
  status: 'good' | 'warning' | 'critical' | 'unavailable';
  value: number | null;
  message: string;
}

export interface CpePredictionInsights {
  causes: string[];
  actions: string[];
}

export interface CpePredictionResult {
  score: number | null;
  riskLevel: 'low' | 'medium' | 'high' | 'critical' | 'insufficient_data';
  riskLabel: string;
  failureProbability: number;
  estimatedTimeToFailure: string;
}

export interface CpePrediction {
  serialNumber: string;
  analyzedAt: string;
  algorithmVersion: string;
  prediction: CpePredictionResult;
  factors: {
    gponSignal?: CpePredictionFactor;
    connectivity?: CpePredictionFactor;
    memoryHealth?: CpePredictionFactor;
    cpuHealth?: CpePredictionFactor;
    hostStability?: CpePredictionFactor;
    wifiNoise?: CpePredictionFactor;
    opticalTrend?: CpePredictionFactor;
    memoryLeakTrend?: CpePredictionFactor;
    laserHealth?: CpePredictionFactor;
  };
  previousFactors?: {
    gponSignal?: CpePredictionFactor;
    connectivity?: CpePredictionFactor;
    memoryHealth?: CpePredictionFactor;
    cpuHealth?: CpePredictionFactor;
    hostStability?: CpePredictionFactor;
    wifiNoise?: CpePredictionFactor;
    opticalTrend?: CpePredictionFactor;
    memoryLeakTrend?: CpePredictionFactor;
    laserHealth?: CpePredictionFactor;
  };
  insights: CpePredictionInsights;
}

// =============================================================================
// TELEMETRIA EM TEMPO REAL (On-Demand Monitoring)
// =============================================================================

export interface TelemetryMetric {
  value: string;
  unit: string;
  description: string;
}

// Subdocumentos modulares para telemetria estruturada
export interface SystemTelemetry {
  upTime: number;
  cpuUsage: number;
  memoryFree: number;
  memoryTotal: number;
  temperature?: number;
}

export interface WanTelemetry {
  status?: string;
  ipv4Address?: string;
  dnsServers?: string;
  ipv6Status?: string;
  ipv6Address?: string;
}

export interface OpticalTelemetry {
  xponStatus?: string;
  rxPower?: number;
  txPower?: number;
  temperature?: number;
  voltage?: number;
  biasCurrent?: number;
  distance?: number;
  downstreamRate?: number;
  upstreamRate?: number;
}

export interface WifiRadioTelemetry {
  channel?: number;
  transmitPower?: number;
  noise?: number;
  clients?: number;
  snr?: number;
  utilization?: number;
  errorsReceived?: number;
  errorsSent?: number;
  signalStrength?: number;
  congestionRate?: number;
  averageRxRate?: number;
  averageTxRate?: number;
}

export interface WifiTelemetry {
  radio2g?: WifiRadioTelemetry;
  radio5g?: WifiRadioTelemetry;
}

export interface LanTelemetry {
  hostCount?: number;
}

/**
 * Alerta de telemetria — transição de estado de uma métrica vital (threshold).
 * Espelha o schema TelemetryAlert do backend.
 */
export interface TelemetryAlert {
  _id?: string;
  serialNumber: string;
  metric: string;             // 'opticalRx' | 'cpuUsage' | 'wifi2gNoise' | 'wifi5gNoise'
  severity: 'warning' | 'critical';
  status: 'active' | 'resolved';
  value?: number;
  threshold?: number;
  triggeredAt: string;        // ISO 8601
  resolvedAt?: string | null;
  message: string;
  acknowledgedBy?: string | null;
  acknowledgedAt?: string | null;
}

export interface TelemetryData {
  // NOTA ARQUITETURAL: dados chegam em formato FLAT via WebSocket e REST cache.
  // Métricas chegam como chaves diretas: cpuUsage, opticalRx, wanStatus, etc.
  // O indexer [metricKey: string]: any suporta o formato real de dados.
  [metricKey: string]: any;   // Formato real: chaves diretas do backend (cpuUsage, opticalRx, etc.)
}

export interface TelemetryUpdateEvent {
  serialNumber: string;
  data: TelemetryData;
  timestamp: string;
}

/** Resposta do cache de telemetria do Redis. */
export interface TelemetryCacheResponse {
  success: boolean;
  serialNumber: string;
  data: TelemetryData;
  timestamp: number;
  ageSeconds: number;
  message: string;
}

/** Snapshot individual de telemetria para séries temporais. */
export interface TelemetrySnapshot {
  timestamp: string;
  cpuUsage?: number;
  memoryUsage?: number;      // percentual calculado (legacy WebSocket cache)
  memoryFree?: number;       // KB bruto (TelemetryVitals)
  memoryTotal?: number;      // KB bruto (TelemetryVitals)
  opticalRx?: number;
  opticalTx?: number;
  wanStatus?: string;        // NOVO — disponível em TelemetryVitals
  gponStatus?: string;       // NOVO — disponível em TelemetryVitals
  hostCount?: number;        // NOVO — número de hosts conectados (TelemetryVitals)
  source?: string;           // NOVO — 'vitals' | 'hourly' (para debug)
}

/** Resposta para endpoints de séries temporais. */
export interface TelemetryHistoryResponse {
  success: boolean;
  data: TelemetrySnapshot[];
  hours?: number;
  days?: number;
  count: number;
}

/** Análise de tendência para uma métrica específica. */
export interface TrendAnalysis {
  serialNumber: string;
  days: number;
  sampleCount: number;
  reliableModel: boolean;
  r2: number;
  rxTrend: { slopePerDay: number; r2: number; direction: 'degrading' | 'improving' | 'stable' };
  txTrend: { slopePerDay: number; r2: number };
  alert: boolean;
  severity: 'critical' | 'warning' | 'good';
  message: string;
}

/** Análise de estabilidade de reboots. */
export interface RebootStabilityAnalysis {
  serialNumber: string;
  days: number;
  sampleCount: number;
  rebootCount: number;
  rebootEvents: { at: Date; previousUptime: number; newUptime: number }[];
  uptimeHours: number | null;
  rebootsPerWeek: number;
  stability: 'excellent' | 'good' | 'fair' | 'poor';
  alert: boolean;
  message: string;
}

/** Análise de anomalias de tráfego. */
export interface TrafficAnomaliesAnalysis {
  serialNumber: string;
  hours: number;
  sampleCount: number;
  deltaCount: number;
  anomalyCount: number;
  anomalies: { timestamp: Date; type: string; valueMbps: number; avgMbps: number }[];
  alert: boolean;
  message: string;
}

/** Comparação com outras CPEs na mesma OLT. */
export interface OltComparisonAnalysis {
  serialNumber: string;
  wanIp: string;
  subnet: string;
  peerCount: number;
  onlinePeerCount?: number;
  targetRx: number | null;
  peerAvgRx: number | null;
  peerMinRx: number | null;
  peerMaxRx: number | null;
  diffFromAvg: number | null;
  isOutlier: boolean;
  isGroupProblem: boolean;
  alert: boolean;
  severity: 'group_issue' | 'local_issue' | 'normal';
  message: string;
  peers: { serialNumber: string; wanIp: string; opticalRx: number | null; isOnline: boolean }[];
}

/** Correlação entre temperatura e performance. */
export interface ThermalCorrelationAnalysis {
  serialNumber: string;
  days: number;
  sampleCount: number;
  pairedCount: number;
  tempStats: { avg: number | null; max: number | null };
  cpuStats: { avg: number | null };
  correlation: number | null;
  diagnosis: 'ventilation_issue' | 'overheating' | 'normal';
  alert: boolean;
  message: string;
}

/** Análise de latência e DNS. */
export interface LatencyDnsAnalysis {
  serialNumber: string;
  hasData: boolean;
  latency: {
    target: string;
    avgMs: number | null;
    minMs: number | null;
    maxMs: number | null;
    successCount: number | null;
    measuredAt: Date | null;
  } | null;
  quality: 'excellent' | 'good' | 'fair' | 'poor';
  alert: boolean;
  message: string;
}

/** Destinos de tráfego mais comuns. */
export interface TopDestination {
  destination: string;
  bytes: number;
  percent: number;
}

/** Análise de Qualidade Wi-Fi (2.4GHz e 5GHz). */
export interface WifiQualityAnalysis {
  band: '2g' | '5g';
  snrAvg: number | null;
  noiseFloor: number | null;
  clientCount: number | null;
  severity: 'ok' | 'warning' | 'critical';
  alert: boolean;
  message: string;
}

/** Análise de Margem Óptica GPON. */
export interface GponLinkBudgetAnalysis {
  rxPower: number;
  txPower: number | null;
  rxMargin: number;
  severity: 'ok' | 'warning' | 'critical';
  alert: boolean;
  message: string;
}

/** Análise de Envelhecimento do Transceiver (30 dias). */
export interface TransceiverAgingAnalysis {
  days: number;
  sampleCount: number;
  biasSlopePerDay: number;
  currentBias: number;
  severity: 'ok' | 'warning' | 'critical';
  alert: boolean;
  message: string;
}

/** Resposta completa da análise avançada de telemetria. */
export interface TelemetryAnalysis {
  serialNumber: string;
  analyzedAt: string;
  summary: {
    overallHealth: 'good' | 'warning' | 'critical' | 'unknown';
    alertCount: number;
    alerts: {
      severity: 'info' | 'warning' | 'critical';
      message: string;
    }[];
  };
  analyses: {
    opticalTrend?: TrendAnalysis;
    rebootStability?: RebootStabilityAnalysis;
    trafficAnomalies?: TrafficAnomaliesAnalysis;
    oltComparison?: OltComparisonAnalysis;
    thermalCorrelation?: ThermalCorrelationAnalysis;
    latencyDns?: LatencyDnsAnalysis;
    topDestinations?: {
      serialNumber: string;
      periodHours: number;
      totalRxGb: number;
      totalTxGb: number;
      peakHours: number[];
      usagePattern: string;
      estimatedTopCategories: string[];
      message: string;
    };
    wanErrors?: any;
    laserHealth?: any;
    memoryLeak?: any;
    powerSupply?: any;
    wifiQuality2g?: WifiQualityAnalysis;
    wifiQuality5g?: WifiQualityAnalysis;
    gponLinkBudget?: GponLinkBudgetAnalysis;
    transceiverAging?: TransceiverAgingAnalysis;
  };
}

// =============================================================================
// DIAGNÓSTICOS (Histórico)
// =============================================================================

/** Resultado de um diagnóstico de Ping. */
export interface PingResult {
  diagnosticsState: string;
  host: string;
  successCount: number;
  failureCount: number;
  averageResponseTime: number;
  minResponseTime: number;
  maxResponseTime: number;
  timestamp: string;
}

/** Resultado de um diagnóstico de TraceRoute. */
export interface TraceRouteResult {
  diagnosticsState: string;
  host: string;
  hopCount: number;
  responseTime: number;
  hops: { hopNumber: number; ipAddress: string; responseTime: number; }[];
  timestamp: string;
}

/** Resultado de um diagnóstico de Teste de Velocidade (TR-143). */
export interface SpeedTestResult {
  diagnosticsState: string;
  direction: 'Download' | 'Upload';
  testBytesReceived?: number;
  totalBytesReceived?: number;
  testBytesSent?: number;
  totalBytesSent?: number;
  BOMTime: number;
  EOMTime: number;
  ROMTime: number;
  timestamp: string;
}

/** Resultado de um diagnóstico de DNS. */
export interface DNSLookupResult {
  diagnosticsState: string;
  dnsServer: string;
  hostName: string;
  results: { status: string; answerType: string; hostName: string; ipAddresses: string; dnsServerIp: string; responseTime: number; }[];
  timestamp: string;
}

/** Resultado de um diagnóstico de UDP Echo. */
export interface UDPEchoResult {
  diagnosticsState: string;
  packetsReceived: number;
  packetsResponded: number;
  bytesReceived: number;
  bytesResponded: number;
  timestamp: string;
}

/** Resultado de uma varredura de redes vizinhas. */
export interface WifiNeighborResult {
  channel: number;
  ssid: string;
  bssid: string;
  signalStrength: number;
  band: string;
  channelBandwidth: string;
  timestamp: string;
}

/** Entrada genérica no histórico de diagnósticos. */
export type DiagnosticResult = PingResult | TraceRouteResult | SpeedTestResult | DNSLookupResult | UDPEchoResult | WifiNeighborResult;

/** Resposta para endpoints de histórico de diagnósticos. */
export interface DiagnosticHistoryResponse<T extends DiagnosticResult> {
  success: boolean;
  data: T[];
  count: number;
}
