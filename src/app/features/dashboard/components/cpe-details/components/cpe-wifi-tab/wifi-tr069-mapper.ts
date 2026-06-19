export interface DynamicSsidConfig {
  index: string;
  name: string;
  password: string;
  securityMode: 'None' | 'WPA2' | 'WPA2-WPA3';
  enable: boolean;
  status: string;
  isLockedByHardware: boolean;
  atf: boolean;
  muMimo: boolean;
  ofdma: boolean;
  band: '2.4GHz' | '5GHz';
  isPrimary: boolean;
  guestId: number;
  uiVisible: boolean;
  isTR181: boolean;

  namePath: string;
  passPath: string;
  securityModePath: string;
  enablePath: string;
  atfPath: string;
  muMimoPath: string;
  ofdmaPath: string;
  accessPointEnablePath?: string;
}

function getParamValue(params: any[], paramName: string): string {
  if (!Array.isArray(params)) return '';
  const param = params.find((p: any) => p.name === paramName || p.name.endsWith(paramName));
  return param ? String(param.value) : '';
}

function parseBoolean(value: any): boolean {
  if (value === undefined || value === null || value === '') return false;
  const strVal = String(value).trim().toLowerCase();
  return strVal === '1' || strVal === 'true';
}

function classifySsidByHardware(idx: string, alias: string, apType: string, isTR181: boolean): { band: '2.4GHz' | '5GHz', isPrimary: boolean, guestId: number, isHidden: boolean } {
  const numIdx = parseInt(idx, 10);
  if (apType) {
    const isHidden = ['Backhaul', 'Public', 'IoTNetwork'].includes(apType);
    const isPrimary = (apType === 'Primary');
    const band = alias.includes('5GHz') ? '5GHz' : '2.4GHz';
    let guestId = 0;

    if (!isPrimary && !isHidden) {
       if (numIdx === 2 || numIdx === 4) guestId = 1;
       else if (numIdx === 5 || numIdx === 7) guestId = 2;
       else if (numIdx === 6 || numIdx === 8) guestId = 3;
       else guestId = 99;
    }
    return { band, isPrimary, guestId, isHidden };
  }

  if (isTR181) {
    if (numIdx === 1) return { band: '2.4GHz', isPrimary: true, guestId: 0, isHidden: false };
    if (numIdx === 3) return { band: '5GHz', isPrimary: true, guestId: 0, isHidden: false };
    if (numIdx === 2) return { band: '2.4GHz', isPrimary: false, guestId: 1, isHidden: false };
    if (numIdx === 4) return { band: '5GHz', isPrimary: false, guestId: 1, isHidden: false };
    if (numIdx === 5) return { band: '2.4GHz', isPrimary: false, guestId: 2, isHidden: false };
    if (numIdx === 7) return { band: '5GHz', isPrimary: false, guestId: 2, isHidden: false };
    if (numIdx === 6) return { band: '2.4GHz', isPrimary: false, guestId: 3, isHidden: false };
    if (numIdx === 8) return { band: '5GHz', isPrimary: false, guestId: 3, isHidden: false };
    return { band: '2.4GHz', isPrimary: false, guestId: 99, isHidden: true };
  }
  return { band: '2.4GHz', isPrimary: true, guestId: 0, isHidden: false };
}

