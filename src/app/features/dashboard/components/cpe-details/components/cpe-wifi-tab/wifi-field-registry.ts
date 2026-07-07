/**
 * Registry centralizado de campos Wi-Fi — fonte única de verdade tabular.
 *
 * Substitui a duplicação de definições espalhadas entre mapper, builder,
 * bandSteering e component. Adicionar um novo parâmetro Wi-Fi = adicionar
 * 1 entrada neste array + 1 linha no DynamicSsidConfig + 1 toggle no HTML.
 *
 * Cada entrada define:
 *   - formField:  campo do FormGroup que guarda o VALOR
 *   - pathField:  campo do FormGroup que guarda o PATH TR-069
 *   - root:       prefixo do path (ssid=SSID.{i} | ap=AccessPoint.{i})
 *   - tr181Suffix / tr098Suffix: sufixo do path por padrão (null=TR-181 only)
 *   - type:       tipo SPV (xsd:string | xsd:boolean | xsd:unsignedInt)
 *   - capability: capability que habilita o campo (null=sempre enviado)
 *   - category:   comportamento do campo (ver WifiFieldCategory)
 *   - mirror:     se bandSteering.sync deve espelhar este campo
 *   - default:    valor default quando ausente no AP do banco
 *
 * Comportamentos especiais (category):
 *   basic:               sempre enviado, sem capability (name, enable, etc)
 *   password:            enviado apenas se securityMode !== 'None'
 *   toggle:              boolean simples, capability-gated
 *   toggle-inverted:     boolean invertido ao enviar (hidden → SSIDAdvertisementEnabled)
 *   skip-spv:            NÃO enviado via SPV (wps — risco Fault 9007)
 *   numeric-conditional: enviado apenas se conditionalOn for true (tcMaxDown etc)
 *   value-conversion:    valor convertido UI→CPE (securityMode)
 *   tr181-mirror-enable: AccessPoint.Enable espelha valor de enable (TR-181 only)
 */
import { WIFI_CONSTANTS } from './wifi-constants';

export type WifiFieldCategory =
  | 'basic'
  | 'password'
  | 'toggle'
  | 'toggle-inverted'
  | 'skip-spv'
  | 'numeric-conditional'
  | 'value-conversion'
  | 'tr181-mirror-enable';

export type PathRoot = 'ssid' | 'ap';

export interface WifiFieldDef {
  /** Campo do form que guarda o valor */
  formField: string;
  /** Campo do form que guarda o path TR-069 */
  pathField: string;
  /** Prefixo do path: ssid=Device.WiFi.SSID.{i} | ap=Device.WiFi.AccessPoint.{i} */
  root: PathRoot;
  /** Sufixo do path TR-181 (ex: 'ATFEnable'). null = não existe em TR-181 */
  tr181Suffix: string | null;
  /** Sufixo do path TR-098 (ex: 'SSIDAdvertisementEnabled'). null = não existe em TR-098 */
  tr098Suffix: string | null;
  /** Tipo do parâmetro SPV */
  type: 'xsd:string' | 'xsd:boolean' | 'xsd:unsignedInt';
  /** Capability que habilita o campo (null = sempre enviado, sem capability) */
  capability: string | null;
  /** Comportamento do campo */
  category: WifiFieldCategory;
  /** Se bandSteering.sync deve espelhar este campo 2.4GHz → 5GHz */
  mirror: boolean;
  /** Valor default quando ausente no AP do banco */
  default: boolean | null;
  /** Para numeric-conditional: campo do form que habilita o envio */
  conditionalOn?: string;
}

/**
 * Registry de todos os campos Wi-Fi avançados e básicos.
 *
 * CAMPOS BÁSICOS (sempre enviados, sem capability):
 *   name, enable, accessPointEnable, securityMode, password
 *
 * CAMPOS AVANÇADOS (capability-gated, espelhados pelo SC):
 *   hidden, isolation, beamforming, wpsEnable, wmmEnable,
 *   atf, muMimo, ofdma, twt, bssColor,
 *   tcEnable, tcMaxDown, tcMaxUp, tcMinDown, tcMinUp,
 *   lanAccess, usbAccess
 */
