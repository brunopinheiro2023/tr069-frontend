import { AbstractControl, ValidationErrors, ValidatorFn, FormArray, FormGroup } from '@angular/forms';
import { WIFI_CONSTANTS } from './wifi-constants';
import { resolveGuestId, areCorrelatedAps, PairableAp } from './wifi-ap-pairing';

/**
 * Validator para nome de SSID
 * - Obrigatório
 * - Mínimo 1 caractere
 * - Máximo 32 caracteres
 * - Sem espaços no início/fim
 */
export const ssidValidator: ValidatorFn = (control: AbstractControl): ValidationErrors | null => {
  const value = control.value;
  
  if (!value || value.trim() === '') {
    return { required: true };
  }
  
  if (value.trim().length < WIFI_CONSTANTS.SSID_MIN_LENGTH) {
    return { minlength: { requiredLength: WIFI_CONSTANTS.SSID_MIN_LENGTH, actualLength: value.trim().length } };
  }
  
  if (value.trim().length > WIFI_CONSTANTS.SSID_MAX_LENGTH) {
    return { maxlength: { requiredLength: WIFI_CONSTANTS.SSID_MAX_LENGTH, actualLength: value.trim().length } };
  }
  
  return null;
};

/**
 * Validator para senha Wi-Fi
 * - Obrigatório apenas se securityMode não for 'None'
 * - Mínimo 8 caracteres
 * - Máximo 63 caracteres
 * - Sem espaços
 */
export const passwordValidator: ValidatorFn = (control: AbstractControl): ValidationErrors | null => {
  const value = control.value;
  
  // Se vazio, é válido (validação condicional será feita no grupo)
  if (!value) {
    return null;
  }
  
  if (value.length < WIFI_CONSTANTS.PASSWORD.MIN_LENGTH) {
    return { minlength: { requiredLength: WIFI_CONSTANTS.PASSWORD.MIN_LENGTH, actualLength: value.length } };
  }
  
  if (value.length > WIFI_CONSTANTS.PASSWORD.MAX_LENGTH) {
    return { maxlength: { requiredLength: WIFI_CONSTANTS.PASSWORD.MAX_LENGTH, actualLength: value.length } };
  }
  
  if (/\s/.test(value)) {
    return { whitespace: true };
  }
  
  return null;
};

/**
 * Validator de grupo para garantir que senha seja fornecida quando segurança não é 'None'
 */
export const securityWithPasswordValidator: ValidatorFn = (group: AbstractControl): ValidationErrors | null => {
  const securityMode = group.get('securityMode')?.value;
  const password = group.get('password')?.value;
  const enable = group.get('enable')?.value;
  
  // Se SSID desabilitado, não validar senha
  if (!enable) {
    return null;
  }
  
  // Se segurança não é 'None', senha é obrigatória
  if (securityMode && securityMode !== 'None' && (!password || password.trim() === '')) {
    return { passwordRequired: true };
  }
  
  return null;
};

/**
 * Gera senha aleatória segura compatível com TR-069 KeyPassphrase.
 * Remove caracteres ambíguos (I/l/1/O/0) para melhor UX de leitura.
 * Usa crypto.getRandomValues (API nativa do browser) — sem dependência externa.
 * Faz clamp do comprimento para respeitar limites do protocolo (8–63 caracteres).
 */
export function generateSecurePassword(length = 12): string {
  const safeLength = Math.min(
    Math.max(length, WIFI_CONSTANTS.PASSWORD.MIN_LENGTH),
    WIFI_CONSTANTS.PASSWORD.MAX_LENGTH
  );
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789@#!';
  const array = new Uint32Array(safeLength);
  crypto.getRandomValues(array);
  return Array.from(array, n => chars[n % chars.length]).join('');
}

/**
 * Gera nome único para SSID guest sem colidir com nomes existentes.
 * Aplica sanitização básica (trim, max length) antes de retornar.
 */
