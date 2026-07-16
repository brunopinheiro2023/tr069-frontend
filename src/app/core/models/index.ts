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
  lastSeen?: string; // ISO 8601 — última vez visto na CPE
  cachedAt?: string; // ISO 8601 — quando foi armazenado no cache
}

/**
 * Access Point Wi-Fi (sub-schema do novo schema MongoDB).
 * Espelha AccessPointSchema em src/models/Cpe.js — manter sincronizado.
 */
export interface CpeAccessPoint {
  index: number;
  ssid?: string | null;
  /** MAC Address do rádio Wi-Fi do AP (ex: 'AA:BB:CC:DD:EE:FF'). Coletado no wifi-bootstrap-probe. */
  bssid?: string | null;
  enable?: boolean | null;
  status?: string | null;
  apType?: string | null;
  security?: string | null;
  hidden?: boolean | null;
  isolation?: boolean | null;
  beamforming?: boolean | null;
  lanAccess?: boolean | null;
  tcEnable?: boolean | null;
  tcMaxDown?: number | null;
  tcMaxUp?: number | null;
  usbAccess?: boolean | null;
  wpsEnable?: boolean | null;
  wmmEnable?: boolean | null;
  utilization?: number | null;
  tcMinDown?: number | null;
  tcMinUp?: number | null;
  atf?: boolean | null;
  muMimo?: boolean | null;
  ofdma?: boolean | null;
  twt?: boolean | null;
  /** BSS Color (802.11ax) — Device.WiFi.AccessPoint.{i}.BSSColorEnable. TP-Link TR-181 apenas. */
  bssColor?: boolean | null;
  /** MACs dos clientes atualmente associados a este AP. Populado pelo host-snapshot GPV. */
  connectedMacs?: string[];
}

/**
 * Dados de uma banda Wi-Fi (2.4GHz ou 5GHz) com sub-objetos aninhados.
 */
export interface CpeWifiBand {
  channel?: string; // String no schema Mongoose (ex: "6", "11") — consistente com handleInform
  bandwidth?: string; // OperatingChannelBandwidth normalizado — ex: "20", "40", "80", "160"
  txPower?: number;
  txPowerSupported?: string; // CSV com valores aceitos, ex: "25,50,100" (TR-181 TransmitPowerSupported)
  enable?: boolean;
  status?: string; // Status da banda (ex: "Up", "Down")
  autoChannelEnable?: boolean; // true quando CPE gerencia canal automaticamente
  accessPoints?: CpeAccessPoint[];
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
 * Sub-objeto deviceInfo do novo schema MongoDB.
 */
export interface CpeDeviceInfo {
  manufacturer?: string;
  manufacturerCode?: string;
  productClass?: string;
  softwareVersion?: string;
  hardwareVersion?: string;
  uptime?: number;
  memTotal?: number;
  macAddress?: string;
}

/**
 * Sub-objeto management do novo schema MongoDB.
 */
export interface CpeManagement {
  connectionRequestURL?: string;
  connectionRequestUsername?: string;
  connectionRequestPassword?: string;
  remoteHttpEnabled?: boolean;
  remoteHttpsEnabled?: boolean;
  remoteIcmpEnabled?: boolean;
  remoteAccessEnable?: boolean | null;
  remoteAccessPort?: number | null;
  remoteAccessProtocol?: string | null;
  remoteAccessHost?: string | null;
  remoteAccessAll?: string | null;
  sHttpRemoteEnabled?: boolean | null;
  sHttpsRemoteEnabled?: boolean | null;
  cpeId?: string | null;
  gponSnType?: string | null;
  boundIfName?: string | null;
  connReqPort?: number | null;
}

/**
 * Sub-objeto wan do novo schema MongoDB.
 */
export interface CpeWan {
  ip?: string;
  ipv6?: string;
  subnetMask?: string;
  gateway?: string;
  dnsIsp?: string;
  mtu?: number;
  vlanId?: number;
  pppoeUsername?: string;
  status?: string;
  updatedAt?: string;
  wanIndex?: string;
  ipWanIndex?: string;
  vlanWanIndex?: string;
  connType?: string | null;
  serviceType?: string | null;
  connectionTrigger?: string | null;
  authProtocol?: string | null;
}

/**
 * Sub-objeto wifiConfig do novo schema MongoDB.
 */
export interface CpeWifiConfig {
  bandSteering?: boolean;
}

/**
 * Configuração dinâmica de SSID usada pelo formulário do cpe-wifi-tab.
 */
export interface DynamicSsidConfig {
  index: string;
  name: string;
  password: string;
  securityMode: 'None' | 'WPA2' | 'WPA2-WPA3';
  enable: boolean;
  status: string;
  isLockedByHardware: boolean;
  atf: boolean;
  muMimo: boolean;
  ofdma: boolean;
  twt: boolean;
  bssColor: boolean;
  band: '2.4GHz' | '5GHz';
  isPrimary: boolean;
  guestId: number;
  uiVisible: boolean;
  isTR181: boolean;