export const WIFI_FIELD_REGISTRY: readonly WifiFieldDef[] = [
  // ── BÁSICOS (sempre enviados) ──────────────────────────────────────────────
  {
    formField: 'name',
    pathField: 'namePath',
    root: 'ssid',
    tr181Suffix: 'SSID',
    tr098Suffix: 'SSID',
    type: 'xsd:string',
    capability: null,
    category: 'basic',
    mirror: true,
    default: null,
  },
  {
    formField: 'enable',
    pathField: 'enablePath',
    root: 'ssid',
    tr181Suffix: 'Enable',
    tr098Suffix: 'Enable',
    type: 'xsd:boolean',
    capability: null,
    category: 'basic',
    mirror: false,
    default: false,
  },
  {
    // AccessPoint.Enable — TR-181 only, usa o valor de 'enable' (não tem campo próprio)
    formField: 'enable',
    pathField: 'accessPointEnablePath',
    root: 'ap',
    tr181Suffix: 'Enable',
    tr098Suffix: null,
    type: 'xsd:boolean',
    capability: null,
    category: 'tr181-mirror-enable',
    mirror: false,
    default: false,
  },
  {
    formField: 'securityMode',
    pathField: 'securityModePath',
    root: 'ap',
    tr181Suffix: 'Security.ModeEnabled',
    tr098Suffix: 'BeaconType',
    type: 'xsd:string',
    capability: null,
    category: 'value-conversion',
    mirror: true,
    default: null,
  },
  {
    formField: 'password',
    pathField: 'passPath',
    root: 'ap',
    tr181Suffix: 'Security.KeyPassphrase',
    tr098Suffix: 'PreSharedKey.1.PreSharedKey',
    type: 'xsd:string',
    capability: null,
    category: 'password',
    mirror: true,
    default: null,
  },

  // ── CONFIGURAÇÕES DO ACCESS POINT ──────────────────────────────────────────
  {
    formField: 'hidden',
    pathField: 'hiddenPath',
    root: 'ap',
    tr181Suffix: 'SSIDAdvertisementEnabled',
    tr098Suffix: 'SSIDAdvertisementEnabled',
    type: 'xsd:boolean',
    capability: null,
    category: 'toggle-inverted',
    mirror: true,
    default: false,
  },
  {
    formField: 'isolation',
    pathField: 'isolationPath',
    root: 'ap',
    tr181Suffix: 'IsolationEnable',
    tr098Suffix: null,
    type: 'xsd:boolean',
    capability: 'apConfig',
    category: 'toggle',
    mirror: true,
    default: false,
  },
  {
    formField: 'beamforming',
    pathField: 'beamformingPath',
    root: 'ap',
    tr181Suffix: 'X_TP_TxBFEnable',
    tr098Suffix: null,
    type: 'xsd:boolean',
    capability: 'apConfig',
    category: 'toggle',
    mirror: true,
    default: false,
  },

  // ── WPS e WMM ──────────────────────────────────────────────────────────────
  {
    // WPS.Enable NÃO é enviado via SPV (Fault 9007 quando na mesma transação
    // que Security.ModeEnabled + KeyPassphrase). Apenas espelhado no form.
    formField: 'wpsEnable',
    pathField: 'wpsEnablePath',
    root: 'ap',
    tr181Suffix: 'WPS.Enable',
    tr098Suffix: null,
    type: 'xsd:boolean',
    capability: 'wpsWmm',
    category: 'skip-spv',
    mirror: true,
    default: false,
  },
  {
    formField: 'wmmEnable',
    pathField: 'wmmEnablePath',
    root: 'ap',
    tr181Suffix: 'WMMEnable',
    tr098Suffix: null,
    type: 'xsd:boolean',
    capability: 'wpsWmm',
    category: 'toggle',
    mirror: true,
    default: false,
  },

  // ── RECURSOS AVANÇADOS DE RÁDIO (Wi-Fi 6) ──────────────────────────────────
  {
    formField: 'atf',
    pathField: 'atfPath',
    root: 'ap',
    tr181Suffix: 'ATFEnable',
    tr098Suffix: null,
    type: 'xsd:boolean',
    capability: 'advancedRadio',
    category: 'toggle',
    mirror: true,
    default: false,
  },
  {
    formField: 'muMimo',
    pathField: 'muMimoPath',
    root: 'ap',
    tr181Suffix: 'MUMIMOEnable',
    tr098Suffix: null,
    type: 'xsd:boolean',
    capability: 'advancedRadio',
    category: 'toggle',
    mirror: true,
    default: false,
  },
  {
    formField: 'ofdma',
    pathField: 'ofdmaPath',
    root: 'ap',
    tr181Suffix: 'OFDMAEnable',
    tr098Suffix: null,
    type: 'xsd:boolean',
    capability: 'advancedRadio',
    category: 'toggle',
    mirror: true,
    default: false,
  },
  {
    formField: 'twt',
    pathField: 'twtPath',
    root: 'ap',
    tr181Suffix: 'TWTEnable',
    tr098Suffix: null,
    type: 'xsd:boolean',
    capability: 'advancedRadio',
    category: 'toggle',
    mirror: true,
    default: false,
  },
  {
    formField: 'bssColor',
    pathField: 'bssColorPath',
    root: 'ap',
    tr181Suffix: 'BSSColorEnable',
    tr098Suffix: null,
    type: 'xsd:boolean',
    capability: 'advancedRadio',
    category: 'toggle',
    mirror: true,
    default: false,
  },

  // ── CONTROLE DE TRÁFEGO ────────────────────────────────────────────────────
  {
    formField: 'tcEnable',
    pathField: 'tcEnablePath',
    root: 'ap',
    tr181Suffix: 'X_TP_ControlFunction.TCEnable',
    tr098Suffix: null,
    type: 'xsd:boolean',
    capability: 'trafficControl',
    category: 'toggle',
    mirror: true,
    default: false,
  },
  {
    formField: 'tcMaxDown',
    pathField: 'tcMaxDownPath',
    root: 'ap',
    tr181Suffix: 'X_TP_ControlFunction.TCMaxDownBW',
    tr098Suffix: null,
    type: 'xsd:unsignedInt',
    capability: 'trafficControl',
    category: 'numeric-conditional',
    mirror: true,
    default: null,
    conditionalOn: 'tcEnable',
  },
  {
    formField: 'tcMaxUp',
    pathField: 'tcMaxUpPath',
    root: 'ap',
    tr181Suffix: 'X_TP_ControlFunction.TCMaxUpBW',
    tr098Suffix: null,
    type: 'xsd:unsignedInt',
    capability: 'trafficControl',
    category: 'numeric-conditional',
    mirror: true,
    default: null,
    conditionalOn: 'tcEnable',
  },
  {
    formField: 'tcMinDown',
    pathField: 'tcMinDownPath',
    root: 'ap',
    tr181Suffix: 'X_TP_ControlFunction.TCMinDownBW',
    tr098Suffix: null,
    type: 'xsd:unsignedInt',
    capability: 'trafficControl',
    category: 'numeric-conditional',
    mirror: true,
    default: null,
    conditionalOn: 'tcEnable',
  },
  {
    formField: 'tcMinUp',
    pathField: 'tcMinUpPath',
    root: 'ap',
    tr181Suffix: 'X_TP_ControlFunction.TCMinUpBW',
    tr098Suffix: null,
    type: 'xsd:unsignedInt',
    capability: 'trafficControl',
    category: 'numeric-conditional',
    mirror: true,
    default: null,
    conditionalOn: 'tcEnable',
  },

  // ── ACESSO À REDE (Control Function) ───────────────────────────────────────
  {
    formField: 'lanAccess',
    pathField: 'lanAccessPath',
    root: 'ap',
    tr181Suffix: 'X_TP_ControlFunction.LanAccessEnable',
    tr098Suffix: null,
    type: 'xsd:boolean',
    capability: 'controlFunction',
    category: 'toggle',
    mirror: true,
    default: false,
  },
  {
    formField: 'usbAccess',
    pathField: 'usbAccessPath',
    root: 'ap',
    tr181Suffix: 'X_TP_ControlFunction.USBAccessEnable',
    tr098Suffix: null,
    type: 'xsd:boolean',
    capability: 'controlFunction',
    category: 'toggle',
    mirror: true,
    default: false,
  },
] as const;

