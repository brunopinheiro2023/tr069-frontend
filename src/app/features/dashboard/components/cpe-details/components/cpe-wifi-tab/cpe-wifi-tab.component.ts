import { Component, Input, OnInit, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CpeService } from '../../../../../../core/services/cpe.service';
import { ToastService } from '../../../../../../core/services/toast.service';
import { ButtonComponent } from '../../../../../../core/components/button/button.component';
import { SkeletonComponent } from '../../../../../../core/components/skeleton/skeleton.component';
import { CpeDevice } from '../../../../../../core/models';
import { validateForm } from '../../../../../../core/validators/zod-validators';
import { parameterSchema } from '../../../../../../core/validators/schemas';

interface DynamicSsidConfig {
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

@Component({
  selector: 'app-cpe-wifi-tab',
  standalone: true,
  imports: [CommonModule, FormsModule, ButtonComponent, SkeletonComponent],
  templateUrl: './cpe-wifi-tab.component.html',
  styleUrls: ['./cpe-wifi-tab.component.scss']
})
export class CpeWifiTabComponent implements OnInit, OnChanges {
  @Input() cpe: CpeDevice | null = null;
  @Input() serialNumber: string = '';

  smartConnect: boolean = false;
  isApplyingWifi: boolean = false;
  discoveredSsids: DynamicSsidConfig[] = [];

  private monitorInterval: any;
  private lastSaveTimestamp: number = 0;

  constructor(
    private cpeService: CpeService,
    private toastService: ToastService,
  ) {}

  ngOnInit(): void {
    // Recuperação de tela travada contra ações de F5 acidentais
    const isProvisioning = sessionStorage.getItem(`vmoas_locked_${this.serialNumber}`);
    if (isProvisioning === 'true') {
        this.isApplyingWifi = true;
        this.startProvisioningMonitor();
    }
    this.populateWifiForm();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['cpe'] && !changes['cpe'].firstChange) {
      const updatedCpe = changes['cpe'].currentValue;

      // Destrava a tela quando o Polling comprovar que a tarefa saiu da fila e o banco foi atualizado
      if (this.isApplyingWifi) {
          if (!updatedCpe.pendingTasks || updatedCpe.pendingTasks.length === 0) {
              this.unlockScreenAndFinish();
          } else {
              return;
          }
      }
      this.populateWifiForm();
    }
  }

  private getParamValue(paramName: string): string {
    if (!this.cpe || !Array.isArray(this.cpe.parameters)) return '';
    const param = this.cpe.parameters.find((p: any) => p.name === paramName || p.name.endsWith(paramName));
    return param ? String(param.value) : '';
  }

  private parseBoolean(value: any): boolean {
    if (value === undefined || value === null || value === '') return false;
    const strVal = String(value).trim().toLowerCase();
    return strVal === '1' || strVal === 'true';
  }