export function generateUniqueGuestName(
  existingNames: string[],
  baseName = WIFI_CONSTANTS.GUEST_PREFIX
): string {
  const taken = new Set(existingNames.map(n => n?.trim().toLowerCase()));
  let candidate: string = baseName;
  let suffix = 2;
  while (taken.has(candidate.toLowerCase())) {
    candidate = `${baseName} ${suffix++}`;
  }
  // Aplica sanitização: remove espaços extras, trunca em 32
  return candidate.trim().slice(0, WIFI_CONSTANTS.SSID_MAX_LENGTH);
}

/**
 * Validator para campos de controle de tráfego (tcMaxDown, tcMaxUp, tcMinDown, tcMinUp).
 * - Deve ser número não-negativo
 * - Máximo: 1.000.000 kbps (1 Gbps) — limite físico razoável
 */
export const trafficControlValueValidator: ValidatorFn = (control: AbstractControl): ValidationErrors | null => {
  const value = control.value;
  if (value === null || value === undefined || value === '') return null;
  const num = Number(value);
  if (isNaN(num) || num < 0) return { invalidTraffic: { reason: 'Deve ser número não-negativo.' } };
  if (num > WIFI_CONSTANTS.TRAFFIC_CONTROL.MAX_KBPS) {
    return { invalidTraffic: { reason: `Máximo: ${WIFI_CONSTANTS.TRAFFIC_CONTROL.MAX_KBPS.toLocaleString()} kbps (1 Gbps).` } };
  }
  return null;
};

/**
 * Validator de FormArray: garante que nenhum nome de SSID se repita de forma indevida.
 *
 * Regra: APs 2.4GHz e 5GHz correlacionados (mesmo guestId resolvido) podem ter o mesmo nome.
 * Isso vale para Primary (guestId=0) e Guests (guestId=1,2,3...), com ou sem Smart Connect.
 * APs não correlacionados (guestIds resolvidos diferentes) NÃO podem ter o mesmo nome.
 *
 * Usa resolveGuestId + areCorrelatedAps (wifi-ap-pairing.ts) para resolver guestId=99
 * via GUEST_ID_FALLBACK e validar o pareamento corretamente.
 *
 * Ignora APs com uiVisible=false ou enable=false (não afetam a rede visível).
 */
export const uniqueSsidNamesValidator: ValidatorFn = (control: AbstractControl): ValidationErrors | null => {
  const formArray = control as FormArray;

  const visible = (formArray.controls as FormGroup[])
    .map(c => c.getRawValue())
    .filter(v => v.uiVisible && v.enable && typeof v.name === 'string' && v.name.trim() !== '');

  // Agrupa por nome normalizado (case-insensitive, sem espaços extras)
  const byName = new Map<string, typeof visible>();
  for (const ap of visible) {
    const key = ap.name.trim().toLowerCase();
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key)!.push(ap);
  }

  const duplicates: string[] = [];
  for (const [, aps] of byName) {
    if (aps.length === 1) continue;

    // Caso permitido: exatamente 2 APs correlacionados (2.4GHz ↔ 5GHz, mesmo guestId resolvido).
    // areCorrelatedAps usa resolveGuestId internamente, resolvendo guestId=99 via GUEST_ID_FALLBACK.
    // Isso permite que Primary 2.4GHz/5GHz tenham o mesmo nome (guestId=0),
    // e que cada Guest 2.4GHz/5GHz tenham o mesmo nome (guestId=1,2,3...),
    // mesmo quando o apType não é reconhecido (guestId=99 → fallback por índice).
    if (aps.length === 2) {
      const [a, b] = aps;
      if (areCorrelatedAps(a as PairableAp, b as PairableAp)) continue;
    }

    // Qualquer outra duplicação é indevida
    duplicates.push(aps[0].name.trim());
  }

  return duplicates.length > 0
    ? { duplicateSsidNames: { names: duplicates } }
    : null;
};
