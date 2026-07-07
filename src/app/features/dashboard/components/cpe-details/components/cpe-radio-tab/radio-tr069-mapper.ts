/**
 * Mapper TR-069 → RadioBandConfig
 * Converte dados da CPE (band data do banco + parametersCache) em RadioBandConfig
 * para popular o formulário de rádio.
 *
 * Fonte primária: cpe.wifi2g / cpe.wifi5g (band data normalizada pelo backend)
 * Fonte secundária: cpe.parametersCache (paths TR-069 coletados via GPV)
 *
 * Detecção TR-181: prioriza parametersCache (paths Device.* = TR-181).
 * Fallback: manufacturerCode do deviceInfo (TPLINK = TR-181, INTELBRAS = TR-098).
 */
import { CpeDevice } from '../../../../../../core/models';
import { RADIO_CONSTANTS, RadioBandConfig, WifiBand } from './radio-constants';
import { buildAllPaths } from './radio-path-builder';
import { stripBandwidthUnit } from '@app/core/utils/bandwidth';

/** Extrai valor de um parâmetro do parametersCache por nome exato. */
function getParamValue(params: any[], paramName: string): string {
  if (!Array.isArray(params) || !paramName) return '';
  const param = params.find((p: any) => p && typeof p.name === 'string' && p.name === paramName);
  return param ? String(param.value ?? '') : '';
}

/** Converte valor bruto em boolean (aceita '1', 'true', 'enabled'). */
function parseBoolean(value: any): boolean {
  if (value === undefined || value === null || value === '') return false;
  const str = String(value).trim().toLowerCase();
  return str === '1' || str === 'true' || str === 'enabled';
}

/**
 * Detecta se a CPE usa TR-181 (TP-Link) ou TR-098 (Intelbras).
 * Prioriza parametersCache; fallback em deviceInfo.manufacturerCode.
 */
export function detectIsTR181(cpe: CpeDevice | null): boolean {
  const paramsArray = cpe?.parametersCache || [];
  if (Array.isArray(paramsArray) && paramsArray.length > 0) {
    return paramsArray.some((p: any) => p && typeof p.name === 'string' && p.name.startsWith('Device.'));
  }
  // Fallback: manufacturerCode — INTELBRAS = TR-098, qualquer outro = TR-181
  return cpe?.deviceInfo?.manufacturerCode !== 'INTELBRAS';
}

/**
 * Normaliza o valor de bandwidth vindo do banco/parametersCache.
 * Remove sufixo "MHz" se presente (TR-098 armazena "40MHz", UI usa "40").
 * Delegado para stripBandwidthUnit em @app/core/utils/bandwidth (fonte única).
 */
function normalizeBandwidth(raw: string): string {
  return stripBandwidthUnit(raw);
}

/**
 * Normaliza o valor de canal.
 * Se AutoChannelEnable=true ou canal=0 ou canal vazio → 'Auto'.
 * Caso contrário, retorna o número como string.
 */
function normalizeChannel(rawChannel: string, autoChannelEnabled: boolean): string {
  if (autoChannelEnabled) return RADIO_CONSTANTS.AUTO_CHANNEL;
  if (!rawChannel || rawChannel === '0') return '';
  return rawChannel;
}

/**
 * Constrói o RadioBandConfig para uma banda a partir dos dados da CPE.
 *
 * Estratégia de leitura:
 * 1. Band data do banco (cpe.wifi2g/wifi5g) — fonte primária de valores
 * 2. parametersCache — fallback para campos ausentes no band data
 * 3. Paths TR-069 construídos via buildAllPaths (fonte única de verdade)
 */
function buildBandConfig(
  cpe: CpeDevice | null,
  band: WifiBand,
  isTR181: boolean,
): RadioBandConfig | null {
  if (!cpe) return null;

  // Band data do banco (fonte primária)
  const bandData = band === '2.4GHz' ? cpe.wifi2g : cpe.wifi5g;
  const paramsArray = cpe.parametersCache || [];

  // Paths TR-069 (construídos via path-builder)
  const paths = buildAllPaths(band, isTR181);

  // Verifica se há ALGUMA fonte de dados para esta banda:
  // - band data do banco (wifi2g/wifi5g) com pelo menos um campo útil
  // - OU parametersCache com o path de Enable desta banda
  // `!= null` pega ambos undefined e null (MongoDB pode retornar null)
  const hasBandData = bandData && (bandData.enable != null || bandData.channel != null || bandData.bandwidth || bandData.status);
  const hasCachedPath = getParamValue(paramsArray, paths.enablePath) !== '';

  if (!hasBandData && !hasCachedPath) return null;

  // AutoChannelEnable — lê do parametersCache (band data não tem este campo)
  const autoChannelRaw = getParamValue(paramsArray, paths.autoChannelPath);
  const autoChannel = parseBoolean(autoChannelRaw);

  // Enable — prioriza band data, fallback parametersCache
  // `== null` pega ambos undefined e null (MongoDB pode retornar null em booleanos)
  let enable = bandData?.enable ?? false;
  if (bandData?.enable == null) {
    enable = parseBoolean(getParamValue(paramsArray, paths.enablePath));
  }

  // Channel — prioriza band data, fallback parametersCache
  // channel é String no schema Mongoose (consistente com handleInform)
  let channelRaw = bandData?.channel ?? '';
  if (!channelRaw) {
    channelRaw = getParamValue(paramsArray, paths.channelPath);
  }
  const channel = normalizeChannel(channelRaw, autoChannel);

  // Bandwidth — prioriza band data, fallback parametersCache
  let bandwidthRaw = bandData?.bandwidth ?? '';
  if (!bandwidthRaw) {
    bandwidthRaw = getParamValue(paramsArray, paths.bandwidthPath);
  }
  const bandwidth = normalizeBandwidth(bandwidthRaw);

  // Power — prioriza band data, fallback parametersCache
  let powerRaw = bandData?.txPower != null ? String(bandData.txPower) : '';
  if (!powerRaw) {
    powerRaw = getParamValue(paramsArray, paths.powerPath);
  }

  // Status — do band data
  const status = bandData?.status ?? 'Unknown';

  // txPowerSupported — CSV com valores aceitos pela CPE (ex: "25,50,100")
  // Null se TransmitPowerSupported ainda não foi coletado via GPN
  const txPowerSupported = bandData?.txPowerSupported ?? undefined;

  return {
    band,
    enable,
    channel,
    bandwidth,
    power: powerRaw,
    txPowerSupported,
    isTR181,
    status,
    enablePath: paths.enablePath,
    channelPath: paths.channelPath,
    bandwidthPath: paths.bandwidthPath,
    powerPath: paths.powerPath,
    autoChannelPath: paths.autoChannelPath,
  };
}

/**
 * Mapeia a CPE completa para configurações de rádio de ambas as bandas.
 * Retorna null para bandas sem dados (CPE não suporta 5GHz, por exemplo).
 */
export function mapCpeToRadioConfigs(
  cpe: CpeDevice | null,
): { configs: (RadioBandConfig | null)[]; isTR181: boolean } {
  const isTR181 = detectIsTR181(cpe);
  const configs: (RadioBandConfig | null)[] = [
    buildBandConfig(cpe, '2.4GHz', isTR181),
    buildBandConfig(cpe, '5GHz', isTR181),
  ];
  return { configs, isTR181 };
}
