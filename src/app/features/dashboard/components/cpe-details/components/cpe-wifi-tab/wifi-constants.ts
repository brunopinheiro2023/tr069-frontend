/**
 * Constantes do módulo Wi-Fi
 * Centraliza valores mágicos e configurações para facilitar manutenção
 */

export const WIFI_CONSTANTS = {
  // Prefixos de nome de SSID
  GUEST_PREFIX: 'Visitante',
  GUEST_AUTO_RESET_PREFIX: 'Visitante_Auto_Reset',
  
  // Validações de senha
  PASSWORD: {
    MIN_LENGTH: 8,
    MAX_LENGTH: 63,
    REGEX: /^[\x20-\x7E]+$/
  } as const,

  // Controle de Tráfego
  TRAFFIC_CONTROL: {
    MAX_KBPS: 1_000_000  // 1 Gbps
  } as const,

  // Validações de SSID
  SSID_MAX_LENGTH: 32,
  SSID_MIN_LENGTH: 1,
  
  // Timeout de coleta
  COLLECT_TIMEOUT_MS: 90000,
  COLLECT_PROGRESS_INTERVAL_MS: 500,
  
  // Intervalo de polling
  POLL_INTERVAL_MS: 2000,
  
  // Estados de coleta
  COLLECT_STAGES: {
    INICIANDO: 'iniciando',
    CONTACTANDO: 'contactando',
    COLETANDO: 'coletando',
    FINALIZANDO: 'finalizando'
  } as const,
  
  // Modos de segurança
  SECURITY_MODES: {
    NONE: 'None',
    WPA2: 'WPA2',
    WPA2_WPA3: 'WPA2-WPA3'
  } as const,
  
  // Valores TR-181
  TR181_SECURITY_VALUES: {
    NONE: 'None',
    WPA2: 'WPA2-Personal',
    WPA2_WPA3: 'WPA2-WPA3-Personal'
  } as const,
  
  // Valores TR-098
  TR098_SECURITY_VALUES: {
    NONE: 'None',
    WPA2: '11i'
  } as const,
  
  // Tipos de AP ocultos
  HIDDEN_AP_TYPES: ['Backhaul', 'Public', 'IoTNetwork'] as const,
  
  // Guest ID
  UNKNOWN_GUEST_ID: 99,
  
  // Fallback de guestId por índice (dados legados)
  GUEST_ID_FALLBACK: {
    '2.4GHz': { 2: 1, 5: 2, 6: 3 },
    '5GHz': { 4: 1, 7: 2, 8: 3 }
  } as const
} as const;

export type CollectStage = typeof WIFI_CONSTANTS.COLLECT_STAGES[keyof typeof WIFI_CONSTANTS.COLLECT_STAGES];
export type SecurityMode = typeof WIFI_CONSTANTS.SECURITY_MODES[keyof typeof WIFI_CONSTANTS.SECURITY_MODES];