  // Configurações avançadas do Access Point
  hidden: boolean;
  isolation: boolean;
  beamforming: boolean;
  wpsEnable: boolean;
  wmmEnable: boolean;
  lanAccess: boolean;
  usbAccess: boolean;
  tcEnable: boolean;
  tcMaxDown: number | null;
  tcMaxUp: number | null;
  tcMinDown: number | null;
  tcMinUp: number | null;

  namePath: string;
  passPath: string;
  securityModePath: string;
  enablePath: string;
  atfPath: string;
  muMimoPath: string;
  ofdmaPath: string;
  twtPath: string;
  bssColorPath: string;
  accessPointEnablePath?: string;

  // Paths avançados do Access Point
  hiddenPath: string;
  isolationPath: string;
  beamformingPath: string;
  wpsEnablePath: string;
  wmmEnablePath: string;
  lanAccessPath: string;
  usbAccessPath: string;
  tcEnablePath: string;
  tcMaxDownPath: string;
  tcMaxUpPath: string;
  tcMinDownPath: string;
  tcMinUpPath: string;
}

/**
 * Sub-objeto drift do novo schema MongoDB.
 */
export interface CpeDrift {
  active?: boolean;
  details?: string;
  detectedAt?: string;
}

/**
 * Documento completo de uma CPE, espelhando o schema MongoDB refatorado (EP 28).
 */
export interface CpeDevice {
  _id?: string; // MongoDB ObjectId
  serialNumber: string;
  oui: string;
  manufacturerCode?: string; // Legacy fallback
  manufacturer?: string; // Legacy fallback
  productClass?: string; // Legacy fallback

  // Campos de estado da CPE (raiz do schema backend)
  isOnline?: boolean; // Status de conexão atual
  lastInform?: string; // ISO 8601 — último Inform recebido

  // Sub-objetos aninhados (novo schema EP 28)
  deviceInfo?: CpeDeviceInfo;
  management?: CpeManagement;
  wan?: CpeWan;
  wifiConfig?: CpeWifiConfig;
  wifi2g?: CpeWifiBand;
  wifi5g?: CpeWifiBand;
  drift?: CpeDrift;
  lan?: CpeLan;
  nat?: CpeNat;
  rebootSchedule?: CpeRebootSchedule;
  ntp?: CpeNtp;

  // Legacy fields para backward compatibility
  softwareVersion?: string; // Legacy fallback
  hardwareVersion?: string;
  connectionRequestURL?: string; // Legacy fallback
  connectionRequestUsername?: string; // Legacy fallback
  connectionRequestPassword?: string; // Legacy fallback
  wanIp?: string; // Legacy fallback
  wanSubnetMask?: string;
  wanGateway?: string;
  wanDnsIsp?: string;
  wanMtu?: number;
  wanVlanId?: number;
  pppoeUsername?: string; // Legacy fallback
  wanConfigUpdatedAt?: string; // ISO 8601

