// Caminho do arquivo: src/app/core/utils/bandwidth.ts

/**
 * NORMALIZAÇÃO DE LARGURA DE BANDA WI-FI — FONTE ÚNICA
 *
 * Elimina a duplicação de normalizeBandwidth entre:
 *   - cpe-wifi-analysis-tab.component.ts (formato canônico "20MHz")
 *   - radio-tr069-mapper.ts (formato numérico "20" para form de rádio)
 *
 * CPEs retornam formatos variados: "20 MHz", "VHT80", "HE80", "20/40MHz",
 * "80" (Intelbras X_ITBS_BandWidth), etc. Este módulo unifica o parsing.
 *
 * Regra de uso: nenhum componente deve redefinir esta lógica localmente.
 *   import { normalizeBandwidth, stripBandwidthUnit } from 'src/app/core/utils/bandwidth';
 */

/**
 * Normaliza o valor de largura de banda retornado pela CPE para formato canônico.
 * CPEs retornam formatos variados: "20 MHz", "VHT80", "HE80", "20/40MHz", "80" (Intelbras), etc.
 * Retorna null se o valor não puder ser normalizado para um formato reconhecido.
 *
 * @param raw Valor bruto da CPE
 * @returns Formato canônico ("20MHz", "40MHz", "80MHz", "160MHz", "20MHz/40MHz", "Auto") ou null
 */
export function normalizeBandwidth(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const s = raw.trim().toUpperCase().replace(/\s+/g, '');
  // Auto mode
  if (s === 'AUTO' || s === '0') return 'Auto';
  // Formatos numéricos com unidade: "20MHZ", "40MHZ", "80MHZ", "160MHZ"
  const mhzMatch = s.match(/^(\d+)MHZ$/);
  if (mhzMatch) return `${mhzMatch[1]}MHz`;
  // Formatos compostos: "20/40MHZ", "40/80MHZ", "20MHZ/40MHZ", "40MHZ/80MHZ"
  const compositeMatch = s.match(/^(\d+)(?:MHZ)?\/(\d+)MHZ$/);
  if (compositeMatch) return `${compositeMatch[1]}MHz/${compositeMatch[2]}MHz`;
  // Formatos 802.11 vendor: "VHT20", "VHT40", "VHT80", "VHT160", "HE20", "HE40", "HE80", "HE160"
  const vhtHeMatch = s.match(/^(?:VHT|HE|EHT)(\d+)$/);
  if (vhtHeMatch) return `${vhtHeMatch[1]}MHz`;
  // Intelbras X_ITBS_BandWidth: só o número sem unidade ("20", "40", "80", "160")
  const bareNum = s.match(/^(\d+)$/);
  if (bareNum && ['20', '40', '80', '160'].includes(bareNum[1])) return `${bareNum[1]}MHz`;
  return null;
}

/**
 * Remove o sufixo "MHz" do valor de bandwidth (para forms de rádio que usam número puro).
 * TR-098 armazena "40MHz", UI do form de rádio usa "40".
 *
 * @param raw Valor bruto (ex: "40MHz", "20MHz")
 * @returns Valor sem sufixo (ex: "40", "20") ou string vazia se input vazio
 */
export function stripBandwidthUnit(raw: string | undefined | null): string {
  if (!raw) return '';
  return raw.replace(/mhz/i, '').trim();
}
