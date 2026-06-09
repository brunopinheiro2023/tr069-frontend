// =============================================================================
// CAMINHO DO ARQUIVO: frontend/src/app/core/models/index.ts
// =============================================================================
// Interfaces tipadas que espelham o schema MongoDB do backend (Cpe.js).
// Elimina o uso de `any` nos componentes, ativando o type-checking do TypeScript
// e prevenindo regressões em tempo de compilação.
//
// Sempre que o backend alterar o schema, este arquivo deve ser atualizado.
// =============================================================================

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
  wanIp?: string;
  isOnline?: boolean;
  lastInform?: string; // ISO 8601

  // Métricas ópticas GPON/EPON
  opticalRx?: number; // dBm (ex: -23.5)
  opticalTx?: number; // dBm (ex: 2.1)

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
  score: number;       // 0-100 (pior = maior)
  status: 'good' | 'warning' | 'critical';
  value: number | null;
  message: string;
}

export interface CpePredictionInsights {
  causes: string[];
  actions: string[];
}

export interface CpePredictionResult {
  score: number;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  riskLabel: string;
  failureProbability: number;
  estimatedTimeToFailure: string;
}

export interface CpePrediction {
  serialNumber: string;
  analyzedAt: string;
  prediction: CpePredictionResult;
  factors: {
    gponSignal: CpePredictionFactor;
    connectivity: CpePredictionFactor;
    memoryHealth: CpePredictionFactor;
    cpuHealth: CpePredictionFactor;
    hostStability: CpePredictionFactor;
    wifiNoise: CpePredictionFactor;
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

export interface TelemetryData {
  [metricKey: string]: TelemetryMetric;
}

export interface TelemetryUpdateEvent {
  serialNumber: string;
  data: TelemetryData;
  timestamp: string;
}
