import { Injectable } from '@angular/core';
import { FormGroup } from '@angular/forms';
import { resolveGuestId } from './wifi-ap-pairing';
import { getMirrorFields } from './wifi-field-registry';

@Injectable({ providedIn: 'root' })
export class WifiBandSteeringService {
  /**
   * Sincroniza configuração de Band Steering (Smart Connect) entre SSIDs 2.4GHz e 5GHz
   * @param ssids FormArray de SSIDs (como FormGroup[])
   * @param isSmartConnect Estado do Smart Connect
   * @param forceState Estado forçado (opcional, usado para ativação manual)
   * @param targetGuestId ID do guest alvo (opcional, para sincronizar apenas SSIDs específicos)
   */
  sync(ssids: FormGroup[], isSmartConnect: boolean, forceState?: boolean, targetGuestId?: number): void {
    const actualSmartConnect = forceState !== undefined ? forceState : isSmartConnect;
    const masters2G = ssids.map(c => c.getRawValue()).filter(s => s.band === '2.4GHz');

    // Otimização: só processa se houver SSIDs 5GHz e masters 2.4GHz
    if (masters2G.length === 0) return;

    ssids.forEach(ssidCtrl => {
      const val = ssidCtrl.getRawValue();

      // Se targetGuestId foi fornecido, processa apenas SSIDs desse guestId.
      // Nota: targetGuestId deve ser o guestId RESOLVIDO (via resolveGuestId) do AP source,
      // não o guestId bruto. Isso garante que guestId=99 seja resolvido corretamente
      // via GUEST_ID_FALLBACK antes de comparar.
      if (targetGuestId !== undefined && resolveGuestId(val) !== targetGuestId) return;

      if (val.band === '5GHz') {
        // Pareamento por guestId resolvido (resolveGuestId usa GUEST_ID_FALLBACK
        // quando guestId=99, mapeando índice+banda → guestId lógico).
        // Antes o fallback era por índice, mas índices 2.4GHz≠5GHz → nunca encontrava.
        const valGuestId = resolveGuestId(val);
        let master = masters2G.find(m => resolveGuestId(m) === valGuestId);

        if (master) {
          if (actualSmartConnect) {
            // IMPORTANTE: Quando forceState é fornecido (ativação manual), SEMPRE atualiza
            // para garantir que o espelhamento aconteça mesmo que os valores pareçam iguais.
            // A otimização só se aplica quando forceState não é fornecido (atualização via WebSocket).
            // Aplica tanto para SSIDs Primary quanto para redes visitantes (ambos usam guestId para pareamento)
            // Campos espelhados derivados do registry (getMirrorFields) — não precisa manter lista hardcoded.
            const mirrorFields = getMirrorFields();
            const shouldUpdate = forceState !== undefined ||
              mirrorFields.some(f => ssidCtrl.get(f.formField)?.value !== (master as any)[f.formField]);

            if (shouldUpdate) {
              const patchObj: Record<string, any> = {};
              for (const f of mirrorFields) {
                patchObj[f.formField] = (master as any)[f.formField];
              }
              ssidCtrl.patchValue(patchObj, { emitEvent: false });

              // CRÍTICO: habilita/desabilita o campo password baseado no securityMode
              // espelhado. Sem isso, se o 5GHz tinha securityMode='None' (password
              // desabilitado) e o bandSteering.sync espelha securityMode='WPA2', o
              // campo password permanece desabilitado. O buildAllParams usa
              // getRawValue() (que inclui campos desabilitados), mas o .value do
              // FormGroup exclui — causando comportamento inconsistente.
              const pwdCtrl = ssidCtrl.get('password');
              if (master.securityMode === 'None') {
                if (pwdCtrl?.enabled) pwdCtrl.disable({ emitEvent: false });
              } else {
                if (pwdCtrl?.disabled) pwdCtrl.enable({ emitEvent: false });
              }
            }
          } else {
            // Smart Connect desativado: adiciona sufixo _5G ao nome se ainda não tiver
            const currentName = ssidCtrl.get('name')?.value || '';
            if (!currentName.endsWith('_5G')) {
              const newName = currentName ? `${currentName}_5G` : `SSID_5G_${val.index}`;
              ssidCtrl.patchValue({ name: newName }, { emitEvent: false });
            }
          }
        }
      }
    });
  }
}
