import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { Subscription } from 'rxjs';
import { CpeService } from '../../../../core/services/cpe.service';
import { WebSocketService } from '../../../../core/services/websocket.service';
import { ToastService } from '../../../../core/services/toast.service';
import { DataAgePipe } from '../../../../core/pipes/data-age.pipe';

// IMPORTAÇÃO DOS FILHOS STANDALONE
import { CpeInfoTabComponent } from './components/cpe-info-tab/cpe-info-tab.component';
import { CpeWifiTabComponent } from './components/cpe-wifi-tab/cpe-wifi-tab.component';
import { CpeRadioTabComponent } from './components/cpe-radio-tab/cpe-radio-tab.component';
import { CpeDevicesTabComponent } from './components/cpe-devices-tab/cpe-devices-tab.component';
import { CpeDiagnosticsTabNewComponent } from './components/cpe-diagnostics-tab-new/cpe-diagnostics-tab-new.component';
import { CpeWifiAnalysisTabComponent } from './components/cpe-wifi-analysis-tab/cpe-wifi-analysis-tab.component';
import { CpeAiTabComponent } from './components/cpe-ai-tab/cpe-ai-tab.component';
import { ButtonComponent } from '../../../../core/components/button/button.component';
import { SkeletonComponent } from '../../../../core/components/skeleton/skeleton.component';
import { CpeDevice } from '../../../../core/models';

@Component({
  selector: 'app-cpe-details',
  standalone: true,
  // REGISTRO DOS FILHOS NO ARRAY DE IMPORTS
  imports: [CommonModule, CpeInfoTabComponent, CpeWifiTabComponent, CpeRadioTabComponent, CpeDevicesTabComponent, CpeDiagnosticsTabNewComponent, CpeWifiAnalysisTabComponent, CpeAiTabComponent, ButtonComponent, SkeletonComponent, DataAgePipe],
  templateUrl: './cpe-details.component.html',
  styleUrls: ['./cpe-details.component.scss']
})
export class CpeDetailsComponent implements OnInit, OnDestroy {
  serialNumber: string = '';
  cpe: CpeDevice | null = null;
  isLoading: boolean = true;
  error: string | null = null;

  // Aba ativa na navegação
  activeTab: 'info' | 'wifi' | 'radio' | 'devices' | 'diagnostics' | 'wifi-analysis' | 'ai' = 'info';
  private wsSubscriptions = new Subscription();

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private cpeService: CpeService,
    private wsService: WebSocketService,
    private toastService: ToastService,
    private cdr: ChangeDetectorRef
  ) {}

  setActiveTab(tab: 'info' | 'wifi' | 'radio' | 'devices' | 'diagnostics' | 'wifi-analysis' | 'ai'): void {
    this.activeTab = tab;
  }

  goToDiagnostics(): void {
    this.router.navigate(['/dashboard/cpe', this.serialNumber, 'diagnostics']);
  }

  ngOnInit(): void {
    this.serialNumber = this.route.snapshot.paramMap.get('serial') || '';
    if (!this.serialNumber) {
      this.goBack();
      return;
    }
    
    // ── Garante que o Angular só se inscreve na CPE se houver conexão estabelecida E se já não estiver inscrito ──
    if (this.wsService['socket']?.connected && this.serialNumber) {
      this.wsService.subscribeToCpe(this.serialNumber);
    }
    
    this.loadCpeDetails();
    this.setupRealTimeUpdates();
  }

  ngOnDestroy(): void {
    this.wsSubscriptions.unsubscribe();
    this.wsService.unsubscribeFromCpe(this.serialNumber);
  }

  loadCpeDetails(): void {
    this.isLoading = true;
    this.cpeService.getCpeDetails(this.serialNumber).subscribe({
      next: (data) => {
        this.cpe = data;
        this.isLoading = false;
        this.cdr.markForCheck();
      },
      error: () => {
        this.error = 'Não foi possível carregar os dados desta CPE.';
        this.isLoading = false;
        this.cdr.markForCheck();
      }
    });
  }

  setupRealTimeUpdates(): void {
    // cpe_updated: sincroniza dados gerais
    this.wsSubscriptions.add(
      this.wsService.onCpeUpdated().subscribe(updatedCpe => {
        if (updatedCpe.serialNumber === this.serialNumber) {
          this.cpe = this.cpe ? { ...this.cpe, ...updatedCpe } : updatedCpe;
          this.cdr.markForCheck();
        }
      })
    );

    // cpe_value_change: notifica o técnico sobre mudanças ativas (VALUE CHANGE)
    this.wsSubscriptions.add(
      this.wsService.onCpeValueChange().subscribe(event => {
        if (event.serialNumber !== this.serialNumber) return;
        const typeLabel: Record<string, string> = {
          host_change:    'Dispositivos conectados mudaram',
          wan_change:     'Status da WAN alterado',
          gpon_change:    'Sinal óptico alterado',
          wifi_change:    'Configuração Wi-Fi alterada',
          generic_change: 'Parâmetro alterado',

        };
        const label = typeLabel[event.changeType] || 'Parâmetro alterado';
        this.toastService.info(`${label} na CPE ${this.serialNumber}`);
        this.cdr.markForCheck();
      })
    );

    // config_success: feedback positivo ao técnico
    this.wsSubscriptions.add(
      this.wsService.on('config_success').subscribe(ev => {
        if (ev.serialNumber === this.serialNumber) {
          this.toastService.success(ev.message || 'Configuração aplicada com sucesso!');
          this.cdr.markForCheck();
        }
      })
    );

    // config_error: feedback de rejeição pela CPE
    this.wsSubscriptions.add(
      this.wsService.on('config_error').subscribe(ev => {
        if (ev.serialNumber === this.serialNumber) {
          this.toastService.error(ev.message || 'CPE rejeitou a configuração.');
          this.cdr.markForCheck();
        }
      })
    );

    // cpe_batch_update: durante mass reboot, a CPE sendo visualizada pode estar no array
    // Busca pelo serialNumber e faz merge idêntico ao que faria o cpe_updated individual
    this.wsSubscriptions.add(
      this.wsService.onCpeBatchUpdate().subscribe(batch => {
        const item = batch.items.find((i: any) => i.serialNumber === this.serialNumber);
        if (!item) return;
        this.cpe = this.cpe ? { ...this.cpe, ...item } : item;
        if (batch.eventName === 'cpe_online') this.cpe!.isOnline = true;
        this.cdr.markForCheck();
      })
    );
  }

  goBack(): void {
    this.router.navigate(['/dashboard']);
  }
}
