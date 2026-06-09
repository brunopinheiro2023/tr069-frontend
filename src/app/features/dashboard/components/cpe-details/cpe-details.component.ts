import { Component, OnInit, OnDestroy } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { Subscription } from 'rxjs';
import { CpeService } from '../../../../core/services/cpe.service';
import { WebSocketService } from '../../../../core/services/websocket.service';
import { ToastService } from '../../../../core/services/toast.service';

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
  imports: [CommonModule, CpeInfoTabComponent, CpeWifiTabComponent, CpeRadioTabComponent, CpeDevicesTabComponent, CpeDiagnosticsTabNewComponent, CpeWifiAnalysisTabComponent, CpeAiTabComponent, ButtonComponent, SkeletonComponent],
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
  ) {}

  setActiveTab(tab: 'info' | 'wifi' | 'radio' | 'devices' | 'diagnostics' | 'wifi-analysis' | 'ai'): void {
    // Limpa a fila de requisições pendentes da CPE ao trocar de aba,
    // evitando acúmulo de requisições obsoletas quando o técnico navega.
    if (this.serialNumber) {
      this.cpeService.clearPendingTasks(this.serialNumber).subscribe({
        error: () => { /* silencioso: não exibe erro se a CPE não tiver fila */ }
      });
    }
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
      },
      error: () => {
        this.error = 'Não foi possível carregar os dados desta CPE.';
        this.isLoading = false;
      }
    });
  }

  setupRealTimeUpdates(): void {
    // Entra na sala da CPE para receber eventos específicos desta CPE
    this.wsService.subscribeToCpe(this.serialNumber);

    // cpe_updated: sincroniza dados gerais
    this.wsSubscriptions.add(
      this.wsService.onCpeUpdated().subscribe(updatedCpe => {
        if (updatedCpe.serialNumber === this.serialNumber) {
          this.cpe = this.cpe ? { ...this.cpe, ...updatedCpe } : updatedCpe;
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
      })
    );

    // config_success: feedback positivo ao técnico
    this.wsSubscriptions.add(
      this.wsService.on('config_success').subscribe(ev => {
        if (ev.serialNumber === this.serialNumber) {
          this.toastService.success(ev.message || 'Configuração aplicada com sucesso!');
        }
      })
    );

    // config_error: feedback de rejeição pela CPE
    this.wsSubscriptions.add(
      this.wsService.on('config_error').subscribe(ev => {
        if (ev.serialNumber === this.serialNumber) {
          this.toastService.error(ev.message || 'CPE rejeitou a configuração.');
        }
      })
    );
  }

  goBack(): void {
    this.router.navigate(['/dashboard']);
  }

  wakeUp(): void {
    this.cpeService.wakeUpCpe(this.serialNumber).subscribe({
      next: () => this.toastService.success('Connection Request enviado com sucesso!'),
      error: () => this.toastService.error('Erro ao acordar a CPE.'),
    });
  }
}