export function mapTr069ToWifiConfigs(paramsArray: any[]): { configs: DynamicSsidConfig[], smartConnectEnabled: boolean } {
  const configs: DynamicSsidConfig[] = [];
  const hasData = paramsArray && paramsArray.length > 0;
  const isDeviceTR181 = hasData && paramsArray.some((p: any) => p.name.startsWith('Device.'));

  const scPath = isDeviceTR181 ? 'Device.WiFi.X_TP_BandSteering.Enable' : 'InternetGatewayDevice.LANDevice.1.X_TP_BandSteering';
  const smartConnectEnabled = parseBoolean(getParamValue(paramsArray, scPath));

  if (hasData) {
    const uniqueIndexes = new Set<string>();

    paramsArray.forEach((param: any) => {
      const match181 = param.name.match(/^Device\.WiFi\.SSID\.(\d+)\.SSID$/);
      const match098 = param.name.match(/^InternetGatewayDevice\.LANDevice\.1\.WLANConfiguration\.(\d+)\.SSID$/);
      const match = match181 || match098;

      if (match && match[1]) {
        const idx = match[1];
        if (!uniqueIndexes.has(idx)) {
          uniqueIndexes.add(idx);

          const isNodeTR181 = !!match181;
          const alias = getParamValue(paramsArray, `Device.WiFi.AccessPoint.${idx}.Alias`);
          const apType = getParamValue(paramsArray, `Device.WiFi.AccessPoint.${idx}.X_TP_APType`);
          const topology = classifySsidByHardware(idx, alias, apType, isNodeTR181);

          if (topology.isHidden) return;

          const namePath = param.name;
          const enablePath = isNodeTR181 ? `Device.WiFi.SSID.${idx}.Enable` : `InternetGatewayDevice.LANDevice.1.WLANConfiguration.${idx}.Enable`;
          const apEnablePath = isNodeTR181 ? `Device.WiFi.AccessPoint.${idx}.Enable` : undefined;
          const statusPath = isNodeTR181 ? `Device.WiFi.AccessPoint.${idx}.Status` : `InternetGatewayDevice.LANDevice.1.WLANConfiguration.${idx}.Status`;

          const securityModePath = isNodeTR181 ? `Device.WiFi.AccessPoint.${idx}.Security.ModeEnabled` : `InternetGatewayDevice.LANDevice.1.WLANConfiguration.${idx}.BeaconType`;
          const rawSec = getParamValue(paramsArray, securityModePath);
          let uiSecurityMode: 'None' | 'WPA2' | 'WPA2-WPA3' = 'WPA2';
          if (rawSec.includes('None') || rawSec === 'Basic') uiSecurityMode = 'None';
          else if (rawSec.includes('WPA3')) uiSecurityMode = 'WPA2-WPA3';

          let adminEnable = false;
          if (isNodeTR181 && apEnablePath) {
              const apVal = getParamValue(paramsArray, apEnablePath);
              adminEnable = apVal !== '' ? parseBoolean(apVal) : parseBoolean(getParamValue(paramsArray, enablePath));
          } else {
              adminEnable = parseBoolean(getParamValue(paramsArray, enablePath));
          }

          const rawStatus = getParamValue(paramsArray, statusPath);
          const statusVal = rawStatus || 'Down';
          let finalEnable = false;
          let hardwareLock = false;

          if (rawStatus !== '') {
              const s = statusVal.toLowerCase();
              finalEnable = (s === 'up' || s === 'enabled');
              if (s === 'lowerlayerdown' || s === 'error' || s === 'notpresent') {
                  hardwareLock = true;
              }
          } else {
              finalEnable = adminEnable;
          }

          // CORREÇÃO: Garantia de abordagem Híbrida solicitada.
          // Se a árvore identificada for TR-181 usa o padrão moderno.
          // Caso seja TR-098 (Intelbras/TP-Link legados), busca a senha no path legado correto.
          const passPath = isNodeTR181 
            ? `Device.WiFi.AccessPoint.${idx}.Security.KeyPassphrase` 
            : `InternetGatewayDevice.LANDevice.1.WLANConfiguration.${idx}.PreSharedKey.1.PreSharedKey`;
            
          const muMimoPath = `Device.WiFi.AccessPoint.${idx}.MUMIMOEnable`;
          const ofdmaPath = `Device.WiFi.AccessPoint.${idx}.OFDMAEnable`;
          const atfPath = getParamValue(paramsArray, `Device.WiFi.AccessPoint.${idx}.ATFEnable`) !== '' ? `Device.WiFi.AccessPoint.${idx}.ATFEnable` : `Device.WiFi.SSID.${idx}.ATFEnable`;
          const ssidName = param.value || '';
          const isDefaultGhost = ssidName.includes('Auto_Reset') || ssidName.includes('TP-Link');

          configs.push({
            index: idx,
            name: ssidName,
            password: getParamValue(paramsArray, passPath),
            securityMode: uiSecurityMode,
            enable: finalEnable,
            status: statusVal,
            isLockedByHardware: hardwareLock,
            atf: parseBoolean(getParamValue(paramsArray, atfPath)),
            muMimo: parseBoolean(getParamValue(paramsArray, muMimoPath)),
            ofdma: parseBoolean(getParamValue(paramsArray, ofdmaPath)),
            band: topology.band,
            isPrimary: topology.isPrimary,
            guestId: topology.guestId,
            uiVisible: topology.isPrimary || (adminEnable && !isDefaultGhost),
            isTR181: isNodeTR181,
            namePath, passPath, securityModePath, enablePath, atfPath, muMimoPath, ofdmaPath,
            accessPointEnablePath: apEnablePath
          });
        }
      }
    });

    configs.sort((a, b) => parseInt(a.index, 10) - parseInt(b.index, 10));
  }

  return { configs, smartConnectEnabled };
}