  // Árvore de parâmetros TR-069 / TR-181
  parameters?: CpeParameter[];
  /**
   * Cache de parâmetros TR-069 retornado pelo backend (campo real do MongoDB).
   * Inclui metadados de timestamp. Substitui o acesso por `parameters` que não é
   * populado diretamente pelo endpoint getCpeDetails.
   */
  parametersCache?: CpeParameterCached[];

  // Métricas ópticas GPON/EPON (removidas do schema principal após EP 28)
  // opticalRx?: number; // dBm (ex: -23.5)
  // opticalTx?: number; // dBm (ex: 2.1)

  // Health Score calculado pelo backend a cada hora
  healthScore?: number; // 0-100
  healthScoreUpdatedAt?: string; // ISO 8601

  // Largura de banda Wi-Fi — mirrors de top-level para acesso direto sem navegar em wifi2g/wifi5g
  wifi2gBandwidth?: string; // Ex: "20" | "40" — OperatingChannelBandwidth 2.4GHz (legacy)
  wifi5gBandwidth?: string; // Ex: "20" | "40" | "80" | "160" — OperatingChannelBandwidth 5GHz (legacy)

  // Fila de comandos
  pendingTasks?: CpePendingTask[];

  // F10: Contagem de alertas ativos (preenchido pelo endpoint /api/cpe via aggregation)
  activeAlertsCount?: number;

  // Sistema de quarentena — espelha Cpe.js quarantine subdoc
  quarantine?: CpeQuarantine;

  // Timestamps do Mongoose
  createdAt?: string;
  updatedAt?: string;
}

/**
 * Espelha o subdocumento quarantine em src/models/Cpe.js — manter sincronizado.
 * CPE quarentenada tem todas as ações outbound suspensas (SPV, SPA, probes, scans,
 * diagnósticos, otimização). Inform ainda é processado (lastInform, isOnline, boot loop detection).
 */
export interface CpeQuarantine {
  active: boolean;
  reason: 'boot_loop' | 'manual' | null;
  since: string | null; // ISO 8601
  detectedBy: string | null; // 'system' | username
  details?: string | null; // explicação human-readable para o técnico
  bootLoopCount?: number; // snapshot do contador no momento da quarentena
}

export interface CpeLanDhcp {
  enable?: boolean | null;
  minAddress?: string | null;
  maxAddress?: string | null;
  leaseTime?: number | null;
  gateway?: string | null;
  dnsServers?: string | null;
  domain?: string | null;
  subnetMask?: string | null;
}

export interface CpeLan {
  ip?: string | null;
  subnetMask?: string | null;
  secondIpEnable?: boolean | null;
  igmpProxyEnable?: boolean | null;
  dnsType?: string | null;
  dnsServer1?: string | null;
  dnsServer2?: string | null;
  dhcp?: CpeLanDhcp;
}

export interface CpeNatInterfaceSetting {
  ifIndex?: string | null;
  fullConeEnable?: boolean | null;
}

export interface CpePortMapping {
  description?: string | null;
  externalPort?: number | null;
  internalClient?: string | null;
  internalPort?: number | null;
  protocol?: string | null;
  enable?: boolean | null;
}

export interface CpeNat {
  dmzEnable?: boolean | null;
  dmzIp?: string | null;
  upnpEnable?: boolean | null;
  interfaceSettings?: CpeNatInterfaceSetting[];
  portMappings?: CpePortMapping[];
}

export interface CpeRebootSchedule {
  enable?: boolean | null;
  mode?: string | null;
  day?: string | null;
  hours?: number | null;
  minutes?: number | null;
}

export interface CpeNtp {
  server1?: string | null;
  server2?: string | null;
  timezone?: string | null;
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
  neighboringWiFiResultCount?: number; // contagem de vizinhos do scan mais recente

