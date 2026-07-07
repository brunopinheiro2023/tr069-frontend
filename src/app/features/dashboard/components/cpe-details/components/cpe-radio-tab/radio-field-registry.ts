/**
 * Registry centralizado de campos de Rádio Wi-Fi — fonte única de verdade tabular.
 *
 * Substitui a duplicação de definições espalhadas entre mapper, builder e component.
 * Adicionar um novo parâmetro de rádio = adicionar 1 entrada neste array +
 * 1 campo no RadioBandConfig + 1 input no HTML do band-card.
 *
 * Cada entrada define:
 *   - formField: campo do FormGroup que guarda o VALOR
 *   - pathField: campo do FormGroup que guarda o PATH TR-069
 *   - type:      tipo SPV (xsd:string | xsd:boolean | xsd:unsignedInt)
 *   - category:  comportamento do campo (ver RadioFieldCategory)
 *
 * Nota: os paths TR-069 são construídos pelo radio-path-builder.ts (fonte única
 * de verdade para paths). Este registry define apenas o comportamento de envio SPV.
 */

export type RadioFieldCategory =
  | 'basic'           // sempre enviado (Enable, Channel)
  | 'bandwidth'       // largura de banda com conversão TR-098 (adiciona sufixo MHz)
  | 'power'           // potência de transmissão
  | 'auto-channel';   // AutoChannelEnable — derivado do valor de Channel

export interface RadioFieldDef {
  /** Campo do form que guarda o valor */
  formField: string;
  /** Campo do form que guarda o path TR-069 */
  pathField: string;
  /** Tipo do parâmetro SPV */
  type: 'xsd:string' | 'xsd:boolean' | 'xsd:int' | 'xsd:unsignedInt';
  /** Comportamento do campo */
  category: RadioFieldCategory;
}

/**
 * Registry de todos os campos de rádio.
 *
 * CAMPOS BÁSICOS (sempre enviados):
 *   enable, channel
 *
 * CAMPOS COM CONVERSÃO:
 *   bandwidth — TR-098 (Intelbras) usa "20MHz" em vez de "20"
 *
 * CAMPOS DERIVADOS:
 *   auto-channel — AutoChannelEnable = true quando Channel === 'Auto'
 *
 * CAMPOS DE POTÊNCIA:
 *   power — TransmitPower (dBm em TR-181, percentual em TR-098)
 */
export const RADIO_FIELD_REGISTRY: readonly RadioFieldDef[] = [
  {
    formField: 'enable',
    pathField: 'enablePath',
    type: 'xsd:boolean',
    category: 'basic',
  },
  {
    formField: 'channel',
    pathField: 'channelPath',
    type: 'xsd:unsignedInt',
    category: 'basic',
  },
  {
    formField: 'bandwidth',
    pathField: 'bandwidthPath',
    type: 'xsd:string',
    category: 'bandwidth',
  },
  {
    formField: 'power',
    pathField: 'powerPath',
    type: 'xsd:int',
    category: 'power',
  },
  {
    // AutoChannelEnable — derivado do campo 'channel': true quando Channel === 'Auto'
    // formField aponta para 'channel' (campo fonte da derivação), não é lido diretamente
    formField: 'channel',
    pathField: 'autoChannelPath',
    type: 'xsd:boolean',
    category: 'auto-channel',
  },
];
