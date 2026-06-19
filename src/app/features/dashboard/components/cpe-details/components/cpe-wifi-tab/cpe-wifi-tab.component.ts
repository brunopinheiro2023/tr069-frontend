import { Component, Input, OnInit, OnChanges, OnDestroy, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormGroup, FormArray, Validators } from '@angular/forms';
import { Subject } from 'rxjs';
import { takeUntil, debounceTime, filter } from 'rxjs/operators';
import { CpeService } from '../../../../../../core/services/cpe.service';
import { ToastService } from '../../../../../../core/services/toast.service';
import { WebSocketService } from '../../../../../../core/services/websocket.service';
import { ButtonComponent } from '../../../../../../core/components/button/button.component';
import { SkeletonComponent } from '../../../../../../core/components/skeleton/skeleton.component';
import { CpeDevice } from '../../../../../../core/models';
import { validateForm } from '../../../../../../core/validators/zod-validators';
import { parameterSchema } from '../../../../../../core/validators/schemas';
import { DynamicSsidConfig, mapTr069ToWifiConfigs } from './wifi-tr069-mapper';

@Component({
  selector: 'app-cpe-wifi-tab',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, ButtonComponent, SkeletonComponent],
  templateUrl: './cpe-wifi-tab.component.html',
  styleUrls: ['./cpe-wifi-tab.component.scss']
})
export class CpeWifiTabComponent implements OnInit, OnChanges, OnDestroy {
  @Input() cpe: CpeDevice | null = null;
  @Input() serialNumber: string = '';

  isApplyingWifi: boolean = false;
  wifiForm!: FormGroup;

  // Estado de coleta de configuração Wi-Fi
  isCollectingConfig: boolean = false;
  collectConfigError: boolean = false;
  collectConfigTimedOut: boolean = false;
  private collectTimeout?: ReturnType<typeof setTimeout>;
  private wsCollectSub?: any; // Subscription para cpe_updated durante coleta

  // OTIMIZAÇÃO UX (Micro-transações Simultâneas)
  private pendingChangesMap = new Map<string, any>();
  private batchSubject = new Subject<void>();
  pendingCount: number = 0;

  private monitorInterval: any;
  private lastSaveTimestamp: number = 0;
  private destroy$ = new Subject<void>();

  constructor(
    private fb: FormBuilder,
    private cpeService: CpeService,
    private toastService: ToastService,
    private wsService: WebSocketService,
  ) {}

  // Getters auxiliares para acesso rápido no template e classe
  get ssidsArray(): FormArray {
    return this.wifiForm.get('ssids') as FormArray;
  }

  get smartConnect(): boolean {
    return this.wifiForm.get('smartConnect')?.value || false;
  }