  // Metadata do último scan de vizinhança (data/hora real da coleta + origem)
  // Diferente de timestamp (que é o momento da chamada do endpoint), lastScanInfo
  // reflete quando o scan foi efetivamente executado na CPE e se foi automático ou manual.
  lastScanInfo?: {
    timestamp: string; // ISO 8601 — data/hora da última coleta
    scanSource: 'scheduler' | 'on-demand' | null; // periódica (automática) ou manual (técnico)
    triggeredBy: string | null; // 'wifi-scan-scheduler' ou username do técnico
    neighborCount: number; // redes vizinhas detectadas
  } | null;

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
  pingAverageResponseTime?: number; // Tempo médio de ping (ms)
  pingSuccessCount?: number; // Pings com sucesso
  pingFailureCount?: number; // Pings com falha
  pingMinResponseTime?: number; // Tempo mínimo (ms)
  pingMaxResponseTime?: number; // Tempo máximo (ms)

  traceRouteResponseTime?: number; // Tempo total TraceRoute (ms)
  traceRouteHopCount?: number; // Número de hops

  downloadTestBytesReceived?: number; // Bytes recebidos no teste
  downloadTestTotalBytesReceived?: number; // Total acumulado

  uploadTestBytesSent?: number; // Bytes enviados no teste
  uploadTestTotalBytesSent?: number; // Total acumulado

  dnsLookupSuccessCount?: number; // Lookups DNS com sucesso
  dnsLookupResultCount?: number; // Resultados DNS retornados
  dnsDiagnosticsState?: string; // Estado do diagnóstico DNS

  // ── Estado dos diagnósticos (string retornada pela CPE) ──────────────────
  pingDiagnosticsState?: string; // None | Requested | Complete | Error_*
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
  demo?: boolean; // true quando são dados simulados (sem varredura real)
  totalNeighbors?: number; // soma total de vizinhos na banda
  channels: Record<number, ChannelEntry>;
  suggestion?: ChannelSuggestion; // sugestão de troca de canal com aplicação automática
  maxInterferenceScore?: number; // score máximo de interferência na banda
  bandwidthSuggestion?: string | null; // sugestão de largura de banda (backend)
  bandwidthSuggestionReason?: string | null; // razão da sugestão de largura
}

export interface ChannelEntry {
  channel: number;
  neighborCount: number;
  interferenceScore?: number; // score ponderado (RSSI + sobreposição + largura)
  avgRssi?: number | null; // RSSI médio dos vizinhos diretos (dBm)
  noiseLevel?: number; // dBm estimado
  congestionLevel?: 'Alto' | 'Médio' | 'Baixo' | string;
}

export interface ChannelSuggestion {
  bestChannel: number;
  currentChannel: number;
  currentScore: number;
  bestScore: number;
  improvement: number;
  shouldChange: boolean;
  reason: string;
  parameterPath?: string;
}

/**
 * Dados de qualidade de rádio estruturados para exibição no frontend.
 * Todos os campos são opcionais pois dependem das capacidades do firmware.
 */
export interface RadioQuality {
  bandwidth: string | null; // OperatingChannelBandwidth: ex. "20MHz", "80MHz", "Auto"
  snr: number | null; // SNR em dB (proprietary X_TP_SNR - TP-Link)
  noise: number | null; // Ruído de fundo em dBm
  utilization: number | null; // Utilização do canal em % (X_TP_Utilization - TP-Link)
  txPower: number | null; // Potência de transmissão em %
  channel: number | null; // Canal atual (0 = auto mode)
  autoChannelEnable: boolean | null; // true quando CPE gerencia canal (modo automático)
  rssi: number | null; // RSSI do rádio
  bandwidthSuggestion: string | null; // Sugestão de largura de banda baseada em dados reais
  bandwidthSuggestionReason: string | null; // Razão da sugestão
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
  ssid: string | null; // nome da rede Wi-Fi ao qual o host está conectado
  clientType: string | null; // X_TP_ClientType: 'Android', 'IP Camera', 'iPhone', etc.

