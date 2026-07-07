import { Injectable } from '@angular/core';
import { FormGroup } from '@angular/forms';
import { WIFI_CONSTANTS } from './wifi-constants';
import { sanitizeSsidName } from './wifi-sanitizer';
import { WIFI_FIELD_REGISTRY, WifiFieldDef } from './wifi-field-registry';

export interface WifiParam {
  name: string;
  value: string;
  type?: 'xsd:string' | 'xsd:boolean' | 'xsd:int' | 'xsd:unsignedInt';
}

export interface BuildAllParamsResult {
  success: boolean;
  params: WifiParam[];
  error?: string;
}

@Injectable({ providedIn: 'root' })
export class WifiParameterBuilderService {
  /**
   * Converte modo de segurança UI para valor TR-069
   */
  private toCpeSecurityValue(uiMode: string, isTR181: boolean): string {
    if (isTR181) {
      if (uiMode === WIFI_CONSTANTS.SECURITY_MODES.NONE) return WIFI_CONSTANTS.TR181_SECURITY_VALUES.NONE;
      if (uiMode === WIFI_CONSTANTS.SECURITY_MODES.WPA2_WPA3) return WIFI_CONSTANTS.TR181_SECURITY_VALUES.WPA2_WPA3;
      return WIFI_CONSTANTS.TR181_SECURITY_VALUES.WPA2;
    }
    if (uiMode === WIFI_CONSTANTS.SECURITY_MODES.NONE) return WIFI_CONSTANTS.TR098_SECURITY_VALUES.NONE;
    return WIFI_CONSTANTS.TR098_SECURITY_VALUES.WPA2;
  }

  /** Converte boolean para string "true"/"false" (compatível com parameterSchema Zod: value=z.string()) */
  private boolStr(v: boolean | null | undefined): string {
    return v ? 'true' : 'false';
  }

