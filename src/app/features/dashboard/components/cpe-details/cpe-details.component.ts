import {
  Component,
  OnInit,
  OnDestroy,
  ChangeDetectorRef,
  ChangeDetectionStrategy,
  inject,
  DestroyRef,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { Subscription, interval } from 'rxjs';
import { filter } from 'rxjs/operators';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CpeService } from '../../../../core/services/cpe.service';
import { WebSocketService } from '../../../../core/services/websocket.service';
import { ToastService } from '../../../../core/services/toast.service';
import { DataAgePipe } from '../../../../core/pipes/data-age.pipe';
import { CpeDevice } from '../../../../core/models';

// IMPORTAÇÃO DOS FILHOS STANDALONE
import { CpeInfoTabComponent } from './components/cpe-info-tab/cpe-info-tab.component';
import { CpeWifiTabComponent } from './components/cpe-wifi-tab/cpe-wifi-tab.component';
import { CpeRadioTabComponent } from './components/cpe-radio-tab/cpe-radio-tab.component';
import { CpeDevicesTabComponent } from './components/cpe-devices-tab/cpe-devices-tab.component';
import { CpeDiagnosticsTabNewComponent } from './components/cpe-diagnostics-tab-new/cpe-diagnostics-tab-new.component';
import { CpeWifiAnalysisTabComponent } from './components/cpe-wifi-analysis-tab/cpe-wifi-analysis-tab.component';
import { CpeAiTabComponent } from './components/cpe-ai-tab/cpe-ai-tab.component';
import { CpePeriodicDiagnosticsTabComponent } from './components/cpe-periodic-diagnostics-tab/cpe-periodic-diagnostics-tab.component';
import { ButtonComponent } from '../../../../core/components/button/button.component';
import { SkeletonComponent } from '../../../../core/components/skeleton/skeleton.component';

@Component({
  selector: 'app-cpe-details',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  // REGISTRO DOS FILHOS NO ARRAY DE IMPORTS
  imports: [
    CommonModule,
    CpeInfoTabComponent,
    CpeWifiTabComponent,
    CpeRadioTabComponent,
    CpeDevicesTabComponent,
    CpeDiagnosticsTabNewComponent,
    CpeWifiAnalysisTabComponent,
    CpeAiTabComponent,
    CpePeriodicDiagnosticsTabComponent,
    ButtonComponent,
    SkeletonComponent,
    DataAgePipe,
  ],
  templateUrl: './cpe-details.component.html',
  styleUrls: ['./cpe-details.component.scss'],
})
export class CpeDetailsComponent implements OnInit, OnDestroy {
  serialNumber: string = '';
  cpe: CpeDevice | null = null;
  isLoading: boolean = true;
  error: string | null = null;

  // Aba ativa na navegação
  activeTab:
    | 'info'
    | 'wifi'
    | 'radio'
    | 'devices'
    | 'diagnostics'
    | 'wifi-analysis'
    | 'ai'
    | 'periodic-diagnostics' = 'info';
  private wsSubscriptions = new Subscription();

