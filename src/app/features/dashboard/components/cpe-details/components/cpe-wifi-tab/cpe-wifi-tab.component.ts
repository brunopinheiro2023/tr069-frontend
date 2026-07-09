import { Component, Input, OnInit, OnChanges, OnDestroy, SimpleChanges, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormGroup, FormArray } from '@angular/forms';
import { Subject, Subscription } from 'rxjs';
import { takeUntil, filter } from 'rxjs/operators';
import { CpeService } from '../../../../../../core/services/cpe.service';
import { ToastService } from '../../../../../../core/services/toast.service';
import { WebSocketService } from '../../../../../../core/services/websocket.service';
import { CapabilityService } from '../../../../../../core/services/capability.service';
import { WifiParameterBuilderService } from './wifi-parameter-builder.service';
import { WifiBandSteeringService } from './wifi-band-steering.service';
import { WifiBatchQueueService } from './wifi-batch-queue.service';
import { sanitizeSsidName, sanitizeSsidInput } from './wifi-sanitizer';
import { findCorrelatedAp, sortApsByGuestAndBand, resolveGuestId, areCorrelatedAps, PairableAp } from './wifi-ap-pairing';

import { ButtonComponent } from '../../../../../../core/components/button/button.component';
import { SkeletonComponent } from '../../../../../../core/components/skeleton/skeleton.component';
import { TabLoaderComponent } from '../../../../../../core/components/tab-loader/tab-loader.component';
import { IconTooltipComponent } from '../../../../../../core/components/icon-tooltip/icon-tooltip.component';
import { HelpToggleComponent } from '../../../../../../core/components/help-toggle/help-toggle.component';
import { WifiSsidCardComponent } from './wifi-ssid-card/wifi-ssid-card.component';
import { CpeDevice, DynamicSsidConfig } from '../../../../../../core/models';
import { validateForm } from '../../../../../../core/validators/zod-validators';
import { parameterSchema } from '../../../../../../core/validators/schemas';
import { mapTr069ToWifiConfigs } from './wifi-tr069-mapper';
import { WIFI_CONSTANTS } from './wifi-constants';
import { ssidValidator, passwordValidator, securityWithPasswordValidator, generateSecurePassword, generateUniqueGuestName, uniqueSsidNamesValidator, trafficControlValueValidator } from './wifi-validators';
import { getBandSteeringPath } from './wifi-path-builder';
import { getTogglePathToFieldMap } from './wifi-field-registry';

@Component({
  selector: 'app-cpe-wifi-tab',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, ReactiveFormsModule, ButtonComponent, SkeletonComponent, TabLoaderComponent, IconTooltipComponent, HelpToggleComponent, WifiSsidCardComponent],
  providers: [WifiBatchQueueService],
  templateUrl: './cpe-wifi-tab.component.html',
  styleUrls: ['./cpe-wifi-tab.component.scss']
})
export class CpeWifiTabComponent implements OnInit, OnChanges, OnDestroy {
  @Input() cpe: CpeDevice | null = null;
  @Input() serialNumber: string = '';
  /** CPE está offline — bloqueia apply de config Wi-Fi. */
  @Input() isCpeOffline: boolean = false;
  /** LOCK-1: Usuário em modo somente leitura (outro técnico é Driver). */
  @Input() isViewOnly: boolean = false;
  /** LOCK-1: CPE em tráfego CWMP ativo — botões bloqueados temporariamente. */
  @Input() isCpeBusy: boolean = false;

  isApplyingWifi: boolean = false;
  wifiForm!: FormGroup;

  // Estado de coleta de configuração Wi-Fi
  isCollectingConfig: boolean = false;
  collectConfigError: boolean = false;
  collectConfigTimedOut: boolean = false;
  collectProgress = 0; // 0-100 para barra de progresso
  collectStage = 'iniciando'; // iniciando | contactando | coletando | finalizando
  private collectTimeout?: ReturnType<typeof setTimeout>;
  private progressInterval?: ReturnType<typeof setInterval>;
  private wsCollectSub?: Subscription; // Subscription para cpe_updated durante coleta

  // OTIMIZAÇÃO UX (Micro-transações Simultâneas) — delegado para WifiBatchQueueService
  get pendingCount(): number { return this.batchQueue.pendingCount; }

  private monitorInterval?: ReturnType<typeof setTimeout>;
  private pollInterval?: ReturnType<typeof setInterval>;
  private lastSaveTimestamp: number = 0;
  private destroy$ = new Subject<void>();
  private formValueChangeSubscriptions: Map<string, Subscription> = new Map(); // Gerencia subscriptions de valueChanges
  private isPopulatingForm: boolean = false; // Flag para evitar race conditions em populateWifiForm

  // Capabilities avançadas de Wi-Fi detectadas pelo modelo/firmware da CPE.
  // Fallback permissivo: assume suportado até o backend confirmar o contrário.
  // Isso evita que a UI fique desabilitada para CPEs ainda em fase de aprendizado.
  capabilities: Record<string, boolean> = {
    bandSteering: true,
    advancedRadio: true,
    apConfig: true,
    wpsWmm: true,
    controlFunction: true,
    trafficControl: true
  };

  constructor(
    private fb: FormBuilder,
    private cpeService: CpeService,
    private toastService: ToastService,
    private wsService: WebSocketService,
    private cdr: ChangeDetectorRef,
    private capabilityService: CapabilityService,
    private wifiParamBuilder: WifiParameterBuilderService,
    private bandSteering: WifiBandSteeringService,
    private batchQueue: WifiBatchQueueService,
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
    
    // Limpa subscriptions de valueChanges dos grupos do formulário
    this.formValueChangeSubscriptions.forEach(sub => sub.unsubscribe());
    this.formValueChangeSubscriptions.clear();
    
    // Limpa timers
    if (this.monitorInterval) {
      clearTimeout(this.monitorInterval);
    }
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
    }
    if (this.collectTimeout) {
      clearTimeout(this.collectTimeout);
    }
    if (this.progressInterval) {
      clearInterval(this.progressInterval);
    }
    
    // Limpa subscription do WebSocket
    this.wsCollectSub?.unsubscribe();

