import { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';
import { RADIO_CONSTANTS } from './radio-constants';

/**
 * Validator para canal de rádio Wi-Fi.
 * - Permite 'Auto' (canal automático gerenciado pela CPE)
 * - Permite vazio (campo não alterado)
 * - 2.4GHz: canais 1-13
 * - 5GHz: canais 36-165 (sem DFS — apenas UNII-1 e UNII-3)
 *
 * @param band '2.4GHz' | '5GHz'
 */
export function channelValidator(band: '2.4GHz' | '5GHz'): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    const val = control.value;
    // Vazio ou 'Auto' são válidos — Auto significa AutoChannelEnable=true
    if (!val || val === RADIO_CONSTANTS.AUTO_CHANNEL) return null;

    const num = Number(val);
    if (isNaN(num)) return { invalidChannel: { reason: 'Canal deve ser numérico ou "Auto".' } };

    if (band === '2.4GHz') {
      if (num < 1 || num > 13) {
        return { invalidChannel: { reason: 'Canal 2.4GHz deve estar entre 1 e 13.' } };
      }
    } else {
      // 5GHz — valida contra lista de canais sem DFS
      const allowed = RADIO_CONSTANTS.CHANNELS_5G;
      if (!(allowed as readonly number[]).includes(num)) {
        return { invalidChannel: { reason: `Canal 5GHz deve ser um de: ${allowed.join(', ')}.` } };
      }
    }
    return null;
  };
}

/**
 * Validator para potência de transmissão.
 * - Permite vazio (campo não alterado)
 * - TR-181 e TR-098: percentual 0-100
 *   (TR-181 spec define xsd:int -1:100; -1 = auto, mas UI só expõe TransmitPowerSupported)
 */
export function powerValidator(): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    const val = control.value;
    if (val === null || val === undefined || val === '') return null;

    const num = Number(val);
    if (isNaN(num) || num < 0) {
      return { invalidPower: { reason: 'Potência deve ser número não-negativo (%).' } };
    }
    if (num > 100) {
      return { invalidPower: { reason: 'Potência máxima: 100%.' } };
    }
    return null;
  };
}

/**
 * Validator para largura de banda.
 * - Permite vazio (campo não alterado)
 * - 2.4GHz: 20 ou 40
 * - 5GHz: 20, 40, 80 ou 160
 *
 * @param band '2.4GHz' | '5GHz'
 */
export function bandwidthValidator(band: '2.4GHz' | '5GHz'): ValidatorFn {
  const allowed = band === '2.4GHz' ? RADIO_CONSTANTS.BANDWIDTH_2G : RADIO_CONSTANTS.BANDWIDTH_5G;
  return (control: AbstractControl): ValidationErrors | null => {
    const val = control.value;
    if (!val) return null;
    if (!(allowed as readonly string[]).includes(val)) {
      return { invalidBandwidth: { reason: `Largura deve ser: ${allowed.join(', ')} MHz.` } };
    }
    return null;
  };
}