  // Métricas DataElements X_TP_ (null quando firmware não expõe)
  qoe: number | null; // 0–100 (TP-Link X_TP_QoE)
  qoeLabel: 'Excelente' | 'Bom' | 'Regular' | 'Ruim' | 'N/A';
  downSpeedMbps: number | null; // X_TP_DownSpeed
  upSpeedMbps: number | null; // X_TP_UpSpeed
  operatingStandard: string | null; // ex: '802.11ax', '802.11ac', '802.11n'
  clientEfficiencyRate: number | null; // % X_TP_ClientEfficiencyRate
  noiseDbm: number | null; // X_TP_Noise
  signalStrengthDbm: number | null; // X_TP_SignalStrength (DataElements)
  snrDb: number | null; // X_TP_Snr
}

/** Ação corretiva proposta por um insight (quando actionable=true). */
export interface WifiInsightAction {
  type:
    | 'change_channel'
    | 'adjust_power'
    | 'set_bandwidth'
    | 'enable_beamforming'
    | 'info';
  band: '2.4GHz' | '5GHz';
  parameter: string; // caminho TR-181 para SetParameterValues
  value: string;
}

/** Insight determinístico gerado pelo wifiInsightsService. */
export interface WifiInsight {
  id: string;
  severity: 'info' | 'warning' | 'critical';
  category:
    | 'canal'
    | 'sinal'
    | 'qoe'
    | 'configuracao'
    | 'saturacao'
    | 'congestionamento';
  title: string;
  description: string;
  sourceParam: string; // parâmetro TR-181 que originou o insight
  actionable: boolean;
  action?: WifiInsightAction;
}

/** Resposta completa do endpoint GET /api/cpe/:serial/wifi-hosts. */
export interface WifiHostsData {
  serialNumber: string;
  manufacturer: string | null;
  timestamp: string;
  dataElementsAvailable: boolean; // false quando CPE não expõe X_TP_ DataElements
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
  portName: string | null; // X_TP_IfNameAlias: ex: 'LAN1', 'LAN2'
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
  /** Paginação aplicada apenas a wifiDevices — ethernetDevices sempre vem completo. */
  pagination: {
    page: number;
    limit: number;
    total: number;
    pages: number;
  };
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
  score: number | null; // 0-100 (pior = maior), null se indisponível
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
  uptime: number;
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
  wiredCount?: number;
  wirelessCount?: number;
  count2g?: number;
  count5g?: number;
  activeCount?: number;
}

/**
 * Alerta de telemetria — transição de estado de uma métrica vital (threshold).
 * Espelha o schema TelemetryAlert do backend.
 */
export interface TelemetryAlert {
  _id?: string;
  serialNumber: string;
  metric: string; // 'opticalRx' | 'cpuUsage' | 'wifi2gNoise' | 'wifi5gNoise'
  severity: 'warning' | 'critical';
  status: 'active' | 'resolved';
  value?: number;
  threshold?: number;
  triggeredAt: string; // ISO 8601
  resolvedAt?: string | null;
  message: string;
  acknowledgedBy?: string | null;
  acknowledgedAt?: string | null;
}

export interface TelemetryData {
  // NOTA ARQUITETURAL: dados chegam em formato FLAT via WebSocket e REST cache.
  // Métricas chegam como chaves diretas: cpuUsage, opticalRx, wanStatus, etc.
  // O indexer [metricKey: string]: any suporta o formato real de dados.
  [metricKey: string]: any; // Formato real: chaves diretas do backend (cpuUsage, opticalRx, etc.)
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
  memoryUsage?: number; // % calculado (legacy WebSocket cache)
  memoryFree?: number; // KB bruto (TelemetryVitals)
  memoryTotal?: number; // KB bruto
  uptime?: number; // segundos desde o boot (TelemetryVitals)
  opticalRx?: number;
  // opticalTx removido do schema TelemetryVitals — presente apenas em TelemetryRaw
  wanStatus?: string;
  gponStatus?: string;
  hostCount?: number;
  source?: string; // 'vitals' | 'hourly'
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
  rxTrend: {
    slopePerDay: number;
    r2: number;
    direction: 'degrading' | 'improving' | 'stable';
  };
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
  anomalies: {
    timestamp: Date;
    type: string;
    valueMbps: number;
    avgMbps: number;
  }[];
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
  peers: {
    serialNumber: string;
    wanIp: string;
    opticalRx: number | null;
    isOnline: boolean;
  }[];
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
  serialNumber: string;
  band: '2g' | '5g';
  sampleCount: number;
  snrAvg: number | null;
  snrMin: number | null;
  noiseFloor: number | null;
  clientCount: number | null;
  errorRateRx: number | null; // erros RX por minuto (normalizado pelo intervalo)
  errorRateTx: number | null; // erros TX por minuto (normalizado pelo intervalo)
  intervalMinutes: number | null; // intervalo entre as duas coletas usadas para erro rate
  thresholdWarn: number; // limite inferior do warning (erros/min)
  thresholdCritical: number; // limite do critical (erros/min)
  dataSource: 'snr' | 'fallback';
  confidence: 'high' | 'medium' | 'low';
  severity: 'ok' | 'warning' | 'critical';
  alert: boolean;
  message: string;
}

/** Análise de Margem Óptica GPON. */
export interface GponLinkBudgetAnalysis {
  serialNumber: string;
  rxPower: number;
  txPower: number | null;
  rxMargin: number;
  criticalThreshold: number;
  severity: 'ok' | 'warning' | 'critical';
  alert: boolean;
  message: string;
}

/** Análise de Envelhecimento do Transceiver (30 dias). */
export interface TransceiverAgingAnalysis {
  serialNumber: string;
  days: number;
  sampleCount: number;
  reliableModel: boolean;
  r2: number;
  biasSlopePerDay: number;
  currentBias: number;
  currentBiasMa: number;
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
  hops: { hopNumber: number; ipAddress: string; responseTime: number }[];
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
  results: {
    status: string;
    answerType: string;
    hostName: string;
    ipAddresses: string;
    dnsServerIp: string;
    responseTime: number;
  }[];
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

/** Saturação de canal calculada para uma banda (2.4GHz ou 5GHz). */
export interface WifiChannelSaturationBand {
  currentChannel: number | null;
  suggestedChannel: number | null;
  saturationScore: number | null;
}

/** Rede vizinha detectada dentro de uma execução de scan. */
export interface WifiNeighborNetwork {
  ssid: string;
  bssid: string;
  channel: number;
  band: string;
  rssi: number;
  security: string;
}

/**
 * Registro de UMA execução de WiFi Neighbor Scan, como persistido no model
 * WiFiNeighborHistory (backend) — formato usado por getWifiNeighborHistory().
 * Diferente de WifiNeighborResult (que representa uma rede vizinha individual
 * dentro do endpoint genérico de diagnósticos).
 */
export interface WifiNeighborScanEntry {
  serialNumber: string;
  diagnosticsState: string;
  results: {
    neighborCount: number;
    channelSaturation: {
      bands: {
        '2.4GHz'?: WifiChannelSaturationBand;
        '5GHz'?: WifiChannelSaturationBand;
      };
    } | null;
    neighbors: WifiNeighborNetwork[];
  };
  triggeredBy: string;
  timestamp: string;
}

/** Resposta do endpoint de histórico de WiFi Neighbor Scan (getWifiNeighborHistory). */
export interface WifiNeighborHistoryResponse {
  success: boolean;
  data: WifiNeighborScanEntry[];
  count: number;
}

/** Entrada genérica no histórico de diagnósticos. */
export type DiagnosticResult =
  | PingResult
  | TraceRouteResult
  | SpeedTestResult
  | DNSLookupResult
  | UDPEchoResult
  | WifiNeighborResult;

/** Resposta para endpoints de histórico de diagnósticos. */
export interface DiagnosticHistoryResponse<T extends DiagnosticResult> {
  success: boolean;
  data: T[];
  count: number;
}

// =============================================================================
// PROVIDER CONFIG (EP43)
// =============================================================================

export interface ProviderConfig {
  _id?: string;
  adminUserIndex: number;
  superAdminUserIndex: number;
  version: number;
  updatedBy: string;
  updatedAt?: string;
  createdAt?: string;
  hasAdminPassword: boolean;
  hasSuperAdminPassword: boolean;
  hasPppoePassword: boolean;
  isActive: boolean;
  autoWifiOptimizationEnabled: boolean;
  periodicDiagnosticsEnabled: boolean;
}

export interface ProviderConfigUpdate {
  adminUserIndex?: number;
  superAdminUserIndex?: number;
  adminPassword?: string | null;
  superAdminPassword?: string | null;
  pppoePassword?: string | null;
  autoWifiOptimizationEnabled?: boolean;
  periodicDiagnosticsEnabled?: boolean;
}

// =============================================================================
// DIAGNOSTIC TARGETS — Destinos de diagnóstico periódico (admin)
// =============================================================================

export type DiagnosticTargetType =
  | 'IPPing'
  | 'TraceRoute'
  | 'DNSLookup'
  | 'UDPEcho';
export type DiagnosticTargetScope = 'all' | 'selected';

// Ícones e labels centralizados em core/constants/diagnostic.constants.ts

export interface DiagnosticTarget {
  _id?: string;
  host: string;
  type: DiagnosticTargetType;
  label?: string;
  scopeType: DiagnosticTargetScope;
  serialNumbers?: string[];
  intervalHours: number;
  params?: Record<string, string | number | boolean>;
  enabled: boolean;
  createdBy: string;
  updatedBy: string;
  createdAt?: string;
  updatedAt?: string;
  /** Saúde das últimas 24h — populado por listDiagnosticTargets (aggregation). */
  health?: { totalExecutions24h: number; successRate24h: number } | null;
}

export interface DiagnosticTargetCreate {
  host: string;
  type: DiagnosticTargetType;
  label?: string;
  scopeType?: DiagnosticTargetScope;
  serialNumbers?: string[];
  intervalHours?: number;
  params?: Record<string, string | number | boolean>;
  enabled?: boolean;
}

export interface DiagnosticTargetUpdate {
  host?: string;
  label?: string;
  scopeType?: DiagnosticTargetScope;
  serialNumbers?: string[];
  intervalHours?: number;
  params?: Record<string, string | number | boolean>;
  enabled?: boolean;
}

/** Entrada do histórico de diagnósticos vinculada a um target. */
export interface DiagnosticTargetHistoryEntry {
  _id: string;
  serialNumber: string;
  diagnosticType: string;
  diagnosticsState: string;
  targetId: string;
  triggeredBy?: string;
  timestamp: string;
  results: Record<string, number | string | null>;
}

/** Análise agregada de um destino (endpoint /analysis). Contrato espelha
 * diagnosticTargetAnalysisService.js exatamente — conferir lá antes de alterar. */
export interface DiagnosticTargetAnalysis {
  targetId: string;
  diagType: string;
  days: number;
  totalExecutions: number;
  successCount: number;
  errorCount: number;
  pendingCount: number;
  successRate: number;
  latencyStats: {
    min: number;
    avg: number;
    max: number;
    std: number;
    p25: number | null;
    p50: number | null;
    p75: number | null;
    iqr: number | null;
    count: number;
  } | null;
  topFailingCpes: {
    serialNumber: string;
    failures: number;
    lastError: string | null;
    lastErrorAt: string | null;
  }[];
  dailySeries: { day: string; success: number; error: number; total: number }[];
}

/** Visão geral agregada de todos os destinos ativos — gráfico do dashboard. */
export interface DiagnosticOverview {
  days: number;
  totalExecutions: number;
  successRateGlobal: number;
  latencyAvgGlobal: number | null;
  affectedCpesCount: number;
  totalTargets: number;
  perTarget: {
    targetId: string;
    host: string;
    label: string | null;
    type: string;
    successRate: number;
    latencyAvg: number | null;
    totalExecutions: number;
    successCount: number;
    errorCount: number;
  }[];
  perTargetDailySeries: {
    targetId: string;
    host: string;
    label: string | null;
    dailySeries: {
      day: string;
      success: number;
      error: number;
      total: number;
    }[];
  }[];
  dailySeriesAggregated: {
    day: string;
    success: number;
    error: number;
    total: number;
  }[];
  topFailingCpes: {
    serialNumber: string;
    failures: number;
    lastError: string | null;
    lastErrorAt: string | null;
  }[];
  analysisText: string;
  generatedAt: string;
}

// ============================================================================
// DIAGNOSTIC ALERTS — Alertas de destino de diagnóstico degradado
// (GET /api/diagnostic-targets/alerts, POST /alerts/:id/acknowledge)
// ============================================================================

/**
 * Alerta de destino de diagnóstico degradado — disparado quando 3+ CPEs
 * distintas falham no mesmo destino na última hora. Espelha o schema
 * DiagnosticAlert do backend (src/models/DiagnosticAlert.js).
 *
 * Diferença de TelemetryAlert: este é por destino (targetId), não por CPE.
 */
export interface DiagnosticAlert {
  _id?: string;
  targetId: string;
  host: string;
  type: string;
  distinctFailingCpes: number;
  status: 'active' | 'resolved';
  triggeredAt: string; // ISO 8601
  resolvedAt: string | null;
  acknowledgedBy: string | null;
  acknowledgedAt: string | null;
}

// ============================================================================
// AUDIT LOGS — Trilha de auditoria (GET /api/audit-logs)
// ============================================================================

/** Entrada individual de log de auditoria (schema AuditLog do MongoDB). */
export interface AuditLog {
  _id: string;
  userId: string;
  username: string;
  role?: string;
  action: string;
  serialNumber: string;
  payload?: any;
  ip?: string;
  channel: 'rest' | 'socket' | 'cwmp' | 'scheduler' | 'auth';
  method?: string;
  route?: string;
  statusCode?: number;
  durationMs?: number;
  userAgent?: string;
  requestId?: string;
  result:
    | 'requested'
    | 'success'
    | 'error'
    | 'conflict'
    | 'confirmed'
    | 'inconclusive';
  errorMessage?: string;
  createdAt: string;
}

/** Filtros para consulta de audit logs (query params do GET /api/audit-logs). */
export interface AuditLogFilters {
  page?: number;
  limit?: number;
  serialNumber?: string;
  userId?: string;
  username?: string;
  action?: string;
  channel?: string;
  result?: string;
  dateFrom?: string;
  dateTo?: string;
}

/** Resposta paginada do GET /api/audit-logs. */
export interface AuditLogPaginatedResponse {
  data: AuditLog[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

/** Estatísticas agregadas do GET /api/audit-logs/stats. */
export interface AuditLogStats {
  total: number;
  byAction: { action: string; count: number }[];
  byChannel: { channel: string; count: number }[];
  byResult: { result: string; count: number }[];
}

// ============================================================================
// SERVER LOGS — Streaming de logs do servidor em tempo real (WebSocket)
// ============================================================================

/** Nível de log do servidor (Pino). */
export type ServerLogLevel = 'debug' | 'info' | 'warn' | 'error';

/** Entrada individual de log do servidor (via WebSocket evento 'server_log'). */
export interface ServerLogEntry {
  seq: number;
  level: ServerLogLevel;
  timestamp: string;
  data: any;
}

/** Batch inicial enviado ao subscrever (evento 'server_log_batch'). */
export interface ServerLogBatch {
  entries: ServerLogEntry[];
  count: number;
}