  /**
   * Constrói todos os parâmetros TR-069 para um SSID.
   * Usa os paths do form (populados pelo mapper — fonte única de verdade).
   * NÃO reconstrói paths — evita divergência entre SSID/AccessPoint.
   *
   * @param ssidForm FormGroup do SSID (deve conter os campos *Path do mapper)
   * @param capabilities Record de capabilities (ex: { atf: true, muMimo: false })
   * @returns Resultado com sucesso ou erro
   */
  buildAllParams(ssidForm: FormGroup, capabilities: Record<string, boolean> = {}): BuildAllParamsResult {
    const params: WifiParam[] = [];
    // CRÍTICO: usa getRawValue() em vez de .value — .value EXCLUI campos desabilitados.
    // Se o campo password estiver desabilitado (ex: securityMode era 'None' e foi
    // espelhado para 'WPA2' via bandSteering.sync sem reabilitar o campo), .value
    // retorna undefined para password, causando falso erro "Senha obrigatória".
    // getRawValue() inclui TODOS os campos, inclusive desabilitados.
    const values = ssidForm.getRawValue();

    // Guard: SSID deve estar habilitado para enviar parâmetros
    if (!values.enable) {
      return { success: false, params: [], error: 'SSID desabilitado' };
    }

    // Guard: SSID não pode ser vazio
    if (!values.name || values.name.trim() === '') {
      return { success: false, params: [], error: 'Nome do SSID não pode ser vazio' };
    }

    // Guard: Segurança WPA2/WPA3 requer senha válida
    if (values.securityMode !== 'None') {
      const pwd: string = (values.password ?? '').trim();
      if (!pwd || pwd === '') {
        return { success: false, params: [], error: 'Senha obrigatória para segurança WPA2/WPA3' };
      }
      if (pwd.length < WIFI_CONSTANTS.PASSWORD.MIN_LENGTH || pwd.length > WIFI_CONSTANTS.PASSWORD.MAX_LENGTH) {
        return {
          success: false, params: [],
          error: `Senha deve ter ${WIFI_CONSTANTS.PASSWORD.MIN_LENGTH}–${WIFI_CONSTANTS.PASSWORD.MAX_LENGTH} caracteres.`
        };
      }
      if (!WIFI_CONSTANTS.PASSWORD.REGEX.test(pwd)) {
        return { success: false, params: [], error: 'Senha contém caracteres inválidos (apenas ASCII imprimível).' };
      }
    }

    // Itera sobre o registry (fonte única de verdade) para construir os parâmetros SPV.
    // Cada categoria tem comportamento específico preservado da implementação anterior:
    //   basic:               sempre enviado
    //   password:            enviado apenas se securityMode !== 'None'
    //   toggle:              boolean, capability-gated, TR-181 only se tr098Suffix=null
    //   toggle-inverted:     boolean invertido (hidden → SSIDAdvertisementEnabled)
    //   skip-spv:            NÃO enviado (wps — risco Fault 9007)
    //   numeric-conditional: enviado apenas se conditionalOn for true
    //   value-conversion:    securityMode com conversão UI→CPE
    //   tr181-mirror-enable: AccessPoint.Enable espelha valor de enable (TR-181 only)
    for (const def of WIFI_FIELD_REGISTRY) {
      // Skip WPS — não enviado via SPV (Fault 9007)
      if (def.category === 'skip-spv') continue;

      // Password: só envia se securityMode !== 'None'
      if (def.category === 'password') {
        if (values.securityMode === 'None') continue;
        if (!values.password || !values[def.pathField as string]) continue;
        params.push({
          name: values[def.pathField as string],
          value: String(values.password).trim(),
          type: def.type,
        });
        continue;
      }

      // tr181-mirror-enable: AccessPoint.Enable — só TR-181, usa valor de enable
      if (def.category === 'tr181-mirror-enable') {
        if (!values.isTR181 || !values[def.pathField as string]) continue;
        params.push({
          name: values[def.pathField as string],
          value: this.boolStr(values.enable),
          type: def.type,
        });
        continue;
      }

      // value-conversion: securityMode com conversão UI→CPE
      if (def.category === 'value-conversion') {
        if (!values[def.pathField as string]) continue;
        params.push({
          name: values[def.pathField as string],
          value: this.toCpeSecurityValue(values.securityMode, values.isTR181),
          type: def.type,
        });
        continue;
      }

      // Capability gate: pula se a capability não está habilitada
      if (def.capability && !capabilities[def.capability]) continue;

      // TR-181 only: pula se é TR-098 e o campo não tem sufixo TR-098
      if (!values.isTR181 && def.tr098Suffix === null) continue;

      // numeric-conditional: só envia se conditionalOn for true e valor é válido
      if (def.category === 'numeric-conditional') {
        if (!values[def.conditionalOn as string]) continue;
        const numValue = values[def.formField as string];
        if (numValue === null || numValue === undefined || isNaN(numValue)) continue;
        if (!values[def.pathField as string]) continue;
        params.push({
          name: values[def.pathField as string],
          value: String(numValue),
          type: def.type,
        });
        continue;
      }

      // basic, toggle, toggle-inverted: valor boolean ou string
      const rawValue = values[def.formField as string];
      if (rawValue === null || rawValue === undefined) continue;
      if (!values[def.pathField as string]) continue;

      let value: string;
      if (def.category === 'toggle-inverted') {
        // Hidden: hidden=true (oculto) → SSIDAdvertisementEnabled=false
        value = this.boolStr(!rawValue);
      } else if (def.type === 'xsd:boolean') {
        value = this.boolStr(rawValue);
      } else if (def.formField === 'name') {
        // Nome do SSID: sanitizado para evitar caracteres perigosos na CPE
        value = sanitizeSsidName(String(rawValue));
      } else {
        value = String(rawValue);
      }

      params.push({
        name: values[def.pathField as string],
        value,
        type: def.type,
      });
    }

    return { success: true, params };
  }
}
