/**
 * Construtor de paths TR-069 para configuração de Rádio Wi-Fi
 * Centraliza a lógica de path selection entre TR-181 (TP-Link) e TR-098 (Intelbras).
 *
 * TR-181 (TP-Link):  Device.WiFi.Radio.{i}.{field}
 *   Radio.1 = 2.4GHz · Radio.2 = 5GHz
 *   Fields: Enable, Channel, OperatingChannelBandwidth, TransmitPower, AutoChannelEnable
 *
 * TR-098 (Intelbras): InternetGatewayDevice.LANDevice.1.WLANConfiguration.{i}.{field}
 *   WLANConfiguration.1 = 2.4GHz · WLANConfiguration.5 = 5GHz (padrão mais comum)
 *   Fields: Enable, Channel, X_ITBS_BandWidth, TransmitPower, AutoChannelEnable
 *
 * Paths verificados em Parametros_Mapeados_TPLINK.json e Parametros_Mapeados_INTELBRAS.json.
 */
import { RADIO_CONSTANTS, WifiBand } from './radio-constants';

/**
 * Retorna o índice numérico do rádio para uma banda.
 * @param band '2.4GHz' | '5GHz'
 * @param isTR181 true para TP-Link (TR-181), false para Intelbras (TR-098)
 */
export function getRadioIndex(band: WifiBand, isTR181: boolean): number {
  return isTR181
    ? RADIO_CONSTANTS.TR181_RADIO_INDEX[band]
    : RADIO_CONSTANTS.TR098_WLAN_INDEX[band];
}

/**
 * Retorna o path base (prefixo) para o rádio de uma banda.
 * TR-181:  Device.WiFi.Radio.{i}
 * TR-098:  InternetGatewayDevice.LANDevice.1.WLANConfiguration.{i}
 */
export function getRadioBasePath(band: WifiBand, isTR181: boolean): string {
  const idx = getRadioIndex(band, isTR181);
  return isTR181
    ? `Device.WiFi.Radio.${idx}`
    : `InternetGatewayDevice.LANDevice.1.WLANConfiguration.${idx}`;
}

/**
 * Retorna o path de habilitação do rádio.
 * TR-181:  Device.WiFi.Radio.{i}.Enable
 * TR-098:  InternetGatewayDevice.LANDevice.1.WLANConfiguration.{i}.Enable
 */
export function getEnablePath(band: WifiBand, isTR181: boolean): string {
  return `${getRadioBasePath(band, isTR181)}.Enable`;
}

/**
 * Retorna o path do canal.
 * TR-181:  Device.WiFi.Radio.{i}.Channel
 * TR-098:  InternetGatewayDevice.LANDevice.1.WLANConfiguration.{i}.Channel
 */
export function getChannelPath(band: WifiBand, isTR181: boolean): string {
  return `${getRadioBasePath(band, isTR181)}.Channel`;
}

/**
 * Retorna o path da largura de banda.
 * TR-181:  Device.WiFi.Radio.{i}.OperatingChannelBandwidth
 * TR-098:  InternetGatewayDevice.LANDevice.1.WLANConfiguration.{i}.X_ITBS_BandWidth
 */
export function getBandwidthPath(band: WifiBand, isTR181: boolean): string {
  const base = getRadioBasePath(band, isTR181);
  return isTR181
    ? `${base}.OperatingChannelBandwidth`
    : `${base}.X_ITBS_BandWidth`;
}

/**
 * Retorna o path da potência de transmissão.
 * TR-181:  Device.WiFi.Radio.{i}.TransmitPower
 * TR-098:  InternetGatewayDevice.LANDevice.1.WLANConfiguration.{i}.TransmitPower
 */
export function getPowerPath(band: WifiBand, isTR181: boolean): string {
  return `${getRadioBasePath(band, isTR181)}.TransmitPower`;
}

/**
 * Retorna o path de canal automático (AutoChannelEnable).
 * TR-181:  Device.WiFi.Radio.{i}.AutoChannelEnable
 * TR-098:  InternetGatewayDevice.LANDevice.1.WLANConfiguration.{i}.AutoChannelEnable
 */
export function getAutoChannelPath(band: WifiBand, isTR181: boolean): string {
  return `${getRadioBasePath(band, isTR181)}.AutoChannelEnable`;
}

/**
 * Constrói todos os paths de uma banda em um único objeto.
 * Usado pelo mapper para popular o RadioBandConfig.
 */
export function buildAllPaths(band: WifiBand, isTR181: boolean) {
  return {
    enablePath: getEnablePath(band, isTR181),
    channelPath: getChannelPath(band, isTR181),
    bandwidthPath: getBandwidthPath(band, isTR181),
    powerPath: getPowerPath(band, isTR181),
    autoChannelPath: getAutoChannelPath(band, isTR181),
  };
}
