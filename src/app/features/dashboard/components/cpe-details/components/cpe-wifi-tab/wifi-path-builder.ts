/**
 * Construtor de paths TR-069 para configuração Wi-Fi
 * Centraliza a lógica de path selection entre TR-181 (TP-Link) e TR-098 (Intelbras)
 */

/**
 * Retorna o path de Band Steering (Smart Connect)
 * @param isTR181 true para TP-Link (TR-181), false para Intelbras (TR-098)
 */
export function getBandSteeringPath(isTR181: boolean): string {
  return isTR181
    ? 'Device.WiFi.X_TP_BandSteering.Enable'
    : 'InternetGatewayDevice.X_ITBS_WlanBandSteering';
}

/**
 * Retorna o path de habilitação de SSID
 * @param index Índice do SSID
 * @param isTR181 true para TP-Link (TR-181), false para Intelbras (TR-098)
 */
export function getSsidEnablePath(index: number, isTR181: boolean): string {
  return isTR181
    ? `Device.WiFi.SSID.${index}.Enable`
    : `InternetGatewayDevice.LANDevice.1.WLANConfiguration.${index}.Enable`;
}

/**
 * Retorna o path de nome do SSID
 * @param index Índice do SSID
 * @param isTR181 true para TP-Link (TR-181), false para Intelbras (TR-098)
 */
export function getSsidNamePath(index: number, isTR181: boolean): string {
  return isTR181
    ? `Device.WiFi.SSID.${index}.SSID`
    : `InternetGatewayDevice.LANDevice.1.WLANConfiguration.${index}.SSID`;
}

/**
 * Retorna o path de modo de segurança
 * @param index Índice do SSID
 * @param isTR181 true para TP-Link (TR-181), false para Intelbras (TR-098)
 */
export function getSecurityModePath(index: number, isTR181: boolean): string {
  return isTR181
    ? `Device.WiFi.AccessPoint.${index}.Security.ModeEnabled`
    : `InternetGatewayDevice.LANDevice.1.WLANConfiguration.${index}.BeaconType`;
}

/**
 * Retorna o path de senha (PreSharedKey/KeyPassphrase)
 * @param index Índice do SSID
 * @param isTR181 true para TP-Link (TR-181), false para Intelbras (TR-098)
 */
export function getPasswordPath(index: number, isTR181: boolean): string {
  return isTR181
    ? `Device.WiFi.AccessPoint.${index}.Security.KeyPassphrase`
    : `InternetGatewayDevice.LANDevice.1.WLANConfiguration.${index}.PreSharedKey.1.PreSharedKey`;
}

/**
 * Retorna o path de hidden SSID
 * @param index Índice do SSID
 * @param isTR181 true para TP-Link (TR-181), false para Intelbras (TR-098)
 */
export function getHiddenPath(index: number, isTR181: boolean): string {
  return isTR181
    ? `Device.WiFi.AccessPoint.${index}.SSIDAdvertisementEnabled`
    : `InternetGatewayDevice.LANDevice.1.WLANConfiguration.${index}.SSIDAdvertisementEnabled`;
}
