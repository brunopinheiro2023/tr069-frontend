import { CpeDevice, DynamicSsidConfig } from '../../../../../../core/models';
import { WIFI_CONSTANTS } from './wifi-constants';
import { buildAllPathsForIdx, buildAdvancedValuesFromAp, buildPathForField, getEnrichableToggleFields } from './wifi-field-registry';

export { DynamicSsidConfig };

function getParamValue(params: any[], paramName: string): string {
  if (!Array.isArray(params) || !paramName) return '';
  const param = params.find((p: any) => p && typeof p.name === 'string' && p.name === paramName);
  return param ? String(param.value ?? '') : '';
}

function parseBoolean(value: any): boolean {
  if (value === undefined || value === null || value === '') return false;
  const strVal = String(value).trim().toLowerCase();
  return strVal === '1' || strVal === 'true';
}

const HIDDEN_AP_TYPES = WIFI_CONSTANTS.HIDDEN_AP_TYPES;

// Mapeamento de índices para guestId (fallback para dados legados sem apType)
const GUEST_ID_FALLBACK = WIFI_CONSTANTS.GUEST_ID_FALLBACK;

const UNKNOWN_GUEST_ID = WIFI_CONSTANTS.UNKNOWN_GUEST_ID;

/**
 * Determina o guestId de um AP baseado no apType ou índice (fallback).
 * @returns guestId (0=Primary, 1-3=Guest, 99=Desconhecido)
 */
function determineGuestId(apType: string | null, idx: string, band: '2.4GHz' | '5GHz'): number {
  // Se é Primary, guestId é 0
  if (apType === 'Primary') return 0;
  
  // Se não é Primary, tenta extrair do apType
  const apTypeStr = (apType || '').toLowerCase();
  const guestMatch = apTypeStr.match(/guest\s*(\d+)/) || apTypeStr.match(/visitante\s*(\d+)/);
  if (guestMatch) {
    const guestNum = parseInt(guestMatch[1], 10);
    return isNaN(guestNum) ? UNKNOWN_GUEST_ID : guestNum;
  }
  
  // Se apType existe mas não é reconhecido, assume desconhecido
  if (apType) return UNKNOWN_GUEST_ID;
  
  // Fallback: usa mapeamento por índice (dados legados sem apType)
  const numIdx = parseInt(idx, 10);
  if (isNaN(numIdx)) return UNKNOWN_GUEST_ID;
  const fallbackMap = GUEST_ID_FALLBACK[band] as Record<number, number>;
  return fallbackMap[numIdx] ?? UNKNOWN_GUEST_ID;
}

function normalizeSecurityMode(rawSec: string, isTR181: boolean): 'None' | 'WPA2' | 'WPA2-WPA3' {
  const sec = (rawSec || '').trim();
  if (!sec || sec === 'None' || sec === 'Basic') return 'None';
  if (sec.includes('WPA3')) return 'WPA2-WPA3';
  if (isTR181) {
    if (sec.includes('WPA2') || sec.includes('WPA')) return 'WPA2';
  } else {
    if (sec === '11i') return 'WPA2';
  }
  return 'WPA2';
}

/**
 * Fallback: constrói DynamicSsidConfig a partir dos sub-objetos wifi2g/wifi5g do banco.
 * Esta é a FONTE PRIMÁRIA de SSIDs - o banco é a verdade.
 * parametersCache é usado apenas para enriquecer com valores avançados (ATF, MU-MIMO, OFDMA, etc).
 */