    // WifiBatchQueueService gerencia seu próprio cleanup via OnDestroy
  }

  /**
   * Verifica se há dados de SSID disponíveis para popular o formulário.
   * Fonte primária: wifi2g/wifi5g.accessPoints (banco).
   * Fonte secundária: parametersCache (paths SSID coletados via GPV).
   * Se ambas vazias, dispara coleta on-demand.
   */
  private hasSsidData(): boolean {
    // Fonte primária: accessPoints do banco (sempre populada após bootstrap)
    const aps2g = this.cpe?.wifi2g?.accessPoints;
    const aps5g = this.cpe?.wifi5g?.accessPoints;
    if (Array.isArray(aps2g) && aps2g.length > 0) return true;
    if (Array.isArray(aps5g) && aps5g.length > 0) return true;

    // Fonte secundária: parametersCache (pode ter sido evictido pelo LRU)
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
   * Timeout de segurança de 60s caso a CPE não responda (coleta essencial + avançada).
   */
  triggerWifiConfigCollection(): void {
    if (!this.serialNumber || this.isCollectingConfig) return;

    this.isCollectingConfig = true;
    this.collectConfigError = false;
    this.collectConfigTimedOut = false;
    this.collectProgress = 0;
    this.collectStage = 'iniciando';
    this.startProgressSimulation();
    // UX: OnPush requer marcação imediata para o loading aparecer antes da resposta HTTP.
    this.cdr.markForCheck();

    this.cpeService.collectWifiConfig(this.serialNumber).subscribe({
      next: (res) => {
        if (res.status === 'cached') {
          // Backend confirmou que há dados frescos → refetch direto
          this.cpeService.clearCache(this.serialNumber);
          this.cpeService.getCpeDetails(this.serialNumber).subscribe({
            next: (freshCpe) => {
              this.cpe = freshCpe as any;
              this.finishCollecting();
              this.populateWifiForm();
            },
            error: () => {
              this.finishCollecting();
              this.collectConfigError = true;
              this.cdr.markForCheck();
            }
          });
          return;
        }

        this.collectStage = 'contactando';
        this.cdr.markForCheck();

        // Backend retornou 202: coleta em andamento → escuta cpe_updated
        this.collectTimeout = setTimeout(() => {
          this.wsCollectSub?.unsubscribe();
          this.finishCollecting();
          this.collectConfigTimedOut = true;
          this.toastService.warning('Tempo limite atingido. A CPE pode estar offline ou a coleta excedeu o limite.');
          this.cdr.markForCheck();
        }, WIFI_CONSTANTS.COLLECT_TIMEOUT_MS);

        this.wsCollectSub = this.wsService.onCpeUpdated().pipe(
          filter((ev: any) => ev.serialNumber === this.serialNumber),
          takeUntil(this.destroy$)
        ).subscribe(() => {
          clearTimeout(this.collectTimeout);
          this.wsCollectSub?.unsubscribe();
          this.collectStage = 'coletando';
          this.cdr.markForCheck();
          // CPE respondeu → força refetch ignorando cache de 30s
          this.cpeService.clearCache(this.serialNumber);
          this.cpeService.getCpeDetails(this.serialNumber).subscribe({
            next: (freshCpe) => {
              this.cpe = freshCpe as any;
              this.collectStage = 'finalizando';
              this.cdr.markForCheck();
              if (this.hasSsidData()) {
                this.finishCollecting();
                this.populateWifiForm();
              } else {
                // CPE online, respondeu ao CR, mas sem SSIDs no cache ainda
                this.finishCollecting();
                this.collectConfigError = true;
                this.cdr.markForCheck();
              }
            },
            error: () => {
              this.finishCollecting();
              this.collectConfigError = true;
              this.cdr.markForCheck();
            }
          });
        });
      },
      error: () => {
        this.finishCollecting();
        this.collectConfigError = true;
        this.toastService.error('Não foi possível iniciar a coleta de configuração Wi-Fi.');
        this.cdr.markForCheck();
      }
    });
  }

  /**
   * Cancela a coleta de configuração Wi-Fi em andamento.
   */
  cancelCollecting(): void {
    this.wsCollectSub?.unsubscribe();
    this.finishCollecting();
    this.cdr.markForCheck();
  }

  /**
   * Finaliza o estado de coleta e limpa timers auxiliares.
   */
  private finishCollecting(): void {
    this.isCollectingConfig = false;
    if (this.collectTimeout) clearTimeout(this.collectTimeout);
    if (this.progressInterval) clearInterval(this.progressInterval);
    this.collectProgress = 100;
    this.collectStage = 'finalizando';
  }

  /**
   * Simula progresso visual durante a coleta para melhorar a UX.
   * Avança de 0 a 90% ao longo do timeout, sem estimativas falsas.
   */
  private startProgressSimulation(): void {
    this.collectProgress = 0;
    if (this.progressInterval) clearInterval(this.progressInterval);
    this.progressInterval = setInterval(() => {
      if (this.collectProgress >= 90) return;
      // Incremento decrescente: começa rápido, desacelera perto do fim
      const increment = this.collectProgress < 30 ? 2 : (this.collectProgress < 60 ? 1 : 0.5);
      this.collectProgress = Math.min(90, this.collectProgress + increment);
      this.cdr.markForCheck();
    }, WIFI_CONSTANTS.COLLECT_PROGRESS_INTERVAL_MS);
  }

  ngOnInit(): void {
    this.wifiForm = this.fb.group({
      smartConnect: [false],
      ssids: this.fb.array([], { validators: [uniqueSsidNamesValidator] })
    });

    // Listener para cpe_updated: recarrega UI quando CPE é atualizada pelo backend
    // O payload do WS tem apenas campos Wi-Fi (wifi2g, wifi5g, wifiConfig, pendingTasks) —
    // faz merge em vez de sobrescrever para não perder parametersCache, deviceInfo, wan, etc.
    this.wsService.onCpeUpdated().pipe(
      filter((ev: any) => ev.serialNumber === this.serialNumber),
      takeUntil(this.destroy$)
    ).subscribe(ev => {
      if (this.cpe) {
        this.cpe = { ...this.cpe, ...ev };
      } else {
        this.cpe = ev;
      }
      this.populateWifiForm();
      this.cdr.markForCheck();
    });

    // Recuperação de tela travada contra ações de F5 acidentais
    const isProvisioning = sessionStorage.getItem(`vmoas_locked_${this.serialNumber}`);
    if (isProvisioning === 'true') {
        this.isApplyingWifi = true;
        this.startProvisioningMonitor();
    }

    // Carrega capabilities avançadas de Wi-Fi do modelo/firmware da CPE
    if (this.serialNumber) {
      this.capabilityService.getCapabilities(this.serialNumber, 'wifi').subscribe({
        next: (cap) => {
          this.capabilities = cap.capabilities;
          this.cdr.markForCheck();
        },
        error: () => {
          // Fallback permissivo já é tratado no service
        }
      });
    }

    if (this.hasSsidData()) {
      this.populateWifiForm();
    } else {
      this.triggerWifiConfigCollection();
    }

    // WebSocket: desliga o spinner de provisionamento imediatamente quando o ACS confirmar sucesso/falha.
    // O ngOnChanges também monitora pendingTasks, mas o WS chega primeiro e evita o timeout de 45s.
    this.wsService.onConfigSuccess().pipe(
      filter((ev: any) => ev?.serialNumber === this.serialNumber),
      takeUntil(this.destroy$)
    ).subscribe(() => {
      this.unlockScreenAndFinish();
      this.cdr.markForCheck();
    });

    this.wsService.on('config_error').pipe(
      filter((ev: any) => ev?.serialNumber === this.serialNumber),
      takeUntil(this.destroy$)
    ).subscribe((ev: any) => {
      // Se estivermos no meio de uma coleta de configuração Wi-Fi, finaliza-a como erro.
      if (this.isCollectingConfig) {
        this.wsCollectSub?.unsubscribe();
        this.finishCollecting();
        this.collectConfigError = true;
        this.toastService.error(ev?.message || 'A CPE rejeitou a coleta de configuração Wi-Fi.');
        this.cdr.markForCheck();
        return;
      }
      this.unlockScreenAndFinish();
      this.rollbackLocalState(true);
      this.cdr.markForCheck();
    });

    // Inicializa o motor de Micro-Transações em Lote (Debounce de 2s)
    // Delegado para WifiBatchQueueService — lógica reutilizável e testável.
    // onFlush é chamado pelo debounce automático do service (agrupa toggles rápidos).
    this.batchQueue.init({
      debounceMs: 2000,
      isBlocked: () => this.isApplyingWifi,
      onFlush: (payload) => {
        this.toastService.info(`Sincronizando ${payload.length} alteração(ões) com a CPE...`);
        this.submitPayloadToNoc(payload);
      },
    });
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['cpe'] && !changes['cpe'].firstChange) {
      const updatedCpe = changes['cpe'].currentValue;

      // Destrava a tela quando o Polling comprovar que a tarefa saiu da fila e o banco foi atualizado
      if (this.isApplyingWifi) {
          if (!updatedCpe.pendingTasks || updatedCpe.pendingTasks.length === 0) {
              this.unlockScreenAndFinish();
              // Invalida cache após confirmação da CPE para garantir dados frescos no próximo F5
              this.cpeService.clearCache(this.serialNumber);
          } else {
              this.cdr.markForCheck();
              return;
          }
      }

      // Se dados Wi-Fi chegaram depois de um timeout de coleta, limpa os flags e mostra o formulário.
      if (this.collectConfigTimedOut && this.hasSsidData()) {
        this.collectConfigTimedOut = false;
        this.collectConfigError = false;
      }

      this.populateWifiForm();
    }
  }

  /**
   * Registra subscription de valueChanges para securityMode de um FormGroup de SSID.
   * Habilita/desabilita o campo de senha conforme o modo de segurança.
   * Centralizado em helper para reutilização entre controles novos e existentes.
   */
  private registerSecurityModeSubscription(group: FormGroup, index: string): void {
    const sub = group.get('securityMode')?.valueChanges.pipe(
      takeUntil(this.destroy$)
    ).subscribe(mode => {
      if (this.isPopulatingForm) return;
      const pwdCtrl = group.get('password');
      mode === 'None' ? pwdCtrl?.disable({ emitEvent: false }) : pwdCtrl?.enable({ emitEvent: false });
    });
    if (sub) {
      this.formValueChangeSubscriptions.set(`securityMode_${index}`, sub);
    }
  }

  populateWifiForm(): void {
    // Proteção contra race conditions: se já está populando, ignora chamadas simultâneas
    if (this.isPopulatingForm) return;
    if (!this.cpe) return;

    this.isPopulatingForm = true;

    try {
      // Usa o banco (wifi2g/wifi5g) como fonte primária de SSIDs
      // parametersCache é usado apenas para enriquecer com valores avançados
      const { configs, smartConnectEnabled } = mapTr069ToWifiConfigs(this.cpe);

      this.wifiForm.patchValue({ smartConnect: smartConnectEnabled }, { emitEvent: false });

      // Sincronização Não-Destrutiva (Sugestão 1)
      const currentControls = this.ssidsArray.controls as FormGroup[];

      // Limpa subscriptions antigas de valueChanges para evitar memory leaks
      this.formValueChangeSubscriptions.forEach(sub => sub.unsubscribe());
      this.formValueChangeSubscriptions.clear();

      configs.forEach(config => {
        const existingCtrl = currentControls.find(c => c.getRawValue().index === config.index && c.getRawValue().band === config.band);

        if (existingCtrl) {
          // Preserva uiVisible se o AP foi habilitado manualmente e o SPV ainda está pendente.
          // Quando o técnico habilita um AP no modal, o form recebe uiVisible=true imediatamente
          // (optimistic update). Mas o banco só é atualizado após a CPE processar o SPV.
          // Se um WS event (ex: telemetria) chega antes do SPV ser confirmado, populateWifiForm
          // re-lê do banco (onde enable=false) e resetaria uiVisible para false, fazendo o card
          // desaparecer. Esta preservação evita esse race condition.
          if (existingCtrl.get('uiVisible')?.value === true && config.uiVisible === false) {
            config = { ...config, uiVisible: true, enable: true, status: 'Enabled' };
          }

          // Preserva senha se o form tem uma senha válida mas o banco retorna vazia.
          // Cenário: Smart Connect ativo → bandSteering.sync espelha senha do 2.4GHz para o form
          // do 5GHz (optimistic update). A senha do 5GHz no banco pode estar vazia se nunca foi
          // salva via SPV (ex: AP foi habilitado mas o técnico ainda não clicou "Salvar Rede").
          // Quando SC é desativado, o SPV(BandSteering.Enable=false) dispara WS cpe_updated →
          // populateWifiForm → patchValue sobrescreveria a senha do form com '' do banco.
          // Esta preservação mantém a senha do form quando o banco não tem uma.
          const existingPwd = existingCtrl.get('password')?.value;
          const existingSec = existingCtrl.get('securityMode')?.value;
          if (
            config.securityMode !== 'None' &&
            (!config.password || config.password.trim() === '') &&
            typeof existingPwd === 'string' && existingPwd.trim() !== '' &&
            existingSec !== 'None'
          ) {
            config = { ...config, password: existingPwd, securityMode: existingSec };
          }

          existingCtrl.patchValue(config, { emitEvent: false });

          const pwdCtrl = existingCtrl.get('password');
          if (config.securityMode === 'None') {
            if (pwdCtrl?.enabled) pwdCtrl.disable({ emitEvent: false });
          } else {
            if (pwdCtrl?.disabled) pwdCtrl.enable({ emitEvent: false });
          }

          // Recria subscription de valueChanges para securityMode (a antiga foi limpa acima)
          this.registerSecurityModeSubscription(existingCtrl, config.index);
        } else {
          const group = this.fb.group({
            index: [config.index],
            name: [this.sanitizeSsidInput(config.name), [ssidValidator]],
            password: [config.password, [passwordValidator]],
            securityMode: [config.securityMode],
            enable: [{ value: config.enable, disabled: config.isLockedByHardware }],
            status: [config.status],
            isLockedByHardware: [config.isLockedByHardware],
            atf: [config.atf],
            muMimo: [config.muMimo],
            ofdma: [config.ofdma],
            twt: [config.twt],
            bssColor: [config.bssColor],
            band: [config.band],
            isPrimary: [config.isPrimary],
            guestId: [config.guestId],
            uiVisible: [config.uiVisible],
            isTR181: [config.isTR181],
            // Configurações avançadas do AP
            hidden: [config.hidden],
            isolation: [config.isolation],
            beamforming: [config.beamforming],
            wpsEnable: [config.wpsEnable],
            wmmEnable: [config.wmmEnable],
            lanAccess: [config.lanAccess],
            usbAccess: [config.usbAccess],
            tcEnable: [config.tcEnable],
            tcMaxDown: [config.tcMaxDown, [trafficControlValueValidator]],
            tcMaxUp: [config.tcMaxUp, [trafficControlValueValidator]],
            tcMinDown: [config.tcMinDown, [trafficControlValueValidator]],
            tcMinUp: [config.tcMinUp, [trafficControlValueValidator]],
            namePath: [config.namePath],
            passPath: [config.passPath],
            securityModePath: [config.securityModePath],
            enablePath: [config.enablePath],
            atfPath: [config.atfPath],
            muMimoPath: [config.muMimoPath],
            ofdmaPath: [config.ofdmaPath],
            twtPath: [config.twtPath],
            bssColorPath: [config.bssColorPath],
            accessPointEnablePath: [config.accessPointEnablePath],
            hiddenPath: [config.hiddenPath],
            isolationPath: [config.isolationPath],
            beamformingPath: [config.beamformingPath],
            wpsEnablePath: [config.wpsEnablePath],
            wmmEnablePath: [config.wmmEnablePath],
            lanAccessPath: [config.lanAccessPath],
            usbAccessPath: [config.usbAccessPath],
            tcEnablePath: [config.tcEnablePath],
            tcMaxDownPath: [config.tcMaxDownPath],
            tcMaxUpPath: [config.tcMaxUpPath],
            tcMinDownPath: [config.tcMinDownPath],
            tcMinUpPath: [config.tcMinUpPath]
          }, { validators: [securityWithPasswordValidator] });

          this.ssidsArray.push(group, { emitEvent: false });

          // Registra subscription de valueChanges para securityMode
          this.registerSecurityModeSubscription(group, config.index);

          if (config.securityMode === 'None') group.get('password')?.disable({ emitEvent: false });
        }
      });

      // Limpeza de arrays obsoletos (caso de alteração massiva de firmware na mesma tela, raro, mas seguro)
      for (let i = currentControls.length - 1; i >= 0; i--) {
        const ctrlIdx = currentControls[i].getRawValue().index;
        const ctrlBand = currentControls[i].getRawValue().band;
        if (!configs.find(c => c.index === ctrlIdx && c.band === ctrlBand)) {
          this.ssidsArray.removeAt(i, { emitEvent: false });
        }
      }

      // IMPORTANTE: Quando smart connect está ativo, força o espelhamento mesmo após
      // receber dados do banco. Isso garante que a UI reflita o estado correto quando
      // a CPE confirma a mudança mas o banco ainda pode ter dados desatualizados.
      this.bandSteering.sync(this.ssidsArray.controls as FormGroup[], smartConnectEnabled);
      
      // Ordena SSIDs: Primary primeiro, depois agrupados por guestId e banda
      // Só ordena após todos os controles estarem populados para evitar erro de FormArray vazio
      if (this.ssidsArray.length > 0) {
        this.sortSsidsByPriority();
      }
      
      this.cdr.markForCheck();
    } finally {
      this.isPopulatingForm = false;
    }
  }

  showGuestList: boolean = false;

  toggleGuestList(): void {
    this.showGuestList = !this.showGuestList;
  }

  openGuestModal(): void {
    this.showGuestList = true;
  }

  closeGuestModal(): void {
    this.showGuestList = false;
  }

  /**
   * Ordena SSIDs por prioridade: Primary primeiro, depois agrupados por guestId e banda.
   * Isso garante que APs primary apareçam sempre primeiro e APs relacionados fiquem juntos.
   */
  private sortSsidsByPriority(): void {
    const ssids = this.ssidsArray.controls as FormGroup[];
    const values = ssids.map((c, i) => ({ value: c.getRawValue(), originalIndex: i }));
    
    // Ordenação: Primary primeiro, depois por guestId, depois por banda (2.4GHz antes de 5GHz)
    const sortedIndices = values.sort((a, b) => {
      // Primary sempre primeiro
      if (a.value.isPrimary && !b.value.isPrimary) return -1;
      if (!a.value.isPrimary && b.value.isPrimary) return 1;
      
      // Se ambos são Primary ou ambos não-Primary, ordena por guestId
      if (a.value.guestId !== b.value.guestId) {
        // guestId 99 (desconhecido) vai para o final
        if (a.value.guestId === 99) return 1;
        if (b.value.guestId === 99) return -1;
        return a.value.guestId - b.value.guestId;
      }
      
      // Se guestId igual, ordena por banda (2.4GHz antes de 5GHz)
      if (a.value.band === '2.4GHz' && b.value.band === '5GHz') return -1;
      if (a.value.band === '5GHz' && b.value.band === '2.4GHz') return 1;
      
      // Se banda igual, ordena por índice
      const aIdx = parseInt(a.value.index, 10);
      const bIdx = parseInt(b.value.index, 10);
      if (isNaN(aIdx) || isNaN(bIdx)) return 0;
      return aIdx - bIdx;
    }).map(item => item.originalIndex);
    
    // Reordena o FormArray preservando referências dos FormGroup (não usa clear()).
    // clear() destrói referências e quebra bindings do template *ngFor + [ssidForm].
    // Em vez disso, move controles um a um para a posição correta usando removeAt+insert.
    const orderedControls = sortedIndices.map(i => ssids[i]);
    // Remove todos os controles sem destruí-los (removeAt preserva a referência)
    while (this.ssidsArray.length > 0) {
      this.ssidsArray.removeAt(0, { emitEvent: false });
    }
    orderedControls.forEach(control => {
      this.ssidsArray.push(control, { emitEvent: false });
    });
  }

  /**
   * trackBy para *ngFor de SSIDs — usa index+band como identidade única.
   * Evita recriação de todos os cards a cada populateWifiForm (OnPush + *ngFor sem trackBy = recria DOM).
   */
  trackBySsid(index: number, ctrl: any): string {
    const v = ctrl?.getRawValue?.() || {};
    return `${v.index}_${v.band}`;
  }

  get visibleGuestsCount(): number {
    // Conta SSIDs não-primary visíveis
    return this.ssidsArray.getRawValue().filter((s: any) => !s.isPrimary && s.uiVisible).length;
  }

  get totalGuestSSIDs(): number {
    return this.ssidsArray.getRawValue().filter((s: any) => !s.isPrimary).length;
  }

  get enabledGuestSSIDs(): number {
    return this.ssidsArray.getRawValue().filter((s: any) => !s.isPrimary && s.enable && (s.status === 'Enabled' || s.status === 'Up') && s.name?.trim() !== '').length;
  }

  /**
   * Verifica se a CPE suporta um grupo de capabilities avançadas de Wi-Fi.
   * Usado pelo template para renderizar apenas toggles compatíveis.
   */
  hasCapability(key: string): boolean {
    return this.capabilities?.[key] ?? true;
  }

  /**
   * Label amigável do estágio atual de coleta para exibição na tela de loading.
   */
  get collectStageLabel(): string {
    switch (this.collectStage) {
      case 'contactando': return 'Enviando Connection Request e aguardando a CPE acordar...';
      case 'coletando': return 'CPE respondeu. Coletando parâmetros Wi-Fi via TR-069...';
      case 'finalizando': return 'Finalizando e populando o formulário...';
      default: return 'Preparando coleta de configuração Wi-Fi...';
    }
  }

  /**
   * Retorna todos os SSIDs não-primary disponíveis para habilitação.
   * Se Smart Connect está ativo, mostra apenas 2.4GHz (5GHz é gerido automaticamente).
   * Ordenação: agrupados por guestId, com 2.4GHz e 5GHz lado a lado.
   */
  getAvailableGuestSSIDs(): Array<{index: string, band: string, name: string, enabled: boolean, visible: boolean, securityMode: string, guestId: number}> {
    const all = this.ssidsArray.getRawValue()
      .filter((s: any) => {
        if (s.isPrimary) return false;  // só guests
        // Se SC ativo: mostra apenas 2.4GHz (5GHz é gerido automaticamente)
        if (this.smartConnect && s.band === '5GHz') return false;
        return true;
      })
      .map((s: any) => ({
        index: s.index,
        band: s.band,
        name: s.name || `SSID_${s.index}`,
        enabled: s.enable && (s.status === 'Enabled' || s.status === 'Up') && s.name?.trim() !== '',
        visible: s.uiVisible,
        securityMode: s.securityMode || 'None',
        guestId: s.guestId ?? 99
      }));

    // Ordenação: delegado para sortApsByGuestAndBand (wifi-ap-pairing.ts)
    return sortApsByGuestAndBand(all);
  }

  /**
   * Retorna apenas os SSIDs guest habilitados (no ar), ordenados por guestId e banda.
   * Quando Smart Connect está ativo, inclui também os APs 5GHz que foram habilitados
   * automaticamente (espelhados do 2.4GHz) — eles não aparecem em "Disponíveis" mas
   * precisam aparecer em "Redes no Ar" para o técnico ver que foram auto-habilitados.
   */
  getEnabledGuestSSIDs(): Array<{index: string, band: string, name: string, enabled: boolean, visible: boolean, securityMode: string, guestId: number}> {
    // Quando SC está ativo, getAvailableGuestSSIDs filtra 5GHz.
    // Precamos buscar diretamente do FormArray para incluir 5GHz habilitados.
    if (this.smartConnect) {
      const all = this.ssidsArray.getRawValue()
        .filter((s: any) => {
          if (s.isPrimary) return false;  // só guests
          // Inclui ambos 2.4GHz e 5GHz que estão habilitados
          return s.enable && (s.status === 'Enabled' || s.status === 'Up') && s.name?.trim() !== '';
        })
        .map((s: any) => ({
          index: s.index,
          band: s.band,
          name: s.name || `SSID_${s.index}`,
          enabled: true,
          visible: s.uiVisible,
          securityMode: s.securityMode || 'None',
          guestId: s.guestId ?? 99
        }));
      return sortApsByGuestAndBand(all);
    }
    return this.getAvailableGuestSSIDs().filter(s => s.enabled);
  }

  /**
   * Retorna apenas os SSIDs guest desabilitados (disponíveis), ordenados por guestId e banda.
   */
  getDisabledGuestSSIDs(): Array<{index: string, band: string, name: string, enabled: boolean, visible: boolean, securityMode: string, guestId: number}> {
    return this.getAvailableGuestSSIDs().filter(s => !s.enabled);
  }

  /**
   * Encontra o AP correlacionado (banda oposta, mesmo guestId) de um SSID.
   * Delegado para findCorrelatedAp (wifi-ap-pairing.ts) — função pura reutilizável.
   * @returns FormGroup do AP correlacionado ou undefined se não encontrado.
   */
  private findCorrelatedAp(sourceVal: any): FormGroup | undefined {
    const aps = (this.ssidsArray.controls as FormGroup[])
      .map(c => c.getRawValue());
    const peer = findCorrelatedAp(sourceVal, aps);
    if (!peer) return undefined;
    return (this.ssidsArray.controls as FormGroup[])
      .find(c => c.getRawValue().index === peer.index);
  }

  /**
   * Habilita um SSID específico por índice.
   * Gera automaticamente nome único e senha segura para evitar erros 9007.
   * Habilita também o AP correlacionado (banda oposta, mesmo guestId) automaticamente.
   */
  enableGuestSSID(index: string): void {
    const ssidCtrl = this.ssidsArray.controls.find(c => c.getRawValue().index === index);
    if (!ssidCtrl) {
      this.toastService.error('SSID não encontrado.');
      return;
    }

    const val = ssidCtrl.getRawValue();

    // Validação: se SSID já está habilitado, não faz nada
    if (val.uiVisible && val.enable) {
      this.toastService.warning('SSID já está habilitado.');
      return;
    }

    // 1. Nome único sem colisão + sanitizado
    // Exclui o AP correlacionado (2.4GHz ↔ 5GHz, mesmo guestId resolvido) da lista de
    // nomes ocupados — ele receberá o mesmo nome do AP source (são correlacionados).
    // Usa areCorrelatedAps (wifi-ap-pairing.ts) que resolve guestId=99 via GUEST_ID_FALLBACK.
    const allCurrentNames = (this.ssidsArray.controls as FormGroup[])
      .map(c => c.getRawValue())
      .filter(v => {
        if (!v.uiVisible || !v.enable) return false;
        if (v.index === val.index) return false;           // exclui self por índice
        // Exclui o AP correlacionado — mesmo nome é permitido entre pares 2.4GHz ↔ 5GHz
        if (areCorrelatedAps(v, val)) return false;
        return true;
      })
      .map(v => v.name as string)
      .filter(n => !!n?.trim());
    const rawName = val.name?.trim() || '';
    const newName = rawName
      ? generateUniqueGuestName(allCurrentNames, rawName)
      : generateUniqueGuestName(allCurrentNames);

    // 2. Senha segura gerada se não tiver senha válida no banco
    const existingPwd = (typeof val.password === 'string') ? val.password.trim() : '';
    const newPassword = existingPwd.length >= WIFI_CONSTANTS.PASSWORD.MIN_LENGTH
      ? existingPwd
      : generateSecurePassword();

    // 3. Sempre WPA2 + senha gerada → elimina risco 9007 e o workaround 'None'
    ssidCtrl.patchValue({
      uiVisible: true,
      enable: true,
      status: 'Enabled',
      securityMode: WIFI_CONSTANTS.SECURITY_MODES.WPA2,
      name: newName,
      password: newPassword
    }, { emitEvent: false });

    // 4. Envia comando SPV imediatamente para a CPE (apenas enable + nome).
    // NÃO envia Security.ModeEnabled nem KeyPassphrase nesta transação — a CPE pode
    // rejeitar Security.ModeEnabled com Fault 9007 quando o AP está sendo habilitado
    // na mesma transação. O técnico clica "Salvar Rede" no card para aplicar segurança.
    if (val.enablePath) {
      this.queueChange({ name: val.enablePath, value: 'true', type: 'xsd:boolean' });
    }
    if (val.isTR181 && val.accessPointEnablePath) {
      this.queueChange({ name: val.accessPointEnablePath, value: 'true', type: 'xsd:boolean' });
    }
    if (val.namePath) {
      const safeName = sanitizeSsidName(newName);
      this.queueChange({ name: val.namePath, value: safeName, type: 'xsd:string' });
    }

    // 5. Habilita o AP correlacionado (banda oposta, mesmo guestId) automaticamente.
    // Mesma lógica do Smart Connect, mas aplicada sempre — os APs 2.4GHz e 5GHz
    // correlacionados devem ser habilitados juntos para manter consistência.
    const peerCtrl = this.findCorrelatedAp(val);
    if (peerCtrl) {
      const peerVal = peerCtrl.getRawValue();

      // Só habilita o peer se ele ainda não está habilitado
      if (!peerVal.uiVisible || !peerVal.enable) {
        // Nome: mesmo nome do AP source (são correlacionados, podem compartilhar o nome)
        const peerNewName = newName;
        // Senha: mesma senha do AP source (são correlacionados)
        const peerNewPassword = newPassword;

        peerCtrl.patchValue({
          uiVisible: true,
          enable: true,
          status: 'Enabled',
          securityMode: WIFI_CONSTANTS.SECURITY_MODES.WPA2,
          name: peerNewName,
          password: peerNewPassword
        }, { emitEvent: false });

        // Envia SPV para o peer também (enable + nome)
        if (peerVal.enablePath) {
          this.queueChange({ name: peerVal.enablePath, value: 'true', type: 'xsd:boolean' });
        }
        if (peerVal.isTR181 && peerVal.accessPointEnablePath) {
          this.queueChange({ name: peerVal.accessPointEnablePath, value: 'true', type: 'xsd:boolean' });
        }
        if (peerVal.namePath) {
          const safePeerName = sanitizeSsidName(peerNewName);
          this.queueChange({ name: peerVal.namePath, value: safePeerName, type: 'xsd:string' });
        }
      }
    }

    // 6. Espelhamento Smart Connect (se ativo, sincroniza todos os outros campos)
    // Passa o guestId RESOLVIDO (via resolveGuestId) para que o sync encontre o peer
    // correto mesmo quando guestId=99 (desconhecido) — resolveGuestId usa GUEST_ID_FALLBACK.
    if (this.smartConnect && val.band === '2.4GHz') {
      this.bandSteering.sync(this.ssidsArray.controls as FormGroup[], true, true, resolveGuestId(val));
    } else if (!this.smartConnect) {
      this.bandSteering.sync(this.ssidsArray.controls as FormGroup[], false);
    }

    this.cdr.markForCheck();
    this.toastService.info(
      peerCtrl ? 'Redes 2.4GHz e 5GHz habilitadas com senha gerada. Sincronizando com a CPE...' : 'Rede de visitantes habilitada com senha gerada. Sincronizando com a CPE...'
    );

    // NÃO fecha o modal automaticamente - permite habilitar múltiplos SSIDs de uma vez
  }

  /**
   * Desabilita todos os SSIDs não-primary visíveis.
   * Envia comando SPV imediatamente (enable=false) — os cards desaparecem da UI,
   * então não há botão "Salvar" para clicar depois.
   */
  disableAllGuests(): void {
    let hasChanges = false;
    const ssids = this.ssidsArray.controls as FormGroup[];
    ssids.forEach(ssidCtrl => {
      const val = ssidCtrl.getRawValue();
      
      // Desabilita apenas SSIDs não-primary visíveis ou habilitados
      if (!val.isPrimary && (val.uiVisible || val.enable)) {
        const newName = `${WIFI_CONSTANTS.GUEST_AUTO_RESET_PREFIX}_${val.index}`;
        
        ssidCtrl.patchValue({
          uiVisible: false,
          enable: false,
          status: 'Disabled',
          name: newName,
          password: ''
        }, { emitEvent: false });

        // Envia comando SPV imediatamente para a CPE (enable=false).
        // Os cards desaparecem da UI quando uiVisible=false, então não há botão "Salvar".
        if (val.enablePath) {
          this.queueChange({ name: val.enablePath, value: 'false', type: 'xsd:boolean' });
        }
        if (val.isTR181 && val.accessPointEnablePath) {
          this.queueChange({ name: val.accessPointEnablePath, value: 'false', type: 'xsd:boolean' });
        }
        
        hasChanges = true;
      }
    });

    if (hasChanges) {
      this.syncUiState();
      this.toastService.info('Redes de visitantes desabilitadas. Sincronizando com a CPE...');
      this.cdr.markForCheck();
    }
  }

  /**
   * Desabilita um SSID específico por índice.
   * Envia comando SPV imediatamente (enable=false) — o card desaparece da UI,
   * então não há botão "Salvar" para clicar depois.
   */
  disableGuestSSID(index: string): void {
    const ssidCtrl = this.ssidsArray.controls.find(c => c.getRawValue().index === index);
    if (!ssidCtrl) {
      this.toastService.error('SSID não encontrado.');
      return;
    }

    const val = ssidCtrl.getRawValue();
    
    if (!val.uiVisible) {
      this.toastService.warning('SSID já está desabilitado.');
      return;
    }

    const newName = `${WIFI_CONSTANTS.GUEST_AUTO_RESET_PREFIX}_${val.index}`;
    
    ssidCtrl.patchValue({
      uiVisible: false,
      enable: false,
      status: 'Disabled',
      name: newName,
      password: ''
    }, { emitEvent: false });

    // Envia comando SPV imediatamente para a CPE (enable=false).
    // O card desaparece da UI quando uiVisible=false, então não há botão "Salvar" para clicar.
    if (val.enablePath) {
      this.queueChange({ name: val.enablePath, value: 'false', type: 'xsd:boolean' });
    }
    // TR-181: AccessPoint.Enable também precisa ser false
    if (val.isTR181 && val.accessPointEnablePath) {
      this.queueChange({ name: val.accessPointEnablePath, value: 'false', type: 'xsd:boolean' });
    }

    // Desabilita o AP correlacionado (banda oposta, mesmo guestId) automaticamente.
    // Mesma lógica do Smart Connect, mas aplicada sempre — os APs 2.4GHz e 5GHz
    // correlacionados devem ser desabilitados juntos para manter consistência.
    const peerCtrl = this.findCorrelatedAp(val);
    if (peerCtrl) {
      const peerVal = peerCtrl.getRawValue();
      if (peerVal.uiVisible || peerVal.enable) {
        peerCtrl.patchValue({
          uiVisible: false,
          enable: false,
          status: 'Disabled',
          name: `${WIFI_CONSTANTS.GUEST_AUTO_RESET_PREFIX}_${peerVal.index}`,
          password: ''
        }, { emitEvent: false });

        // Envia SPV para o peer 5GHz também
        if (peerVal.enablePath) {
          this.queueChange({ name: peerVal.enablePath, value: 'false', type: 'xsd:boolean' });
        }
        if (peerVal.isTR181 && peerVal.accessPointEnablePath) {
          this.queueChange({ name: peerVal.accessPointEnablePath, value: 'false', type: 'xsd:boolean' });
        }
      }
    }

    this.syncUiState();
    this.cdr.markForCheck();
    this.toastService.info('SSID desabilitado. Sincronizando com a CPE...');
    
    // NÃO fecha o modal automaticamente - permite desabilitar múltiplos SSIDs de uma vez
    // this.closeGuestModal();
  }

  syncUiState(): void {
    // Só sincroniza Smart Connect se não estiver ativo
    // Se Smart Connect está ativo, o espelhamento é controlado manualmente pelo usuário
    if (!this.smartConnect) {
      this.bandSteering.sync(this.ssidsArray.controls as FormGroup[], false);
    }
  }

  // ====================================================================
  // MOTOR DE MICRO-TRANSAÇÕES (BATCHING & REAL-TIME)
  // Delegado para WifiBatchQueueService — lógica reutilizável e testável.
  // ====================================================================

  private queueChange(param: any): void {
    this.batchQueue.queueChange(param);
    this.optimisticUpdateLocalState([param]); // Atualiza o estado visual instantaneamente
  }

  private flushBatch(): void {
    // Drain retorna o payload e limpa a fila. submitPayloadToNoc envia à API.
    // O debounce automático do service usa onFlush (configurado no init) que faz o mesmo.
    const payload = this.batchQueue.drain();
    if (payload.length === 0) return;
    this.toastService.info(`Sincronizando ${payload.length} alteração(ões) com a CPE...`);
    this.submitPayloadToNoc(payload);
  }

  /**
   * INTERCEPTOR IMEDIATO DE SWITCHES/TOGGLES
   */
  applyImmediateToggle(path: string, event: Event, type: string): void {
    if (!path || typeof path !== 'string') {
      this.toastService.error('Parâmetro TR-069 não identificado para este controle.');
      event.preventDefault();
      return;
    }
    // Guard: bloqueia toggles durante provisionamento ativo — evita race condition
    // onde optimisticUpdateLocalState corrompe o cache enquanto a CPE está processando
    if (this.isApplyingWifi) {
      event.preventDefault();
      this.toastService.warning('Aguarde a sincronização atual terminar antes de alterar mais parâmetros.');
      return;
    }
    const target = event.target as HTMLInputElement;
    let value = target.checked ? 'true' : 'false';
    // Hidden SSID usa SSIDAdvertisementEnabled que é INVERTIDO:
    // hidden=true (oculto) → SSIDAdvertisementEnabled=false
    // hidden=false (visível) → SSIDAdvertisementEnabled=true
    if (path.endsWith('.SSIDAdvertisementEnabled')) {
      value = target.checked ? 'false' : 'true';
    }
    this.queueChange({ name: path, value, type });

    // Sincroniza o AP correlacionado (banda oposta, mesmo guestId) quando o toggle
    // é de Enable (SSID.X.Enable ou AccessPoint.X.Enable).
    // Os APs 2.4GHz e 5GHz correlacionados devem ser ligados/desligados juntos.
    if (path.endsWith('.Enable') && (path.includes('WiFi.SSID.') || path.includes('WLANConfiguration.'))) {
      // Extrai o índice do path (ex: Device.WiFi.SSID.5.Enable → '5')
      const idxMatch = path.match(/(?:SSID|WLANConfiguration)\.(\d+)\.Enable$/);
      if (idxMatch) {
        const idx = idxMatch[1];
        const sourceCtrl = this.ssidsArray.controls.find(c => c.getRawValue().index === idx);
        if (sourceCtrl) {
          const sourceVal = sourceCtrl.getRawValue();
          const peerCtrl = this.findCorrelatedAp(sourceVal);
          if (peerCtrl) {
            const peerVal = peerCtrl.getRawValue();
            const newEnable = target.checked;

            // Atualiza o form do peer
            peerCtrl.patchValue({
              enable: newEnable,
              status: newEnable ? 'Enabled' : 'Disabled',
              uiVisible: newEnable
            }, { emitEvent: false });

            // Envia SPV para o peer
            if (peerVal.enablePath) {
              this.queueChange({ name: peerVal.enablePath, value: newEnable ? 'true' : 'false', type: 'xsd:boolean' });
            }
            if (peerVal.isTR181 && peerVal.accessPointEnablePath) {
              this.queueChange({ name: peerVal.accessPointEnablePath, value: newEnable ? 'true' : 'false', type: 'xsd:boolean' });
            }
          }
        }
      }
    }

    // ESPELHAMENTO DE TOGGLES NÃO-ENABLE (ATF, MU-MIMO, OFDMA, TWT, Hidden, Isolation,
    // Beamforming, WMM, Controle de Tráfego, LAN/USB) para o peer 5GHz quando SC ativo.
    // Quando Smart Connect está ativo, qualquer toggle no AP 2.4GHz (master) deve ser
    // espelhado para o AP 5GHz correlacionado — tanto no form quanto no SPV — para que
    // a CPE e o banco fiquem consistentes entre as duas bandas.
    // Só espelha do 2.4GHz (master) → 5GHz, nunca o inverso (consistente com saveCard).
    if (this.smartConnect && !path.endsWith('.Enable')) {
      const toggleIdxMatch = path.match(/(?:SSID|WLANConfiguration|AccessPoint)\.(\d+)\./);
      if (toggleIdxMatch) {
        const idx = toggleIdxMatch[1];
        const sourceCtrl = this.ssidsArray.controls.find(c => c.getRawValue().index === idx);
        if (sourceCtrl) {
          const sourceVal = sourceCtrl.getRawValue();
          // Só espelha se o source é 2.4GHz (master) — 5GHz não espelha para 2.4GHz
          if (sourceVal.band === '2.4GHz') {
            const peerCtrl = this.findCorrelatedAp(sourceVal);
            if (peerCtrl) {
              const peerVal = peerCtrl.getRawValue();
              // Constrói o peer path substituindo o índice do source pelo índice do peer
              const peerPath = path.replace(`.${idx}.`, `.${peerVal.index}.`);

              // Envia SPV para o peer com o mesmo valor
              this.queueChange({ name: peerPath, value, type });

              // Atualiza o form do peer: mapeia o path para o campo do form correspondente
              // Mapeamento derivado do registry (getTogglePathToFieldMap) — não precisa
              // manter lista hardcoded. Inclui apenas campos toggle (switches na UI).
              const pathToFieldMap = getTogglePathToFieldMap();
              for (const [pathField, formField] of Object.entries(pathToFieldMap)) {
                if (peerVal[pathField] === peerPath) {
                  // target.checked representa o novo estado do toggle (boolean).
                  // Para Hidden: checked=true significa "oculto" (form field hidden=true),
                  // e o value enviado à CPE já foi invertido para SSIDAdvertisementEnabled=false.
                  // O form field do peer armazena o valor lógico (hidden), não o valor da CPE.
                  peerCtrl.patchValue({ [formField]: target.checked }, { emitEvent: false });
                  break;
                }
              }
            }
          }
        }
      }
    }
  }

  /**
   * Handler para eventos do subcomponente WifiSsidCard
   */
  onCardToggle(event: { path: string; event: Event; type: string }): void {
    this.applyImmediateToggle(event.path, event.event, event.type);
  }

  onCardDisableGuest(index: string): void {
    this.disableGuestSSID(index);
  }

  onCardSave(index: number): void {
    this.saveCard(index);
  }

  /**
   * EXECUTA O PROVISIONAMENTO DO COMPONENTE GLOBAL DO SMART CONNECT
   */
  applySmartConnectToggle(event: Event): void {
    if (!this.hasCapability('bandSteering')) {
      this.toastService.warning('Band Steering não é suportado por este modelo/firmware.');
      // Reverte o toggle visual/formulário para evitar inconsistência.
      this.wifiForm.get('smartConnect')?.setValue(!this.smartConnect, { emitEvent: false });
      this.cdr.markForCheck();
      return;
    }
    // Guard: bloqueia toggle durante provisionamento ativo
    if (this.isApplyingWifi) {
      event.preventDefault();
      this.toastService.warning('Aguarde a sincronização atual terminar antes de alterar o Smart Connect.');
      return;
    }
    const target = event.target as HTMLInputElement;
    const isDeviceTR181 = this.ssidsArray.length > 0 && this.ssidsArray.at(0).getRawValue().isTR181;
    const scPath = getBandSteeringPath(isDeviceTR181);
    const newScState = target.checked;

    // CRÍTICO: Validar ANTES de enviar comando para a CPE
    // Se validação falhar, não envia comando e não reverte toggle (pois não foi enviado)
    if (newScState) {
      // Validação: verifica APs 2.4GHz PRIMÁRIOS têm senhas válidas antes de ativar Smart Connect.
      // APs visitante (guest) com senha vazia NÃO bloqueiam SC — eles são redes secundárias
      // e podem ter config incompleta. O SC é principalmente para rede primária.
      // Guests sem senha simplesmente não são espelhados (pulado no loop abaixo).
      const ssids = this.ssidsArray.controls as FormGroup[];
      const masters2G = ssids.map(c => c.getRawValue()).filter(s => s.band === '2.4GHz' && s.enable && s.isPrimary);
      for (const master of masters2G) {
        if (master.securityMode !== 'None' && (!master.password || master.password.trim() === '')) {
          this.toastService.error(`Não é possível ativar Smart Connect: SSID Primário 2.4GHz (índice ${master.index}) tem segurança WPA2 mas senha vazia. Configure a senha primeiro.`);
          // Reverte toggle visual (não foi enviado comando para CPE)
          this.wifiForm.get('smartConnect')?.setValue(!newScState, { emitEvent: false });
          return;
        }
      }
    }

    this.queueChange({ name: scPath, value: newScState ? 'true' : 'false', type: 'xsd:boolean' });

    if (newScState) {
      // CRÍTICO: Sincroniza UI ANTES de ler os valores para enviar
      this.bandSteering.sync(this.ssidsArray.controls as FormGroup[], true, true);
      this.cdr.markForCheck();

      // Pequeno delay para garantir que o patchValue foi processado pelo Angular
      // Isso evita race condition onde getRawValue() lê valores antigos
      setTimeout(() => {
        const ssids = this.ssidsArray.controls as FormGroup[];
        const ssid5GHzCtrls = ssids.filter(c => c.getRawValue().band === '5GHz');
        for (const ssidCtrl5 of ssid5GHzCtrls) {
          const ssid = ssidCtrl5.getRawValue();
          // Só envia para APs habilitados (enable === true)
          if (!ssid.enable) {
            continue;
          }

          // Pula APs 5GHz cujo master 2.4GHz pareado tem securityMode != None mas senha vazia.
          // Isso acontece quando um guest 2.4GHz tem WPA2 mas nunca teve senha salva.
          // Espelhar config incompleta para o 5GHz causaria Fault 9007 ou rede sem proteção.
          // O técnico deve salvar a senha do guest 2.4GHz primeiro (via "Salvar Rede").
          if (ssid.securityMode !== 'None' && (!ssid.password || String(ssid.password).trim() === '')) {
            console.warn('[SC Activation] Pulando AP 5GHz sem senha (guest incompleto)', {
              index: ssid.index,
              name: ssid.name,
              securityMode: ssid.securityMode
            });
            continue;
          }

          // Usa buildAllParams para construir TODOS os parâmetros do 5GHz, incluindo
          // Security.ModeEnabled + KeyPassphrase. O filtro anterior (que removia security
          // e senha) foi removido porque:
          //   1. WPS.Enable (que causava Fault 9007) já foi removido do buildAllParams
          //   2. O AP 5GHz já está habilitado (guard: if (!ssid.enable) continue)
          //      — o 9007 só ocorria quando Enable=true + Security.ModeEnabled eram
          //      enviados na mesma transação para um AP que estava sendo habilitado
          //   3. Sem security+senha, o 5GHz visitante ficava sem proteção no banco/CPE
          const peerResult = this.wifiParamBuilder.buildAllParams(ssidCtrl5 as FormGroup, this.capabilities);
          if (peerResult.success) {
            peerResult.params.forEach(p => this.queueChange(p));
          } else {
            // Fallback: se buildAllParams falhar (ex: nome vazio), envia apenas o essencial
            if (ssid.namePath && typeof ssid.name === 'string' && ssid.name.trim() !== '') {
              const safeName = sanitizeSsidName(ssid.name);
              this.queueChange({ name: ssid.namePath, value: safeName, type: 'xsd:string' });
            }
            if (ssid.hiddenPath && ssid.hidden !== null && ssid.hidden !== undefined) {
              this.queueChange({ name: ssid.hiddenPath, value: ssid.hidden ? 'false' : 'true', type: 'xsd:boolean' });
            }
            if (isDeviceTR181 && ssid.enablePath) {
              this.queueChange({ name: ssid.enablePath, value: 'true', type: 'xsd:boolean' });
            }
          }

          // Security.ModeEnabled e KeyPassphrase AGORA são enviados normalmente
          // (incluídos no buildAllParams acima). O AP 5GHz já está habilitado, então
          // não há risco de Fault 9007. O espelhamento completo (nome + security +
          // senha + configs avançadas) garante que o 5GHz visitante fica idêntico
          // ao 2.4GHz no banco e na CPE.
        }
      }, 0); // setTimeout com 0ms = executa na próxima tick do event loop
    } else {
      // Smart Connect DESATIVADO: adiciona sufixo _5G ao nome dos APs 5GHz habilitados
      // e envia SPV imediatamente para persistir o novo nome no banco/CPE.
      // Antes o nome _5G era aplicado apenas no form — o técnico precisaria clicar
      // "Salvar Rede" em cada card 5GHz para persistir. Isso era confuso e causava
      // perda do sufixo no próximo F5 (populateWifiForm re-lê do banco sem _5G).
      // Agora o SPV é enviado automaticamente junto com BandSteering.Enable=false.
      // Security/senha NÃO são alterados — apenas o nome muda para diferenciar as bandas.
      this.bandSteering.sync(this.ssidsArray.controls as FormGroup[], false);
      this.cdr.markForCheck();

      // Envia SPV com o novo nome (_5G) para cada AP 5GHz habilitado
      const ssids = this.ssidsArray.controls as FormGroup[];
      const ssid5GHzCtrls = ssids.filter(c => c.getRawValue().band === '5GHz');
      for (const ssidCtrl5 of ssid5GHzCtrls) {
        const ssid = ssidCtrl5.getRawValue();
        if (!ssid.enable) continue;  // só envia para APs habilitados

        // Nome do SSID com sufixo _5G (já aplicado no form pelo bandSteering.sync)
        if (ssid.namePath && typeof ssid.name === 'string' && ssid.name.trim() !== '') {
          const safeName = sanitizeSsidName(ssid.name);
          this.queueChange({ name: ssid.namePath, value: safeName, type: 'xsd:string' });
        }
      }
    }
  }

  /**
   * SALVAMENTO MODULAR E ISOLADO POR CARD
   * Usa WifiParameterBuilderService para construir parâmetros TR-069
   */
  saveCard(index: number): void {
    // Guard: bloqueia salvamento durante provisionamento ativo — evita 409 TASK_CONFLICT
    // e corrupção do estado local por optimisticUpdateLocalState concorrente
    if (this.isApplyingWifi) {
      this.toastService.warning('Aguarde a sincronização atual terminar antes de salvar novamente.');
      return;
    }
    const ssidCtrl = this.ssidsArray.at(index) as FormGroup;
    if (ssidCtrl.errors?.['passwordRequired']) {
      this.toastService.error('Configure uma senha antes de salvar: segurança WPA2/WPA3 requer senha.');
      return;
    }
    if (ssidCtrl.invalid) {
      this.toastService.error('Verifique o preenchimento do nome da rede (mín. 1, máx. 32 caracteres).');
      return;
    }

    const ssid = ssidCtrl.getRawValue();

    // Guard: AP deve estar habilitado para salvar
    if (!ssid.enable) {
      this.toastService.warning('SSID desabilitado. Habilite o AP antes de salvar.');
      return;
    }

    // Guard: verifica nomes duplicados no FormArray
    const ssidsErrors = this.ssidsArray.errors;
    if (ssidsErrors?.['duplicateSsidNames']) {
      const names = (ssidsErrors['duplicateSsidNames'].names as string[]).join('", "');
      this.toastService.error(`Nome duplicado detectado: "${names}". Corrija antes de salvar.`);
      return;
    }

    // Estratégia de espelhamento Smart Connect:
    // - Se Smart Connect está desativado: espelha normalmente (bandSteering.sync)
    // - Se Smart Connect está ativo:
    //   - Se salvando AP 2.4GHz (master): espelha para AP 5GHz correspondente
    //   - Se salvando AP 5GHz: NÃO espelha (evita sobrescrever configuração manual)
    if (this.smartConnect && ssid.band === '2.4GHz') {
      this.bandSteering.sync(this.ssidsArray.controls as FormGroup[], true, true, resolveGuestId(ssid));
    } else if (!this.smartConnect) {
      this.bandSteering.sync(this.ssidsArray.controls as FormGroup[], false);
    }

    // Usa WifiParameterBuilderService para construir todos os parâmetros
    const result = this.wifiParamBuilder.buildAllParams(ssidCtrl, this.capabilities);
    if (!result.success) {
      this.toastService.warning(result.error ?? 'Erro ao construir parâmetros.');
      return;
    }

    // Envia todos os parâmetros construídos para o AP source (2.4GHz)
    result.params.forEach(p => this.queueChange(p));

    // ESPELHAMENTO SPV DO PEER 5GHz (Smart Connect ativo, salvando 2.4GHz master):
    // O bandSteering.sync acima já espelhou os valores no form do peer 5GHz.
    // Agora precisamos enviar os parâmetros espelhados para a CPE também —
    // sem isso, o 5GHz fica desatualizado no banco/CPE e o espelhamento visual
    // é perdido no próximo F5 (populateWifiForm re-lê do banco).
    //
    // Guard de Fault 9007: se o peer 5GHz está sendo habilitado agora (era disabled),
    // NÃO envia Security.ModeEnabled nem KeyPassphrase nesta transação — a CPE pode
    // rejeitar com 9007 porque o AP ainda não está estável. Envia apenas enable + name.
    // Se o peer 5GHz já está habilitado, envia security + senha normalmente.
    if (this.smartConnect && ssid.band === '2.4GHz') {
      const peerCtrl = this.findCorrelatedAp(ssid);
      if (peerCtrl) {
        const peerVal = peerCtrl.getRawValue();
        if (peerVal.enable && peerVal.uiVisible) {
          // Peer já habilitado — envia parâmetros completos (security + senha seguros)
          const peerResult = this.wifiParamBuilder.buildAllParams(peerCtrl, this.capabilities);
          if (peerResult.success) {
            peerResult.params.forEach(p => this.queueChange(p));
          }
        } else {
          // Peer está sendo habilitado (era disabled) — envia apenas enable + name
          // Security/senha serão aplicados quando o técnico salvar o card 5GHz
          if (peerVal.enablePath) {
            this.queueChange({ name: peerVal.enablePath, value: 'true', type: 'xsd:boolean' });
          }
          if (peerVal.isTR181 && peerVal.accessPointEnablePath) {
            this.queueChange({ name: peerVal.accessPointEnablePath, value: 'true', type: 'xsd:boolean' });
          }
          if (peerVal.namePath && peerVal.name?.trim()) {
            this.queueChange({ name: peerVal.namePath, value: sanitizeSsidName(peerVal.name), type: 'xsd:string' });
          }
        }
      }
    }

    // Flush imediato: "Salvar Rede" é uma ação explícita do usuário — não deve
    // aguardar o debounce de 2s do batchQueue (que existe para agrupar toggles rápidos).
    if (this.batchQueue.hasPending()) {
      this.flushBatch();
    }
  }

  /**
   * TRANSMISSOR DE SUBMISSÃO E TRAVA DE OPERAÇÃO
   * Valida os parâmetros TR-069 com Zod antes de enviar à API.
   */
  private submitPayloadToNoc(payload: any[]): void {
    if (!payload || payload.length === 0) {
      this.toastService.warning('Nenhuma alteração detectada para enviar.');
      this.unlockScreenAndFinish();
      return;
    }
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
    this.cdr.markForCheck(); // Força atualização imediata da tela de loading em OnPush

    this.cpeService.queueConfig(this.serialNumber, payload).subscribe({
      next: () => {
        this.lastSaveTimestamp = Date.now();

        // Invalida cache SSID local para evitar exibir SSID antigo por 30s
        this.invalidateSsidCache(payload);

        // Invalida cache do CpeService (RAM + sessionStorage) para garantir que
        // após F5 o frontend busque dados atualizados do banco, não cache antigo
        this.cpeService.clearCache(this.serialNumber);

        sessionStorage.setItem(`vmoas_locked_${this.serialNumber}`, 'true');
        this.startProvisioningMonitor();
      },
      error: (err) => {
        // 422: parâmetros rejeitados pelo filtro backend (não suportados pelo modelo/firmware)
        if (err?.status === 422 && err?.error?.error) {
          this.toastService.error(err.error.error);
        } else {
          this.toastService.error('Falha ao registrar micro-transação de rede.');
        }
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

    // Invalida qualquer path que foi enviado no payload — não apenas SSID/senha.
    // Isso garante que hidden, isolation, security mode, ATF, TWT, etc. sejam
    // recarregados do banco na próxima leitura, evitando cache stale.
    payload.forEach((p: any) => {
      if (!p || typeof p.name !== 'string') return;
      const idx = this.cpe?.parametersCache?.findIndex((param: any) => param.name === p.name) ?? -1;
      if (idx !== -1) {
        this.cpe?.parametersCache?.splice(idx, 1);
      }
    });
  }

  private startProvisioningMonitor(): void {
    if (this.monitorInterval) clearTimeout(this.monitorInterval);
    if (this.pollInterval) clearInterval(this.pollInterval);

    // Fallback HTTP: faz polling a cada 3s para detectar quando pendingTasks zerar,
    // independente de WebSocket. O WS ainda é o caminho principal (mais rápido),
    // mas este polling garante que a UI não fique travada se o WS falhar.
    this.pollInterval = setInterval(() => {
      if (!this.isApplyingWifi) {
        clearInterval(this.pollInterval);
        return;
      }
      this.cpeService.getCpeDetails(this.serialNumber, true).subscribe({
        next: (freshData: any) => {
          const pending = freshData?.pendingTasks || [];
          if (pending.length === 0) {
            clearInterval(this.pollInterval);
            this.unlockScreenAndFinish();
            // Invalida cache após confirmação via polling para garantir dados frescos
            this.cpeService.clearCache(this.serialNumber);
            this.cpe = freshData;
            this.populateWifiForm();
          }
        },
        error: () => {
          // Continua tentando; o timeout de 45s abaixo é o limite final.
        }
      });
    }, WIFI_CONSTANTS.POLL_INTERVAL_MS);

    // Timeout de segurança final: se após 45s ainda não conseguimos confirmar,
    // desbloqueia a UI e avisa o técnico.
    this.monitorInterval = setTimeout(() => {
      if (this.isApplyingWifi) {
        clearInterval(this.pollInterval);
        this.toastService.warning('[Timeout] A CPE executou a gravação assíncrona, mas a resposta em tempo real excedeu o limite de segurança.');
        this.unlockScreenAndFinish();
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
          // Invalida cache após rollback para garantir dados frescos
          this.cpeService.clearCache(this.serialNumber);
          this.cpe = freshData;
          this.populateWifiForm();
        },
        error: () => {
          this.populateWifiForm();
          this.cdr.markForCheck();
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
   * Delegado para sanitizeSsidInput (wifi-sanitizer.ts) — função pura reutilizável.
   */
  private sanitizeSsidInput(value: string): string {
    return sanitizeSsidInput(value);
  }

  private unlockScreenAndFinish(): void {
    this.isApplyingWifi = false;
    sessionStorage.removeItem(`vmoas_locked_${this.serialNumber}`);
    if (this.monitorInterval) clearTimeout(this.monitorInterval);
    if (this.pollInterval) clearInterval(this.pollInterval);

    // Se o usuário realizou operações enquanto o spinner rodava, as mudanças não foram perdidas. Serão despachadas agora.
    this.batchQueue.triggerIfPending();
    this.cdr.markForCheck();
  }
}