  // PREVENÇÃO DE MEMORY LEAK: Garante que o processo de contingência seja varrido da memória
  // caso o técnico troque de aba de forma abrupta antes do término do provisionamento da CPE.
  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    if (this.monitorInterval) {
      clearTimeout(this.monitorInterval);
    }
    if (this.collectTimeout) {
      clearTimeout(this.collectTimeout);
    }
    this.wsCollectSub?.unsubscribe();
  }

  /** Verifica se parametersCache contém pelo menos um parâmetro de nome de SSID. */
  private hasSsidData(): boolean {
    const cache = this.cpe?.parametersCache;
    if (!Array.isArray(cache) || cache.length === 0) return false;
    return cache.some(p =>
      /^Device\.WiFi\.SSID\.\d+\.SSID$/.test(p.name) ||
      /^InternetGatewayDevice\.LANDevice\.1\.WLANConfiguration\.\d+\.SSID$/.test(p.name)
    );
  }

  /**
   * Solicita ao backend a coleta de parâmetros de configuração Wi-Fi via GPV.
   * Depois escuta o WebSocket cpe_updated e força refetch do parametersCache.
   * Timeout de segurança de 60s caso a CPE não responda.
   */
  triggerWifiConfigCollection(): void {
    if (!this.serialNumber || this.isCollectingConfig) return;

    this.isCollectingConfig = true;
    this.collectConfigError = false;
    this.collectConfigTimedOut = false;

    this.cpeService.collectWifiConfig(this.serialNumber).subscribe({
      next: (res) => {
        if (res.status === 'cached') {
          // Backend confirmou que há dados frescos → refetch direto
          this.cpeService.clearCache(this.serialNumber);
          this.cpeService.getCpeDetails(this.serialNumber).subscribe({
            next: (freshCpe) => {
              this.cpe = freshCpe as any;
              this.isCollectingConfig = false;
              this.populateWifiForm();
            },
            error: () => { this.isCollectingConfig = false; this.collectConfigError = true; }
          });
          return;
        }

        // Backend retornou 202: coleta em andamento → escuta cpe_updated
        this.collectTimeout = setTimeout(() => {
          this.wsCollectSub?.unsubscribe();
          this.isCollectingConfig = false;
          this.collectConfigTimedOut = true;
          this.toastService.warning('Tempo limite atingido. A CPE pode estar offline.');
        }, 60000);

        this.wsCollectSub = this.wsService.onCpeUpdated().pipe(
          filter((ev: any) => ev.serialNumber === this.serialNumber),
          takeUntil(this.destroy$)
        ).subscribe(() => {
          clearTimeout(this.collectTimeout);
          this.wsCollectSub?.unsubscribe();
          // CPE respondeu → força refetch ignorando cache de 30s
          this.cpeService.clearCache(this.serialNumber);
          this.cpeService.getCpeDetails(this.serialNumber).subscribe({
            next: (freshCpe) => {
              this.cpe = freshCpe as any;
              this.isCollectingConfig = false;
              if (this.hasSsidData()) {
                this.populateWifiForm();
              } else {
                // CPE online, respondeu ao CR, mas sem SSIDs no cache ainda
                this.collectConfigError = true;
              }
            },
            error: () => { this.isCollectingConfig = false; this.collectConfigError = true; }
          });
        });
      },
      error: () => {
        this.isCollectingConfig = false;
        this.collectConfigError = true;
        this.toastService.error('Não foi possível iniciar a coleta de configuração Wi-Fi.');
      }
    });
  }

  ngOnInit(): void {
    this.wifiForm = this.fb.group({
      smartConnect: [false],
      ssids: this.fb.array([])
    });

    // Recuperação de tela travada contra ações de F5 acidentais
    const isProvisioning = sessionStorage.getItem(`vmoas_locked_${this.serialNumber}`);
    if (isProvisioning === 'true') {
        this.isApplyingWifi = true;
        this.startProvisioningMonitor();
    }

    if (this.hasSsidData()) {
      this.populateWifiForm();
    } else {
      this.triggerWifiConfigCollection();
    }

    // Inicializa o motor de Micro-Transações em Lote (Debounce de 2s)
    this.batchSubject.pipe(
      debounceTime(2000), // Aguarda o técnico terminar todos os cliques simultâneos
      filter(() => this.pendingChangesMap.size > 0 && !this.isApplyingWifi), // Protege contra colisões do TR-069
      takeUntil(this.destroy$)
    ).subscribe(() => {
      this.flushBatch();
    });
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

  populateWifiForm(): void {
    if (!this.cpe || !Array.isArray(this.cpe.parametersCache)) return;

    // Separação de responsabilidades (Sugestão 2): Parser TR-069 isolado
    const { configs, smartConnectEnabled } = mapTr069ToWifiConfigs(this.cpe.parametersCache);

    this.wifiForm.patchValue({ smartConnect: smartConnectEnabled }, { emitEvent: false });

    // Sincronização Não-Destrutiva (Sugestão 1)
    const currentControls = this.ssidsArray.controls as FormGroup[];

    configs.forEach(config => {
      const existingCtrl = currentControls.find(c => c.getRawValue().index === config.index);

      if (existingCtrl) {
        existingCtrl.patchValue(config, { emitEvent: false });

        const pwdCtrl = existingCtrl.get('password');
        if (config.securityMode === 'None') {
          if (pwdCtrl?.enabled) pwdCtrl.disable({ emitEvent: false });
        } else {
          if (pwdCtrl?.disabled) pwdCtrl.enable({ emitEvent: false });
        }
      } else {
        const group = this.fb.group({
          index: [config.index],
          name: [this.sanitizeSsidInput(config.name), [Validators.required, Validators.minLength(1), Validators.maxLength(32)]],
          password: [config.password],
          securityMode: [config.securityMode],
          enable: [{ value: config.enable, disabled: config.isLockedByHardware }],
          status: [config.status],
          isLockedByHardware: [config.isLockedByHardware],
          atf: [config.atf],
          muMimo: [config.muMimo],
          ofdma: [config.ofdma],
          band: [config.band],
          isPrimary: [config.isPrimary],
          guestId: [config.guestId],
          uiVisible: [config.uiVisible],
          isTR181: [config.isTR181],
          namePath: [config.namePath],
          passPath: [config.passPath],
          securityModePath: [config.securityModePath],
          enablePath: [config.enablePath],
          atfPath: [config.atfPath],
          muMimoPath: [config.muMimoPath],
          ofdmaPath: [config.ofdmaPath],
          accessPointEnablePath: [config.accessPointEnablePath]
        });

        // Prevenção de Memory Leak (Sugestão 3) no listener interno
        group.get('securityMode')?.valueChanges.pipe(
          takeUntil(this.destroy$)
        ).subscribe(mode => {
          const pwdCtrl = group.get('password');
          mode === 'None' ? pwdCtrl?.disable({ emitEvent: false }) : pwdCtrl?.enable({ emitEvent: false });
        });

        if (config.securityMode === 'None') group.get('password')?.disable({ emitEvent: false });

        this.ssidsArray.push(group, { emitEvent: false });
      }
    });

    // Limpeza de arrays obsoletos (caso de alteração massiva de firmware na mesma tela, raro, mas seguro)
    for (let i = currentControls.length - 1; i >= 0; i--) {
      const ctrlIdx = currentControls[i].getRawValue().index;
      if (!configs.find(c => c.index === ctrlIdx)) {
        this.ssidsArray.removeAt(i, { emitEvent: false });
      }
    }

    this.syncBandSteeringUi();
  }

  get visibleGuestsCount(): number {
    return this.ssidsArray.getRawValue().filter((s: any) => !s.isPrimary && s.uiVisible && s.band === '2.4GHz').length;
  }

  addGuestNetwork(): void {
    const ssids = this.ssidsArray.controls as FormGroup[];
    const availableSlot = [1, 2, 3].find(id => !ssids.some(s => s.getRawValue().guestId === id && s.getRawValue().uiVisible));
    if (availableSlot) {
      ssids.forEach(ssidCtrl => {
        if (ssidCtrl.getRawValue().guestId === availableSlot) {
          ssidCtrl.patchValue({
            uiVisible: true,
            enable: true,
            securityMode: 'WPA2',
            name: `Visitante_Nova_${availableSlot}`,
            password: ''
          });
        }
      });
      this.syncUiState();
    }
  }

  disableAllGuests(): void {
    let hasChanges = false;
    const ssids = this.ssidsArray.controls as FormGroup[];
    ssids.forEach(ssidCtrl => {
      const val = ssidCtrl.getRawValue();
      if (!val.isPrimary) {
        ssidCtrl.patchValue({
          uiVisible: false,
          enable: false,
          name: `Visitante_Auto_Reset_${val.index}`,
          password: ''
        });
        hasChanges = true;
      }
    });

    if (hasChanges) {
      this.syncUiState();
      alert('Redes de visitantes limpas na interface. Salve o card correspondente para sincronizar.');
    }
  }

  removeGuestNetwork(guestId: number): void {
    const ssids = this.ssidsArray.controls as FormGroup[];
    ssids.forEach(ssidCtrl => {
      const val = ssidCtrl.getRawValue();
      if (val.guestId === guestId) {
        ssidCtrl.patchValue({
          uiVisible: false,
          enable: false,
          name: `Visitante_Auto_Reset_${val.index}`,
          password: ''
        });
      }
    });
    this.syncUiState();
  }

  syncUiState(): void {
    setTimeout(() => this.syncBandSteeringUi(), 0);
  }

  syncBandSteeringUi(): void {
    const isSmartConnect = this.smartConnect;
    const ssids = this.ssidsArray.controls as FormGroup[];
    const masters2G = ssids.map(c => c.getRawValue()).filter(s => s.band === '2.4GHz');

    ssids.forEach(ssidCtrl => {
      const val = ssidCtrl.getRawValue();
      if (val.band === '5GHz') {
        const master = masters2G.find(m => m.guestId === val.guestId);
        if (master) {
          if (isSmartConnect) {
            ssidCtrl.patchValue({
              name: master.name,
              password: master.password,
              securityMode: master.securityMode,
              enable: master.enable,
              atf: master.atf,
              muMimo: master.muMimo,
              ofdma: master.ofdma
            }, { emitEvent: false });
          } else {
            if (val.name === master.name && val.name.trim() !== '') {
               if (!val.name.endsWith('_5G') && !val.name.endsWith('-5G')) {
                  ssidCtrl.patchValue({ name: `${master.name}_5G` }, { emitEvent: false });
               }
            }
          }
        }
      }
    });
  }

  // ====================================================================
  // MOTOR DE MICRO-TRANSAÇÕES (BATCHING & REAL-TIME)
  // Foco em UX: Permite configurações simultâneas sem travar a UI a cada clique.
  // ====================================================================

  private queueChange(param: any): void {
    this.pendingChangesMap.set(param.name, param);
    this.pendingCount = this.pendingChangesMap.size;
    this.optimisticUpdateLocalState([param]); // Atualiza o estado visual instantaneamente (Sem delay)
    this.batchSubject.next();
  }

  private flushBatch(): void {
    const payload = Array.from(this.pendingChangesMap.values());
    this.pendingChangesMap.clear();
    this.pendingCount = 0;
    this.toastService.info(`Sincronizando ${payload.length} alteração(ões) com a CPE...`);
    this.submitPayloadToNoc(payload);
  }

  /**
   * INTERCEPTOR IMEDIATO DE SWITCHES/TOGGLES
   */
  applyImmediateToggle(path: string, event: Event, type: string): void {
    const target = event.target as HTMLInputElement;
    this.queueChange({ name: path, value: target.checked ? 'true' : 'false', type: type });
  }

  /**
   * EXECUTA O PROVISIONAMENTO DO COMPONENTE GLOBAL DO SMART CONNECT
   */
  applySmartConnectToggle(event: Event): void {
    const target = event.target as HTMLInputElement;
    const isDeviceTR181 = this.ssidsArray.length > 0 && this.ssidsArray.at(0).getRawValue().isTR181;
    const scPath = isDeviceTR181 ? 'Device.WiFi.X_TP_BandSteering.Enable' : 'InternetGatewayDevice.LANDevice.1.X_TP_BandSteering';

    this.queueChange({ name: scPath, value: target.checked ? 'true' : 'false', type: 'xsd:boolean' });
  }

  /**
   * SALVAMENTO MODULAR E ISOLADO POR CARD
   */
  saveCard(index: number): void {
    const ssidCtrl = this.ssidsArray.at(index) as FormGroup;
    if (ssidCtrl.invalid) {
      this.toastService.error('Verifique o preenchimento de nome e senha.');
      return;
    }

    const ssid = ssidCtrl.getRawValue(); // Recupera valores inclusive se estiverem disabled
    const pwd = ssid.password || '';
    if (ssid.securityMode !== 'None' && (pwd.length < 8 || pwd.length > 63)) {
      this.toastService.error('Senha Wi-Fi deve ter entre 8 e 63 caracteres.');
      return;
    }

    const cardParams: any[] = [];

    this.syncBandSteeringUi();
    const syncedSsid = this.ssidsArray.at(index).getRawValue();

    cardParams.push({ name: syncedSsid.namePath, value: syncedSsid.name, type: 'xsd:string' });

    let cpeSecVal = 'WPA2-Personal';
    if (syncedSsid.isTR181) {
      if (syncedSsid.securityMode === 'None') cpeSecVal = 'None';
      else if (syncedSsid.securityMode === 'WPA2-WPA3') cpeSecVal = 'WPA2-WPA3-Personal';
    } else {
      cpeSecVal = '11i';
      if (syncedSsid.securityMode === 'None') cpeSecVal = 'None';
    }
    cardParams.push({ name: syncedSsid.securityModePath, value: cpeSecVal, type: 'xsd:string' });

    if (pwd !== '' && syncedSsid.securityMode !== 'None') {
      cardParams.push({ name: syncedSsid.passPath, value: pwd, type: 'xsd:string' });
    }

    cardParams.forEach(p => this.queueChange(p));
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
        this.rollbackLocalState(true);
        return;
      }
    }

    this.isApplyingWifi = true; // Trava as alterações visuais de provisionamento (skeleton/spinner)

    this.cpeService.queueConfig(this.serialNumber, payload).subscribe({
      next: () => {
        this.lastSaveTimestamp = Date.now();

        // Invalida cache SSID local para evitar exibir SSID antigo por 30s
        this.invalidateSsidCache(payload);

        sessionStorage.setItem(`vmoas_locked_${this.serialNumber}`, 'true');
        this.startProvisioningMonitor();
      },
      error: () => {
        this.toastService.error('Falha ao registrar micro-transação de rede.');
        this.unlockScreenAndFinish();
        this.rollbackLocalState(true);
      }
    });
  }

  private optimisticUpdateLocalState(queuedParams: any[]): void {
    if (!this.cpe || !Array.isArray(this.cpe.parametersCache)) return;
    const params = this.cpe.parametersCache;
    queuedParams.forEach(newParam => {
      const existingParam = params.find((p: any) => p.name === newParam.name);
      if (existingParam) existingParam.value = String(newParam.value);
      else params.push({ name: newParam.name, value: String(newParam.value) });
    });
  }

  /**
   * Invalida cache SSID local para evitar exibir SSID antigo por 30s após mudança.
   * Remove parâmetros SSID alterados do cache local para forçar refresh imediato.
   */
  private invalidateSsidCache(payload: any[]): void {
    if (!this.cpe || !Array.isArray(this.cpe.parametersCache)) return;

    const ssidPaths = payload.filter((p: any) =>
      p.name.includes('SSID') || p.name.includes('PreSharedKey') || p.name.includes('KeyPassphrase')
    );

    ssidPaths.forEach((p: any) => {
      const idx = this.cpe?.parametersCache?.findIndex((param: any) => param.name === p.name) ?? -1;
      if (idx !== -1) {
        this.cpe?.parametersCache?.splice(idx, 1);
      }
    });
  }

  private startProvisioningMonitor(): void {
    // Altera clearInterval para clearTimeout
    if (this.monitorInterval) clearTimeout(this.monitorInterval);

    // ARQUITETURA HÍBRIDA CORRIGIDA: O HTTP Polling via setInterval foi sumariamente removido.
    // O sistema utiliza a topologia de WebSockets nativa (CpeDetails escuta 'cpe_updated' e repassa via ngOnChanges).
    // Este setTimeout funciona APENAS como um fallback de segurança (Safety Net) caso o ACS ou WS percam o pacote.
    this.monitorInterval = setTimeout(() => {
        if (this.isApplyingWifi) {
            this.toastService.warning('[Timeout] A CPE executou a gravação assíncrona, mas a resposta em tempo real excedeu o limite de segurança.');
            this.unlockScreenAndFinish();
            // ROLLBACK ASSÍNCRONO: Força busca no banco de dados como último recurso apenas se o WS não retornou
            this.rollbackLocalState(true);
        }
    }, 45000);
  }

  /**
   * ROLLBACK DE ESTADO (REVERSÃO SEGURA)
   * Garante que a interface retorne ao estado original se a API falhar.
   */
  private rollbackLocalState(fetchFromDb: boolean = false): void {
    if (fetchFromDb) {
      // Em caso de timeout, a atualização otimista já corrompeu o estado local.
      // Precisamos buscar a "verdade absoluta" no banco de dados da API via HTTP.
      this.cpeService.getCpeDetails(this.serialNumber).subscribe({
        next: (freshData: any) => {
          this.cpe = freshData;
          this.populateWifiForm();
        }
      });
    } else {
      // Em falhas imediatas (HTTP 4xx/5xx), a variável this.cpe continua com os valores originais.
      // Basta reconstruir o Reactive Form a partir dela sem necessidade de requisição HTTP extra.
      this.populateWifiForm();
    }
  }

  /**
   * Sanitiza SSID antes de popular o formulário (defesa em profundidade).
   * Remove caracteres de controle e tags HTML para evitar reenviar payload malicioso
   * de volta à CPE via SPV. Angular já protege contra XSS na exibição via interpolation.
   */
  private sanitizeSsidInput(value: string): string {
    if (!value || typeof value !== 'string') return '';
    return value.replace(/[<>]/g, '').slice(0, 32); // SSID TR-069 tem limite de 32 chars
  }

  private unlockScreenAndFinish(): void {
    this.isApplyingWifi = false;
    sessionStorage.removeItem(`vmoas_locked_${this.serialNumber}`);
    // Altera clearInterval para clearTimeout
    if (this.monitorInterval) clearTimeout(this.monitorInterval);

    // Se o usuário realizou operações enquanto o spinner rodava, as mudanças não foram perdidas. Serão despachadas agora.
    if (this.pendingChangesMap.size > 0) {
      this.batchSubject.next();
    }
  }
}
