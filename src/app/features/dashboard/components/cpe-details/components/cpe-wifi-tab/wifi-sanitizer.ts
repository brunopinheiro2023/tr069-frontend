/**
 * Util pura de sanitização de SSID e senha Wi-Fi.
 * Funções reutilizáveis em qualquer contexto (componentes, services, validators).
 * Sem side effects, sem I/O — testável isoladamente.
 *
 * Defesa em profundidade: remove caracteres que podem causar problemas em
 * logs, apps móveis, outras interfaces que exibem o SSID, ou em payloads
 * SPV enviados à CPE via TR-069.
 */
import { WIFI_CONSTANTS } from './wifi-constants';

/**
 * Caracteres de controle ASCII (0-31 exceto tab/newline/CR) + DEL (127).
 * Removidos de SSID e senha para evitar corrupção em protocolos TR-069.
 */
const CONTROL_CHARS_REGEX = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;

/**
 * Caracteres perigosos em contextos HTML/XML.
 * Removidos de SSID para prevenir XSS em interfaces que não escapam corretamente.
 */
const HTML_DANGEROUS_CHARS_REGEX = /[<>"'&]/g;

/**
 * Sanitiza nome de SSID antes de enviar à CPE ou exibir em formulário.
 * Remove caracteres de controle, tags HTML/XML, espaços em excesso.
 * Trunca ao tamanho máximo do protocolo TR-069 (32 caracteres).
 *
 * @param name Nome bruto do SSID (string, null ou undefined)
 * @returns Nome sanitizado (string vazia se input inválido)
 */
export function sanitizeSsidName(name: string | null | undefined): string {
  if (!name || typeof name !== 'string') return '';
  let s = name.replace(CONTROL_CHARS_REGEX, '');
  s = s.replace(HTML_DANGEROUS_CHARS_REGEX, '');
  return s.trim().slice(0, WIFI_CONSTANTS.SSID_MAX_LENGTH);
}

/**
 * Sanitiza input de SSID vindo do banco/WS antes de popular o formulário.
 * Igual a sanitizeSsidName — mantido como alias semântico para clareza
 * no ponto de chamada (populateWifiForm vs buildAllParams).
 *
 * @param value Valor bruto do SSID
 * @returns Valor sanitizado
 */
export function sanitizeSsidInput(value: string | null | undefined): string {
  return sanitizeSsidName(value);
}

/**
 * Sanitiza senha Wi-Fi antes de enviar à CPE.
 * Remove apenas caracteres de controle (senha pode ter qualquer ASCII imprimível).
 * NÃO remove caracteres HTML — senhas podem conter <, >, &, " legitimamente.
 *
 * @param password Senha bruta
 * @returns Senha sanitizada (string vazia se input inválido)
 */
export function sanitizeWifiPassword(password: string | null | undefined): string {
  if (!password || typeof password !== 'string') return '';
  return password.replace(CONTROL_CHARS_REGEX, '').trim();
}
