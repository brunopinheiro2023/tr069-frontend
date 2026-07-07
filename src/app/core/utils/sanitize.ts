// Caminho do arquivo: src/app/core/utils/sanitize.ts

/**
 * FUNÇÕES DE SANITIZAÇÃO COMPARTILHADAS — FONTE ÚNICA
 *
 * Elimina a duplicação de sanitizeNumber/sanitizeString que existia em
 * neighbor-scan-card.component.ts e cpe-wifi-analysis-tab.component.ts.
 *
 * Regra de uso: nenhum componente deve redefinir estas funções localmente.
 *   import { sanitizeNumber, sanitizeString } from 'src/app/core/utils/sanitize';
 */

/**
 * Sanitiza um valor numérico proveniente da CPE.
 * Segurança: previne NaN, Infinity e valores fora de faixa.
 *
 * @param value Valor bruto (string, number, null, undefined)
 * @param min   Valor mínimo permitido (default 0)
 * @param max   Valor máximo permitido (default Number.MAX_SAFE_INTEGER)
 * @returns Número sanitizado dentro de [min, max]
 */
export function sanitizeNumber(
  value: unknown,
  min: number = 0,
  max: number = Number.MAX_SAFE_INTEGER,
): number {
  if (value === null || value === undefined) return min;
  const num = Number(value);
  if (isNaN(num) || !isFinite(num)) return min;
  return Math.max(min, Math.min(max, num));
}

/**
 * Sanitiza um valor string proveniente da CPE.
 * Segurança: remove caracteres perigosos, valida tipo e limita comprimento.
 *
 * @param value     Valor bruto (string, null, undefined)
 * @param maxLength Comprimento máximo (default 100)
 * @param fallback  Valor retornado quando input é inválido (default 'Desconhecido')
 * @returns String sanitizada
 */
export function sanitizeString(
  value: unknown,
  maxLength: number = 100,
  fallback: string = 'Desconhecido',
): string {
  if (value === null || value === undefined) return fallback;
  if (typeof value !== 'string') return fallback;
  const sanitized = value.trim().substring(0, maxLength);
  return sanitized || fallback;
}