// ── HELPERS DERIVADOS DO REGISTRY ────────────────────────────────────────────

/**
 * Constrói o path TR-069 completo para um campo.
 * @param def Definição do campo no registry
 * @param idx Índice do AccessPoint/SSID (ex: '1', '5')
 * @param isTR181 true para TR-181 (Device.*), false para TR-098 (InternetGatewayDevice.*)
 * @returns Path completo ou string vazia se não suportado no padrão
 */
export function buildPathForField(def: WifiFieldDef, idx: string, isTR181: boolean): string {
  if (isTR181) {
    if (!def.tr181Suffix) return '';
    const root = def.root === 'ssid'
      ? `Device.WiFi.SSID.${idx}`
      : `Device.WiFi.AccessPoint.${idx}`;
    return `${root}.${def.tr181Suffix}`;
  }
  // TR-098: ambos ssid e ap roots mapeiam para WLANConfiguration
  if (!def.tr098Suffix) return '';
  return `InternetGatewayDevice.LANDevice.1.WLANConfiguration.${idx}.${def.tr098Suffix}`;
}

/**
 * Constrói todos os paths para um índice, retornando um Record pathField → path.
 * Usado pelo mapper para popular os campos *Path do DynamicSsidConfig.
 */
export function buildAllPathsForIdx(idx: string, isTR181: boolean): Record<string, string> {
  const paths: Record<string, string> = {};
  for (const def of WIFI_FIELD_REGISTRY) {
    paths[def.pathField] = buildPathForField(def, idx, isTR181);
  }
  return paths;
}

