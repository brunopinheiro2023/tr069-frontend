/**
 * Util pura de pareamento de Access Points Wi-Fi correlacionados.
 * Funções reutilizáveis para encontrar e operar sobre pares 2.4GHz ↔ 5GHz
 * que compartilham o mesmo guestId (rede lógica).
 *
 * Regra de pareamento:
 *   - Mesmo guestId + banda oposta (2.4GHz ↔ 5GHz) = APs correlacionados
 *   - guestId 99 (desconhecido): fallback por índice
 *
 * Sem side effects, sem I/O — testável isoladamente.
 */
import { WIFI_CONSTANTS } from './wifi-constants';

/**
 * Interface mínima que um AP precisa implementar para usar as funções de pareamento.
 * Qualquer objeto com esses campos pode ser pareado (FormGroup.getRawValue(),
 * DynamicSsidConfig, objeto plano de teste, etc).
 */
export interface PairableAp {
  index: string;
  band: '2.4GHz' | '5GHz';
  guestId: number;
}

/**
 * Resolve o guestId real de um AP, usando GUEST_ID_FALLBACK quando guestId=99.
 * Índices 2.4GHz e 5GHz são diferentes (ex: 2.4GHz=5, 5GHz=4), mas o
 * GUEST_ID_FALLBACK mapeia ambos para o mesmo guestId lógico (ex: 2).
 *
 * @param ap AP com index, band, guestId
 * @returns guestId real (0=Primary, 1-3=Guest, 99=Desconhecido sem fallback)
 */
export function resolveGuestId(ap: PairableAp): number {
  if (ap.guestId !== WIFI_CONSTANTS.UNKNOWN_GUEST_ID) {
    return ap.guestId;
  }
  // Fallback: mapeia índice+banda para guestId usando a tabela estática
  const band = ap.band as '2.4GHz' | '5GHz';
  const fallbackMap = WIFI_CONSTANTS.GUEST_ID_FALLBACK[band] as Record<number, number>;
  const numIdx = parseInt(ap.index, 10);
  if (isNaN(numIdx)) return WIFI_CONSTANTS.UNKNOWN_GUEST_ID;
  return fallbackMap[numIdx] ?? WIFI_CONSTANTS.UNKNOWN_GUEST_ID;
}

/**
 * Encontra o AP correlacionado (banda oposta, mesmo guestId) em uma lista de APs.
 *
 * Algoritmo de pareamento:
 *   1. Se ambos têm guestId conhecido (≠99): pareia por guestId
 *   2. Se um ou ambos têm guestId=99: resolve guestId via GUEST_ID_FALLBACK
 *      (mapeia índice+banda → guestId lógico) e compara
 *   3. Se o fallback não resolve (índice fora da tabela): sem pareamento
 *
 * @param source AP de origem (qualquer objeto com index, band, guestId)
 * @param aps Lista de APs candidatos
 * @returns AP correlacionado ou undefined se não encontrado
 */
export function findCorrelatedAp<T extends PairableAp>(
  source: T,
  aps: T[]
): T | undefined {
  const sourceGuestId = resolveGuestId(source);
  if (sourceGuestId === WIFI_CONSTANTS.UNKNOWN_GUEST_ID) return undefined;

  return aps.find(ap => {
    if (ap.band === source.band) return false;          // banda oposta
    if (ap.index === source.index) return false;        // não é o mesmo AP
    const apGuestId = resolveGuestId(ap);
    if (apGuestId === WIFI_CONSTANTS.UNKNOWN_GUEST_ID) return false;
    return apGuestId === sourceGuestId;
  });
}

/**
 * Verifica se dois APs são correlacionados (par 2.4GHz ↔ 5GHz válido).
 * Usa resolveGuestId para resolver guestId=99 via GUEST_ID_FALLBACK.
 *
 * @param a Primeiro AP
 * @param b Segundo AP
 * @returns true se formam um par válido (mesmo guestId resolvido, bandas opostas)
 */
export function areCorrelatedAps(a: PairableAp, b: PairableAp): boolean {
  if (a.band === b.band) return false;
  if (a.index === b.index) return false;
  const aGuestId = resolveGuestId(a);
  const bGuestId = resolveGuestId(b);
  if (aGuestId === WIFI_CONSTANTS.UNKNOWN_GUEST_ID) return false;
  if (bGuestId === WIFI_CONSTANTS.UNKNOWN_GUEST_ID) return false;
  return aGuestId === bGuestId;
}

/**
 * Agrupa APs por guestId, retornando pares correlacionados (2.4GHz + 5GHz).
 * APs sem par ficam no array de órfãos.
 *
 * @param aps Lista de APs
 * @returns Objeto com pairs (arrays de 2 APs) e orphans (APs sem par)
 */
export function groupCorrelatedAps<T extends PairableAp>(
  aps: T[]
): { pairs: [T, T][]; orphans: T[] } {
  const pairs: [T, T][] = [];
  const orphans: T[] = [];
  const consumed = new Set<string>(); // index dos APs já pareados

  for (const ap of aps) {
    if (consumed.has(ap.index)) continue;
    const peer = findCorrelatedAp(ap, aps);
    if (peer && !consumed.has(peer.index)) {
      pairs.push([ap, peer]);
      consumed.add(ap.index);
      consumed.add(peer.index);
    } else {
      orphans.push(ap);
      consumed.add(ap.index);
    }
  }

  return { pairs, orphans };
}

/**
 * Ordena APs por guestId e banda (2.4GHz antes de 5GHz dentro de cada grupo).
 * guestId 99 (desconhecido) vai para o final.
 *
 * @param aps Lista de APs
 * @returns Nova lista ordenada (não muta a original)
 */
export function sortApsByGuestAndBand<T extends PairableAp>(aps: T[]): T[] {
  return [...aps].sort((a, b) => {
    const ga = a.guestId === WIFI_CONSTANTS.UNKNOWN_GUEST_ID ? 999 : a.guestId;
    const gb = b.guestId === WIFI_CONSTANTS.UNKNOWN_GUEST_ID ? 999 : b.guestId;
    if (ga !== gb) return ga - gb;
    return a.band === '2.4GHz' ? -1 : 1;
  });
}
