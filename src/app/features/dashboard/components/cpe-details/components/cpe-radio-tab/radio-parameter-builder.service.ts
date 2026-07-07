import { Injectable } from '@angular/core';
import { FormGroup } from '@angular/forms';
import { RADIO_CONSTANTS, RadioFormValues } from './radio-constants';
import { RADIO_FIELD_REGISTRY } from './radio-field-registry';

export interface RadioParam {
  name: string;
  value: string;
  type?: 'xsd:string' | 'xsd:boolean' | 'xsd:int' | 'xsd:unsignedInt';
}

export interface BuildRadioParamsResult {
  success: boolean;
  params: RadioParam[];
  error?: string;
}

/**
 * Serviço responsável por construir o payload SPV (SetParameterValues) de rádio.
 * Itera sobre o RADIO_FIELD_REGISTRY (fonte única de verdade) e aplica conversões
 * específicas por protocolo (TR-181 vs TR-098).
 *
 * Conversões:
 *   - bandwidth TR-098: "20" → "20MHz" (Intelbras armazena com sufixo)
 *   - autoChannel: derivado do Channel — se 'Auto', envia AutoChannelEnable=true
 *   - channel 'Auto': NÃO envia Channel (apenas AutoChannelEnable=true)
 *   - boolean: converte para 'true'/'false' (compatível com parameterSchema Zod)
 */
@Injectable({ providedIn: 'root' })
export class RadioParameterBuilderService {

  /** Converte boolean para string "true"/"false" (compatível com parameterSchema Zod). */
  private boolStr(v: boolean | null | undefined): string {
    return v ? 'true' : 'false';
  }

  /**
   * Constrói todos os parâmetros TR-069 para uma banda de rádio.
   *
   * @param bandForm FormGroup da banda (deve conter os campos *Path do mapper)
   * @returns Resultado com sucesso ou erro
   */
  buildBandParams(bandForm: FormGroup): BuildRadioParamsResult {
    const params: RadioParam[] = [];
    // getRawValue() inclui campos desabilitados — evita perda de valores
    const values = bandForm.getRawValue() as RadioFormValues;

    const isAuto = values.channel === RADIO_CONSTANTS.AUTO_CHANNEL;

    for (const def of RADIO_FIELD_REGISTRY) {
      const path = values[def.pathField as keyof RadioFormValues] as string;
      if (!path) continue;

      // AutoChannelEnable — derivado do valor de Channel
      if (def.category === 'auto-channel') {
        params.push({
          name: path,
          value: this.boolStr(isAuto),
          type: def.type,
        });
        continue;
      }

      // Channel — NÃO envia se 'Auto' (apenas AutoChannelEnable=true é enviado)
      if (def.category === 'basic' && def.formField === 'channel') {
        if (isAuto) continue; // Canal automático — CPE escolhe sozinha
        const channelVal = values[def.formField as keyof RadioFormValues] as string;
        if (!channelVal) continue;
        params.push({
          name: path,
          value: String(channelVal),
          type: def.type,
        });
        continue;
      }

      // Enable — boolean básico
      if (def.category === 'basic' && def.formField === 'enable') {
        params.push({
          name: path,
          value: this.boolStr(values.enable),
          type: def.type,
        });
        continue;
      }

      // Bandwidth — TR-181 e TR-098 usam sufixo "MHz" (ex: "40MHz")
      if (def.category === 'bandwidth') {
        const bwVal = values[def.formField as keyof RadioFormValues] as string;
        if (!bwVal) continue;
        params.push({
          name: path,
          value: `${bwVal}${RADIO_CONSTANTS.TR098_BANDWIDTH_SUFFIX}`,
          type: def.type,
        });
        continue;
      }

      // Power — unsignedInt, sem conversão
      if (def.category === 'power') {
        const powerVal = values[def.formField as keyof RadioFormValues] as string;
        if (!powerVal) continue;
        params.push({
          name: path,
          value: String(powerVal),
          type: def.type,
        });
        continue;
      }
    }

    return { success: true, params };
  }

  /**
   * Constrói o payload completo de ambas as bandas (2.4GHz + 5GHz).
   * Filtra bandas nulas (CPE sem 5GHz) e mescla os parâmetros.
   *
   * @param form2g FormGroup da banda 2.4GHz
   * @param form5g FormGroup da banda 5GHz (ou null se CPE não suporta)
   * @returns Resultado com payload mesclado ou erro
   */
  buildAllParams(form2g: FormGroup, form5g: FormGroup | null): BuildRadioParamsResult {
    const allParams: RadioParam[] = [];

    const result2g = this.buildBandParams(form2g);
    if (!result2g.success) {
      return { success: false, params: [], error: `2.4GHz: ${result2g.error}` };
    }
    allParams.push(...result2g.params);

    if (form5g) {
      const result5g = this.buildBandParams(form5g);
      if (!result5g.success) {
        return { success: false, params: [], error: `5GHz: ${result5g.error}` };
      }
      allParams.push(...result5g.params);
    }

    if (allParams.length === 0) {
      return { success: false, params: [], error: 'Nenhum parâmetro de rádio para enviar.' };
    }

    return { success: true, params: allParams };
  }
}