/**
 * Extrai valores de campos avançados de um AP do banco, aplicando defaults.
 * Não inclui campos básicos (name, enable, securityMode, password, status) —
 * esses têm lógica customizada no mapper.
 */
export function buildAdvancedValuesFromAp(ap: any): Record<string, boolean | null> {
  const values: Record<string, boolean | null> = {};
  for (const def of WIFI_FIELD_REGISTRY) {
    if (def.category === 'basic' || def.category === 'value-conversion' ||
        def.category === 'password' || def.category === 'tr181-mirror-enable') continue;
    values[def.formField] = ap?.[def.formField] ?? def.default;
  }
  return values;
}

/**
 * Lista de campos que o bandSteering.sync deve espelhar (2.4GHz → 5GHz).
 * Derivado do registry — não precisa manter lista hardcoded no service.
 */
export function getMirrorFields(): readonly WifiFieldDef[] {
  return WIFI_FIELD_REGISTRY.filter(def => def.mirror);
}

/**
 * Mapeamento pathField → formField para o applyImmediateToggle.
 * Inclui apenas campos toggle (switches na UI) — não inclui basic, password,
 * numeric-conditional nem tr181-mirror-enable.
 */
export function getTogglePathToFieldMap(): Record<string, string> {
  const map: Record<string, string> = {};
  for (const def of WIFI_FIELD_REGISTRY) {
    if (def.category === 'toggle' || def.category === 'toggle-inverted' || def.category === 'skip-spv') {
      map[def.pathField] = def.formField;
    }
  }
  return map;
}

/**
 * Lista de campos toggle (boolean) que podem ser enriquecidos do parametersCache.
 * Usado pelo mapper para enriquecer valores via GPV on-demand.
 */
export function getEnrichableToggleFields(): readonly WifiFieldDef[] {
  return WIFI_FIELD_REGISTRY.filter(def =>
    def.category === 'toggle' || def.category === 'toggle-inverted'
  );
}