function buildFallbackConfigsFromBands(cpe: CpeDevice | null, isTR181: boolean): DynamicSsidConfig[] {
  if (!cpe) return [];
  const configs: DynamicSsidConfig[] = [];
  const bands: Array<{ band: '2.4GHz' | '5GHz'; data: any }> = [
    { band: '2.4GHz', data: cpe.wifi2g },
    { band: '5GHz', data: cpe.wifi5g }
  ];

  for (const { band, data } of bands) {
    const aps = data?.accessPoints || [];
    for (const ap of aps) {
      const idx = String(ap.index);
      
      // Filtra APs que não são SSIDs de usuário (Backhaul, Public, IoTNetwork, etc)
      const apTypeStr = (ap.apType || '').toLowerCase();
      if (HIDDEN_AP_TYPES.some(hidden => apTypeStr.includes(hidden.toLowerCase()))) {
        continue;
      }
      
      // Usa dados do banco como fonte de verdade - não infere nada
      const isPrimary = ap.apType === 'Primary';
      
      // Determina guestId usando função helper
      const guestId = determineGuestId(ap.apType, idx, band);
      
      const securityRaw = ap.security || '';
      const securityMode = securityRaw.includes('WPA3') ? 'WPA2-WPA3' : (securityRaw === 'None' ? 'None' : 'WPA2');
      const name = ap.ssid || '';
      
      // Proteção contra dados corrompidos (bug no backend)
      if (typeof name !== 'string') {
        continue;
      }
      
      // Proteção contra status corrompido
      const status = ap.status;
      if (typeof status !== 'string') {
        continue;
      }
      
      // Paths e valores avançados derivados do registry (fonte única de verdade)
      const advancedPaths = buildAllPathsForIdx(idx, isTR181);
      const advancedValues = buildAdvancedValuesFromAp(ap);

      configs.push({
        index: idx,
        name,
        // Senha: usa do campo password do AP (backend já decriptografou)
        password: (typeof ap.password === 'string') ? ap.password : '',
        securityMode,
        enable: ap.enable ?? false,
        status: (typeof ap.status === 'string') ? ap.status : 'Down',
        isLockedByHardware: false,
        ...advancedValues,
        band,
        isPrimary,
        guestId,
        // uiVisible: SSID aparece se enable=true, status="Enabled" E tem nome válido
        // Isso se aplica tanto para Primary quanto para não-primary
        uiVisible: ap.enable === true &&
                  (ap.status === 'Enabled' || ap.status === 'Up') &&
                  name.trim() !== '',
        isTR181,
        namePath: isTR181 ? `Device.WiFi.SSID.${idx}.SSID` : `InternetGatewayDevice.LANDevice.1.WLANConfiguration.${idx}.SSID`,
        passPath: isTR181 ? `Device.WiFi.AccessPoint.${idx}.Security.KeyPassphrase` : `InternetGatewayDevice.LANDevice.1.WLANConfiguration.${idx}.PreSharedKey.1.PreSharedKey`,
        securityModePath: isTR181 ? `Device.WiFi.AccessPoint.${idx}.Security.ModeEnabled` : `InternetGatewayDevice.LANDevice.1.WLANConfiguration.${idx}.BeaconType`,
        enablePath: isTR181 ? `Device.WiFi.SSID.${idx}.Enable` : `InternetGatewayDevice.LANDevice.1.WLANConfiguration.${idx}.Enable`,
        accessPointEnablePath: isTR181 ? `Device.WiFi.AccessPoint.${idx}.Enable` : undefined,
        ...advancedPaths
      } as DynamicSsidConfig);
    }
  }
  return configs.sort((a, b) => {
    const aIdx = parseInt(a.index, 10);
    const bIdx = parseInt(b.index, 10);
    if (isNaN(aIdx) || isNaN(bIdx)) return 0;
    return aIdx - bIdx;
  });
}

export function mapTr069ToWifiConfigs(
  cpe: CpeDevice | null
): { configs: DynamicSsidConfig[]; smartConnectEnabled: boolean } {
  const paramsArray = cpe?.parametersCache || [];
  const configs: DynamicSsidConfig[] = [];
  const hasData = paramsArray && paramsArray.length > 0;
  // Detecção TR-181: prioriza parametersCache (paths Device.* = TR-181).
  // Fallback: manufacturerCode do deviceInfo (TPLINK = TR-181, INTELBRAS = TR-098).
  // Necessário porque parametersCache pode estar vazio antes do bootstrap.
  const isDeviceTR181 = hasData
    ? paramsArray.some((p: any) => p && typeof p.name === 'string' && p.name.startsWith('Device.'))
    : (cpe?.deviceInfo?.manufacturerCode !== 'INTELBRAS');

  const scPath = isDeviceTR181
    ? 'Device.WiFi.X_TP_BandSteering.Enable'
    : 'InternetGatewayDevice.X_ITBS_WlanBandSteering';
  const smartConnectEnabled = parseBoolean(getParamValue(paramsArray, scPath)) || cpe?.wifiConfig?.bandSteering || false;

  // SEMPRE usa dados do banco (wifi2g/wifi5g) como fonte primária de SSIDs
  // parametersCache é usado apenas para enriquecer com valores avançados (ATF, MU-MIMO, OFDMA, etc)
  const fallbackConfigs = buildFallbackConfigsFromBands(cpe, isDeviceTR181);
  
  // Usa configs do banco como fonte primária
  configs.push(...fallbackConfigs);
  
  // Enriquece com valores avançados do parametersCache se disponível
  if (hasData) {
    configs.forEach(config => {
      const idx = config.index;
      
      // Senha: ap.password é a fonte primária (decriptografada pelo backend).
      // Fallback: se ap.password está vazio (CPE recém-bootstrapada ou senha nunca salva via ACS),
      // lê do parametersCache (coletado via GPV on-demand — texto plano da CPE).
      if (!config.password && config.passPath) {
        const cachedPwd = getParamValue(paramsArray, config.passPath);
        if (cachedPwd !== '') config.password = cachedPwd;
      }

      // Enriquece com valores avançados do parametersCache se disponível
      // TR-098 (Intelbras) não suporta ATF/MU-MIMO/OFDMA/TWT — só enriquece se TR-181
      if (isDeviceTR181) {
        for (const def of getEnrichableToggleFields()) {
          if (!def.tr181Suffix) continue;
          const fullPath = buildPathForField(def, idx, true);
          const cachedValue = getParamValue(paramsArray, fullPath);
          if (cachedValue !== '') {
            (config as any)[def.formField] = parseBoolean(cachedValue);
          }
        }
      }
    });
  }

  return { configs, smartConnectEnabled };
}
