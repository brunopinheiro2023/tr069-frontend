// Caminho do arquivo: src/app/core/constants/wifi.constants.ts
//
// CONSTANTES TÉCNICAS WI-FI — ESPELHO DO BACKEND (src/utils/wifiConstants.js)
//
// O frontend não pode importar diretamente do backend Node.js, então este arquivo
// mantém os mesmos valores. Sempre que o backend mudar wifiConstants.js, este arquivo
// deve ser atualizado para manter consistência.
//
// Referências:
//   - IEEE 802.11-2020 (canais não sobrepostos 2.4GHz)
//   - FCC 47 CFR Part 15 (subbandas UNII-1/2/3 em 5GHz)
//   - BBF TR-181 Device:2 (OperatingChannelBandwidth)

/** Canais 2.4GHz não sobrepostos (IEEE 802.11-2020, espaçamento 25 MHz). */
export const NON_OVERLAPPING_2G: number[] = [1, 6, 11];

/** Canais 5GHz preferenciais SEM DFS (UNII-1: 36-48 e UNII-3: 149-165). */
export const PREFERRED_5G_NO_DFS: number[] = [36, 40, 44, 48, 149, 153, 157, 161, 165];

/** Range numérico de canais 2.4GHz (para validação rápida de bounds). */
export const CHANNEL_RANGE_2G = { min: 1, max: 13 };

/** Range numérico de canais 5GHz (para validação rápida de bounds). */
export const CHANNEL_RANGE_5G = { min: 36, max: 165 };

/** Mapa banda → range { min, max } para validação rápida de bounds. */
export const CHANNEL_RANGE: Record<string, { min: number; max: number }> = {
  '2.4GHz': CHANNEL_RANGE_2G,
  '5GHz': CHANNEL_RANGE_5G,
};