  private classifySsidByHardware(idx: string, alias: string, apType: string, isTR181: boolean): { band: '2.4GHz' | '5GHz', isPrimary: boolean, guestId: number, isHidden: boolean } {
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

  populateWifiForm(): void {
    if (!this.cpe) return;
    this.discoveredSsids = [];

    const paramsArray = Array.isArray(this.cpe.parameters) ? this.cpe.parameters : [];
    const hasData = paramsArray.length > 0;
    const isDeviceTR181 = hasData && paramsArray.some((p: any) => p.name.startsWith('Device.'));

    const scPath = isDeviceTR181 ? 'Device.WiFi.X_TP_BandSteering.Enable' : 'InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.X_TP_BandSteering';
    this.smartConnect = this.parseBoolean(this.getParamValue(scPath));

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
            const alias = this.getParamValue(`Device.WiFi.AccessPoint.${idx}.Alias`);
            const apType = this.getParamValue(`Device.WiFi.AccessPoint.${idx}.X_TP_APType`);
            const topology = this.classifySsidByHardware(idx, alias, apType, isNodeTR181);

            if (topology.isHidden) return;

            const namePath = param.name;
            const enablePath = isNodeTR181 ? `Device.WiFi.SSID.${idx}.Enable` : `InternetGatewayDevice.LANDevice.1.WLANConfiguration.${idx}.Enable`;
            const apEnablePath = isNodeTR181 ? `Device.WiFi.AccessPoint.${idx}.Enable` : undefined;
            const statusPath = isNodeTR181 ? `Device.WiFi.AccessPoint.${idx}.Status` : `InternetGatewayDevice.LANDevice.1.WLANConfiguration.${idx}.Status`;

            const securityModePath = isNodeTR181 ? `Device.WiFi.AccessPoint.${idx}.Security.ModeEnabled` : `InternetGatewayDevice.LANDevice.1.WLANConfiguration.${idx}.BeaconType`;
            const rawSec = this.getParamValue(securityModePath);
            let uiSecurityMode: 'None' | 'WPA2' | 'WPA2-WPA3' = 'WPA2';
            if (rawSec.includes('None') || rawSec === 'Basic') uiSecurityMode = 'None';
            else if (rawSec.includes('WPA3')) uiSecurityMode = 'WPA2-WPA3';

            let adminEnable = false;
            if (isNodeTR181 && apEnablePath) {
                const apVal = this.getParamValue(apEnablePath);
                adminEnable = apVal !== '' ? this.parseBoolean(apVal) : this.parseBoolean(this.getParamValue(enablePath));
            } else {
                adminEnable = this.parseBoolean(this.getParamValue(enablePath));
            }

            const rawStatus = this.getParamValue(statusPath);
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

            const passPath = `Device.WiFi.AccessPoint.${idx}.Security.KeyPassphrase`;
            const muMimoPath = `Device.WiFi.AccessPoint.${idx}.MUMIMOEnable`;
            const ofdmaPath = `Device.WiFi.AccessPoint.${idx}.OFDMAEnable`;
            const atfPath = this.getParamValue(`Device.WiFi.AccessPoint.${idx}.ATFEnable`) !== '' ? `Device.WiFi.AccessPoint.${idx}.ATFEnable` : `Device.WiFi.SSID.${idx}.ATFEnable`;
            const ssidName = param.value || '';
            const isDefaultGhost = ssidName.includes('Auto_Reset') || ssidName.includes('TP-Link');

            this.discoveredSsids.push({
              index: idx,
              name: ssidName,
              password: this.getParamValue(passPath),
              securityMode: uiSecurityMode,
              enable: finalEnable,
              status: statusVal,
              isLockedByHardware: hardwareLock,
              atf: this.parseBoolean(this.getParamValue(atfPath)),
              muMimo: this.parseBoolean(this.getParamValue(muMimoPath)),
              ofdma: this.parseBoolean(this.getParamValue(ofdmaPath)),
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

      this.discoveredSsids.sort((a, b) => parseInt(a.index, 10) - parseInt(b.index, 10));
    }
    this.syncBandSteeringUi();
  }

  get visibleGuestsCount(): number {
    return this.discoveredSsids.filter(s => !s.isPrimary && s.uiVisible && s.band === '2.4GHz').length;
  }

  addGuestNetwork(): void {
    const availableSlot = [1, 2, 3].find(id => !this.discoveredSsids.some(s => s.guestId === id && s.uiVisible));
    if (availableSlot) {
      this.discoveredSsids.forEach(ssid => {
        if (ssid.guestId === availableSlot) {
          ssid.uiVisible = true;
          ssid.enable = true;
          ssid.securityMode = 'WPA2';
          ssid.name = `Visitante_Nova_${availableSlot}`;
          ssid.password = '';
        }
      });
      this.syncUiState();
    }
  }

  disableAllGuests(): void {
    let hasChanges = false;
    this.discoveredSsids.forEach(ssid => {
      if (!ssid.isPrimary) {
        ssid.uiVisible = false;
        ssid.enable = false;
        ssid.name = `Visitante_Auto_Reset_${ssid.index}`;
        ssid.password = '';
        hasChanges = true;
      }
    });

    if (hasChanges) {
      this.syncUiState();
      alert('Redes de visitantes limpas na interface. Salve o card correspondente para sincronizar.');
    }
  }

  removeGuestNetwork(guestId: number): void {
    this.discoveredSsids.forEach(ssid => {
      if (ssid.guestId === guestId) {
        ssid.uiVisible = false;
        ssid.enable = false;
        ssid.name = `Visitante_Auto_Reset_${ssid.index}`;
        ssid.password = '';
      }
    });
    this.syncUiState();
  }

  syncUiState(): void {
    setTimeout(() => this.syncBandSteeringUi(), 0);
  }

  syncBandSteeringUi(): void {
    const masters2G = this.discoveredSsids.filter(s => s.band === '2.4GHz');

    if (this.smartConnect) {
      this.discoveredSsids.forEach(ssid => {
        if (ssid.band === '5GHz') {
          const master = masters2G.find(m => m.guestId === ssid.guestId);
          if (master) {
            ssid.name = master.name;
            ssid.password = master.password;
            ssid.securityMode = master.securityMode;
            ssid.enable = master.enable;
            ssid.atf = master.atf;
            ssid.muMimo = master.muMimo;
            ssid.ofdma = master.ofdma;
          }
        }
      });
    } else {
      this.discoveredSsids.forEach(ssid => {
        if (ssid.band === '5GHz') {
          const master = masters2G.find(m => m.guestId === ssid.guestId);
          if (master && ssid.name === master.name && ssid.name.trim() !== '') {
             if (!ssid.name.endsWith('_5G') && !ssid.name.endsWith('-5G')) {
                ssid.name = `${master.name}_5G`;
             }
          }
        }
      });
    }
  }

  // ====================================================================
  // NOVO MOTOR DE MICRO-TRANSAÇÕES (REAL-TIME DASHBOARD)
  // ====================================================================

  /**
   * INTERCEPTOR IMEDIATO DE SWITCHES/TOGGLES
   * Salva e sincroniza o parâmetro isolado no momento exato do clique.
   */
  applyImmediateToggle(path: string, value: any, type: string): void {
    this.isApplyingWifi = true;
    const singleParam = [{ name: path, value: String(value), type: type }];
    this.submitPayloadToNoc(singleParam);
  }

  /**
   * EXECUTA O PROVISIONAMENTO DO COMPONENTE GLOBAL DO SMART CONNECT
   * Regra restrita: Envia unicamente o parâmetro de BandSteering.
   */
  applySmartConnectToggle(): void {
    this.isApplyingWifi = true;
    const isDeviceTR181 = this.discoveredSsids.length > 0 && this.discoveredSsids[0].isTR181;
    const scPath = isDeviceTR181 ? 'Device.WiFi.X_TP_BandSteering.Enable' : 'InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.X_TP_BandSteering';

    const singleParam = [{ name: scPath, value: this.smartConnect ? 'true' : 'false', type: 'xsd:boolean' }];
    this.submitPayloadToNoc(singleParam);
  }

  /**
   * SALVAMENTO MODULAR E ISOLADO POR CARD
   * Consolda as modificações de SSID, Criptografia e Senha pertencentes apenas ao bloco clicado.
   */
  saveCard(ssid: DynamicSsidConfig): void {
    // Validação Zod: SSID e senha Wi-Fi
    if (ssid.name.length < 1 || ssid.name.length > 32) {
      this.toastService.error('SSID deve ter entre 1 e 32 caracteres.');
      return;
    }
    if (ssid.securityMode !== 'None' && (ssid.password.length < 8 || ssid.password.length > 63)) {
      this.toastService.error('Senha Wi-Fi deve ter entre 8 e 63 caracteres.');
      return;
    }

    this.isApplyingWifi = true;
    const cardParams: any[] = [];

    // Alinha os prefixos das bandas antes de gerar o payload de gravação
    this.syncBandSteeringUi();

    // Adiciona o Nome do SSID
    cardParams.push({ name: ssid.namePath, value: ssid.name, type: 'xsd:string' });

    // Adiciona o modo de criptografia traduzido para o modelo nativo da CPE
    let cpeSecVal = 'WPA2-Personal';
    if (ssid.isTR181) {
      if (ssid.securityMode === 'None') cpeSecVal = 'None';
      else if (ssid.securityMode === 'WPA2-WPA3') cpeSecVal = 'WPA2-WPA3-Personal';
    } else {
      cpeSecVal = '11i';
      if (ssid.securityMode === 'None') cpeSecVal = 'None';
    }
    cardParams.push({ name: ssid.securityModePath, value: cpeSecVal, type: 'xsd:string' });

    // Adiciona a senha se a segurança não for do tipo Aberta
    if (ssid.password !== undefined && ssid.password !== '' && ssid.securityMode !== 'None') {
      cardParams.push({ name: ssid.passPath, value: ssid.password, type: 'xsd:string' });
    }

    // Se o Smart Connect estiver ativo e este for o rádio mestre 2.4G (Index 1),
    // o frontend omite o payload do 5G, deixando o hardware clonar sozinho.
    this.submitPayloadToNoc(cardParams);
  }

  /**
   * TRANSMISSOR DE SUBMISSÃO E TRAVA DE OPERAÇÃO
   * Valida os parâmetros TR-069 com Zod antes de enviar à API.
   */
  private submitPayloadToNoc(payload: any[]): void {
    // Validação Zod: cada parâmetro deve ter name e value válidos
    for (const p of payload) {
      const result = parameterSchema.safeParse(p);
      if (!result.success) {
        this.toastService.error(`Parâmetro inválido: ${p.name || 'desconhecido'}`);
        this.isApplyingWifi = false;
        return;
      }
    }

    this.cpeService.queueConfig(this.serialNumber, payload).subscribe({
      next: () => {
        this.optimisticUpdateLocalState(payload);
        this.lastSaveTimestamp = Date.now();

        // Ativa a barreira física visual contra F5 e cliques múltiplos simultâneos
        sessionStorage.setItem(`vmoas_locked_${this.serialNumber}`, 'true');
        this.startProvisioningMonitor();
      },
      error: () => {
        this.toastService.error('Falha ao registrar micro-transação de rede.');
        this.unlockScreenAndFinish();
      }
    });
  }

  private optimisticUpdateLocalState(queuedParams: any[]): void {
    if (!this.cpe || !Array.isArray(this.cpe.parameters)) return;
    const params = this.cpe.parameters; // guarda referência para satisfazer o TypeScript
    queuedParams.forEach(newParam => {
      const existingParam = params.find((p: any) => p.name === newParam.name);
      if (existingParam) existingParam.value = String(newParam.value);
      else params.push({ name: newParam.name, value: String(newParam.value) });
    });
  }

  private startProvisioningMonitor(): void {
    if (this.monitorInterval) clearInterval(this.monitorInterval);

    setTimeout(() => {
        if (this.isApplyingWifi) {
            this.toastService.warning('[Timeout] A CPE executou a gravação assíncrona, mas a leitura de rede excedeu o limite de segurança.');
            this.unlockScreenAndFinish();
        }
    }, 45000);

    // Polling ativo de consistência com CACHE-BUSTER (Anti-F5 Fantasma)
    this.monitorInterval = setInterval(() => {

        // A MÁGICA: O ?_t=getTime() impede que o Google Chrome minta com dados cacheados!
        const cacheBusterParam = `${this.serialNumber}?_t=${new Date().getTime()}`;

        this.cpeService.getCpeDetails(cacheBusterParam).subscribe({
            next: (freshData: any) => {
                // Se a fila realmente esvaziou no Node.js
                if (!freshData.pendingTasks || freshData.pendingTasks.length === 0) {
                    this.cpe = freshData;
                    this.populateWifiForm();
                    this.unlockScreenAndFinish();
                }
            }
        });
    }, 3000);
  }

  private unlockScreenAndFinish(): void {
    this.isApplyingWifi = false;
    sessionStorage.removeItem(`vmoas_locked_${this.serialNumber}`);
    if (this.monitorInterval) clearInterval(this.monitorInterval);
  }
}
