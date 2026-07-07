import { NON_OVERLAPPING_2G, PREFERRED_5G_NO_DFS, CHANNEL_RANGE_2G, CHANNEL_RANGE_5G } from '@app/core/constants/wifi.constants';

/**
 * Constantes do módulo Rádio Wi-Fi
 * Centraliza valores mágicos, opções de UI e índices TR-069 para facilitar manutenção.
 *
 * Paths TR-069 verificados em:
 *   - Parametros_Mapeados_TPLINK.json    (TR-181 — Device.WiFi.Radio.{i})
 *   - Parametros_Mapeados_INTELBRAS.json (TR-098 — InternetGatewayDevice.LANDevice.1.WLANConfiguration.{i})
 *
 * Listas de canais importadas de @app/core/constants/wifi.constants (espelho do backend).
 */
export const RADIO_CONSTANTS = {
  /** Índices do objeto Radio por banda (TR-181 — TP-Link) */
  TR181_RADIO_INDEX: {
    '2.4GHz': 1,
    '5GHz': 2,
  } as const,

  /** Índices do WLANConfiguration por banda (TR-098 — Intelbras) */
  TR098_WLAN_INDEX: {
    '2.4GHz': 1,
    '5GHz': 5,
  } as const,

  /** Canais 2.4GHz (1-13 — gerado a partir do range válido, sem DFS) */
  CHANNELS_2G: Array.from({ length: CHANNEL_RANGE_2G.max - CHANNEL_RANGE_2G.min + 1 },
    (_, i) => CHANNEL_RANGE_2G.min + i) as readonly number[],

  /** Canais 5GHz preferenciais sem DFS (UNII-1 + UNII-3) — fonte: wifi.constants.ts */
  CHANNELS_5G: PREFERRED_5G_NO_DFS as readonly number[],

  /** Canais não sobrepostos 2.4GHz (para destaque na UI) */
  NON_OVERLAPPING_2G: NON_OVERLAPPING_2G as readonly number[],

  /** Valor de canal automático (AutoChannelEnable = true) */
  AUTO_CHANNEL: 'Auto' as const,

  /** Larguras de banda suportadas (valor UI — conversão TR-098 no parameter-builder) */
  BANDWIDTH_2G: ['20', '40'] as const,
  BANDWIDTH_5G: ['20', '40', '80', '160'] as const,

  /** Potência TR-181 (TP-Link) — fallback percentual quando TransmitPowerSupported não foi coletado */
  POWER_TR181: ['25', '50', '100'] as const,

  /** Potência TR-098 (Intelbras) — percentual discreto (15-100) */
  POWER_TR098: ['15', '35', '50', '70', '100'] as const,

  /** Sufixo de bandwidth (TR-181 e TR-098 usam "20MHz" — valor normalizado sem sufixo no DB) */
  TR098_BANDWIDTH_SUFFIX: 'MHz' as const,

  /** Rótulos de banda para exibição na UI */
  BAND_LABELS: {
    '2.4GHz': '2.4 GHz',
    '5GHz': '5 GHz',
  } as const,

  /** Ícones Material Symbols por banda */
  BAND_ICONS: {
    '2.4GHz': 'wifi',
    '5GHz': 'wifi_tethering',
  } as const,
} as const;

/** Tipo auxiliar para banda Wi-Fi */
export type WifiBand = '2.4GHz' | '5GHz';

/** Tipo auxiliar para configuração de rádio de uma banda */
export interface RadioBandConfig {
  band: WifiBand;
  enable: boolean;
  channel: string;          // 'Auto' | número como string
  bandwidth: string;        // '20' | '40' | '80' | '160'
  power: string;            // percentual (0-100) em ambos os protocolos
  txPowerSupported?: string; // CSV ex: "25,50,100" — null se TransmitPowerSupported não coletado
  isTR181: boolean;
  status: string;
  /** Path TR-069 de cada campo (preenchido pelo mapper) */
  enablePath: string;
  channelPath: string;
  bandwidthPath: string;
  powerPath: string;
  autoChannelPath: string;
}

/**
 * Tipo auxiliar para os valores do FormGroup de rádio.
 * Difere de RadioBandConfig por não incluir `band` (que não está no form,
 * apenas no RadioBandConfig usado pelo mapper).
 */
export type RadioFormValues = Omit<RadioBandConfig, 'band'>;