  // LOCK-1: Sistema de lock entre técnicos — centralizado no componente pai.
  // Antes apenas cpe-info-tab tinha. Agora todas as tabs recebem via @Input.
  isViewOnly = false; // Se true, usuário está em modo de visualização (não é Driver)
  isCpeBusy = false; // Se true, CPE está em tráfego CWMP ativo (botões bloqueados)
  viewers: string[] = []; // Lista de usernames visualizando a CPE
  private destroyRef = inject(DestroyRef);
  private readonly HEARTBEAT_INTERVAL_MS = 30_000;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private cpeService: CpeService,
    private wsService: WebSocketService,
    private toastService: ToastService,
    private cdr: ChangeDetectorRef,
  ) {}

  setActiveTab(
    tab:
      | 'info'
      | 'wifi'
      | 'radio'
      | 'devices'
      | 'diagnostics'
      | 'wifi-analysis'
      | 'ai'
      | 'periodic-diagnostics',
  ): void {
    this.activeTab = tab;
  }

  /**
   * Retry de carregamento de tab que falhou no @defer lazy loading.
   * Alterna para uma tab inexistente e volta para forçar re-render do @defer.
   */
  retryTab(tab: typeof this.activeTab): void {
    const current = this.activeTab;
    this.activeTab = 'info'; // tab temporária para desmontar a que falhou
    this.cdr.markForCheck();
    setTimeout(() => {
      this.activeTab = tab;
      this.cdr.markForCheck();
    }, 50);
  }

  goToDiagnostics(): void {
    // Ativa a tab de diagnóstico internamente (não navega para rota inexistente)
    this.setActiveTab('diagnostics');
  }

  ngOnInit(): void {
    this.serialNumber = this.route.snapshot.paramMap.get('serial') || '';
    if (!this.serialNumber) {
      this.goBack();
      return;
    }

    // Lê query param 'tab' para ativar a aba solicitada pelo dashboard
    const requestedTab = this.route.snapshot.queryParamMap.get('tab');
    const validTabs: (typeof this.activeTab)[] = [
      'info',
      'wifi',
      'radio',
      'devices',
      'diagnostics',
      'wifi-analysis',
      'ai',
      'periodic-diagnostics',
    ];
    if (
      requestedTab &&
      validTabs.includes(requestedTab as typeof this.activeTab)
    ) {
      this.activeTab = requestedTab as typeof this.activeTab;
    }

    // Inscreve-se na sala da CPE. O WebSocketService enfileira a inscrição se ainda
    // não estiver conectado e a envia automaticamente quando o socket conectar.
    if (this.serialNumber) {
      this.wsService.subscribeToCpe(this.serialNumber);
    }

    this.loadCpeDetails();
    this.setupRealTimeUpdates();
    this.listenForPresenceEvents();
    this.startHeartbeat();
  }

  ngOnDestroy(): void {
    this.wsSubscriptions.unsubscribe();
    this.wsService.unsubscribeFromCpe(this.serialNumber);
  }

  loadCpeDetails(): void {
    this.isLoading = true;
    this.cpeService.getCpeDetails(this.serialNumber).subscribe({
      next: (data) => {
        this.cpe = this.normalizeLegacyFields(data);
        this.isLoading = false;
        this.cdr.markForCheck();
      },
      error: () => {
        this.error = 'Não foi possível carregar os dados desta CPE.';
        this.isLoading = false;
        this.cdr.markForCheck();
      },
    });
  }

  setupRealTimeUpdates(): void {
    // cpe_updated: sincroniza dados gerais
    this.wsSubscriptions.add(
      this.wsService.onCpeUpdated().subscribe((updatedCpe) => {
        if (updatedCpe.serialNumber === this.serialNumber) {
          const merged = this.cpe
            ? this.mergeCpe(this.cpe, updatedCpe)
            : (updatedCpe as CpeDevice);
          this.cpe = this.normalizeLegacyFields(merged);
          this.cdr.markForCheck();
        }
      }),
    );

    // cpe_value_change: notifica o técnico sobre mudanças ativas (VALUE CHANGE)
    this.wsSubscriptions.add(
      this.wsService.onCpeValueChange().subscribe((event) => {
        if (event.serialNumber !== this.serialNumber) return;
        const typeLabel: Record<string, string> = {
          host_change: 'Dispositivos conectados mudaram',
          wan_change: 'Status da WAN alterado',
          gpon_change: 'Sinal óptico alterado',
          wifi_change: 'Configuração Wi-Fi alterada',
          generic_change: 'Parâmetro alterado',
        };
        const label = typeLabel[event.changeType] || 'Parâmetro alterado';
        this.toastService.info(`${label} na CPE ${this.serialNumber}`);
        this.cdr.markForCheck();
      }),
    );

    // config_success: feedback positivo ao técnico
    this.wsSubscriptions.add(
      this.wsService.on('config_success').subscribe((ev) => {
        if (ev.serialNumber === this.serialNumber) {
          this.toastService.success(
            ev.message || 'Configuração aplicada com sucesso!',
          );
          this.cdr.markForCheck();
        }
      }),
    );

    // config_error: feedback de rejeição pela CPE
    this.wsSubscriptions.add(
      this.wsService.on('config_error').subscribe((ev) => {
        if (ev.serialNumber === this.serialNumber) {
          this.toastService.error(ev.message || 'CPE rejeitou a configuração.');
          this.cdr.markForCheck();
        }
      }),
    );

    // cpe_batch_update: durante mass reboot, a CPE sendo visualizada pode estar no array
    // Busca pelo serialNumber e faz merge profundo para preservar arrays/objetos aninhados.
    this.wsSubscriptions.add(
      this.wsService.onCpeBatchUpdate().subscribe((batch) => {
        const item = batch.items.find(
          (i: any) => i.serialNumber === this.serialNumber,
        );
        if (!item) return;
        const mergedBatch = this.cpe
          ? this.mergeCpe(this.cpe, item)
          : (item as CpeDevice);
        this.cpe = this.normalizeLegacyFields(mergedBatch);
        if (batch.eventName === 'cpe_online') this.cpe!.isOnline = true;
        this.cdr.markForCheck();
      }),
    );
  }

  /**
   * Normaliza campos legados (wanIp, softwareVersion, productClass, etc.) a partir
   * do novo schema EP 28 (wan.ip, deviceInfo.softwareVersion, etc.).
   *
   * Necessário porque a API retorna apenas o novo schema, mas vários templates
   * (cpe-details.component.html, cpe-info-tab loadWanConfig) ainda referenciam
   * campos legados via interpolação direta (cpe.wanIp, cpe.softwareVersion).
   *
   * Padrão seguido: dashboard.component.ts linhas 1252-1265 (normalizeCpeForWorker).
   * Compatível com ambos os schemas — só popula o legacy field se ele estiver vazio.
   */
  private normalizeLegacyFields(cpe: CpeDevice): CpeDevice {
    if (!cpe) return cpe;
    const di = cpe.deviceInfo;
    const wan = cpe.wan;
    // Usa cast any para atribuir campos legados sem erros TS strict
    const normalized = cpe as any;
    if (!normalized.wanIp && wan?.ip) normalized.wanIp = wan.ip;
    if (!normalized.wanGateway && wan?.gateway)
      normalized.wanGateway = wan.gateway;
    if (!normalized.wanDnsIsp && wan?.dnsIsp) normalized.wanDnsIsp = wan.dnsIsp;
    if (!normalized.wanMtu && wan?.mtu) normalized.wanMtu = wan.mtu;
    if (!normalized.wanVlanId && wan?.vlanId) normalized.wanVlanId = wan.vlanId;
    if (!normalized.wanSubnetMask && wan?.subnetMask)
      normalized.wanSubnetMask = wan.subnetMask;
    if (!normalized.pppoeUsername && wan?.pppoeUsername)
      normalized.pppoeUsername = wan.pppoeUsername;
    if (!normalized.wanConfigUpdatedAt && wan?.updatedAt)
      normalized.wanConfigUpdatedAt = wan.updatedAt;
    if (!normalized.productClass && di?.productClass)
      normalized.productClass = di.productClass;
    if (!normalized.manufacturer && di?.manufacturer)
      normalized.manufacturer = di.manufacturer;
    if (!normalized.softwareVersion && di?.softwareVersion)
      normalized.softwareVersion = di.softwareVersion;
    if (!normalized.hardwareVersion && di?.hardwareVersion)
      normalized.hardwareVersion = di.hardwareVersion;
    if (
      !normalized.connectionRequestURL &&
      cpe.management?.connectionRequestURL
    ) {
      normalized.connectionRequestURL = cpe.management.connectionRequestURL;
    }
    return normalized as CpeDevice;
  }

  /**
   * Merge profundo entre o estado atual da CPE e um update parcial vindo do WebSocket.
   * Arrays são substituídos (não mergeados) para evitar duplicatas e estados inconsistentes.
   */
  private mergeCpe(target: CpeDevice, source: Partial<CpeDevice>): CpeDevice {
    if (!source) return target;
    // Usa Record<string, unknown> para evitar erros TS strict em atribuições dinâmicas por chave.
    const result = { ...target } as Record<string, unknown>;
    for (const key of Object.keys(source)) {
      const s = (source as Record<string, unknown>)[key];
      const t = result[key];
      if (Array.isArray(s)) {
        result[key] = s;
      } else if (s && typeof s === 'object' && t && typeof t === 'object') {
        result[key] = this.mergeCpe(t as CpeDevice, s as Partial<CpeDevice>);
      } else if (s !== undefined) {
        result[key] = s;
      }
    }
    return result as unknown as CpeDevice;
  }

  /**
   * LOCK-1: Escuta eventos de presença Single Driver — centralizado no componente pai.
   * Replicado do cpe-info-tab (linhas 1488-1579) para que todas as tabs recebam o estado.
   */
  private listenForPresenceEvents(): void {
    this.wsService
      .onDriverAcquired()
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        filter((event) => event.serialNumber === this.serialNumber),
      )
      .subscribe(() => {
        this.isViewOnly = false;
        this.cdr.markForCheck();
      });

    this.wsService
      .onViewOnly()
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        filter((event) => event.serialNumber === this.serialNumber),
      )
      .subscribe((event) => this.handleViewOnlyEvent(event));

    this.wsService
      .onForceViewOnly()
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        filter((event) => event.serialNumber === this.serialNumber),
      )
      .subscribe((event) => this.handleViewOnlyEvent(event));

    this.wsService
      .onDriverReleased()
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        filter((event) => event.serialNumber === this.serialNumber),
      )
      .subscribe(() => {
        this.isViewOnly = false;
        this.cdr.markForCheck();
      });

    this.wsService
      .onViewersUpdated()
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        filter((event) => event.serialNumber === this.serialNumber),
      )
      .subscribe((event) => {
        this.viewers = event.viewers;
        this.cdr.markForCheck();
      });

    this.wsService
      .onCpeLocked()
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        filter((event) => event.serialNumber === this.serialNumber),
      )
      .subscribe(() => {
        this.isCpeBusy = true;
        this.cdr.markForCheck();
      });

    this.wsService
      .onCpeUnlocked()
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        filter((event) => event.serialNumber === this.serialNumber),
      )
      .subscribe(() => {
        this.isCpeBusy = false;
        this.cdr.markForCheck();
      });
  }

  /** Helper compartilhado para eventos ViewOnly (elimina duplicação de código) */
  private handleViewOnlyEvent(event: {
    serialNumber: string;
    driver?: string;
    message: string;
  }): void {
    this.isViewOnly = true;
    this.toastService.warning(event.message);
    this.cdr.markForCheck();
  }

  /** Inicia ciclo de heartbeat para manter controle de Driver no Redis (TTL renovado a cada 30s) */
  private startHeartbeat(): void {
    if (!this.serialNumber) return;
    interval(this.HEARTBEAT_INTERVAL_MS)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        filter(() => this.wsService.isConnected),
      )
      .subscribe(() => {
        try {
          this.wsService.emitDriverKeepalive(this.serialNumber);
        } catch (e) {
          console.error('Erro ao emitir keepalive', e);
        }
      });
  }

  goBack(): void {
    this.router.navigate(['/dashboard']);
  }
}
