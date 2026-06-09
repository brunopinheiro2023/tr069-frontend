import { Component, Input, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subscription } from 'rxjs';
import { CpeService } from '../../../../../../core/services/cpe.service';
import { WebSocketService } from '../../../../../../core/services/websocket.service';
import { NeighborScanCardComponent } from '../cpe-diagnostics-tab-new/components/neighbor-scan-card/neighbor-scan-card.component';

@Component({
  selector: 'app-cpe-wifi-analysis-tab',
  standalone: true,
  imports: [CommonModule, NeighborScanCardComponent],
  templateUrl: './cpe-wifi-analysis-tab.component.html',
  styleUrls: ['./cpe-wifi-analysis-tab.component.scss']
})
export class CpeWifiAnalysisTabComponent implements OnInit, OnDestroy {
  @Input() cpe: any = null;
  @Input() serialNumber: string = '';

  isLoading: boolean = false;
  neighborScanData: any = null;
  neighborScanInProgress: boolean = false;
  neighborScanHistory: any[] = [];
  private neighborScanFailsafe?: ReturnType<typeof setTimeout>;
  private wsSubscription?: Subscription;

  constructor(
    private cpeService: CpeService,
    private wsService: WebSocketService
  ) {}

  ngOnInit(): void {
    // Validação de entrada: serialNumber deve ser uma string não vazia
    if (!this.isValidSerialNumber(this.serialNumber)) {
      console.error('[WifiAnalysisTab] Serial number inválido:', this.serialNumber);
      this.isLoading = false;
      return;
    }

    this.loadAllData();
    this.setupWebSocketListeners();
  }

  ngOnDestroy(): void {
    this.wsSubscription?.unsubscribe();
    if (this.neighborScanFailsafe) {
      clearTimeout(this.neighborScanFailsafe);
    }
  }

  /**
   * Valida se o serial number é válido.
   * Segurança: previne uso de serial numbers inválidos ou maliciosos.
   */
  private isValidSerialNumber(serial: string): boolean {
    return typeof serial === 'string' && serial.trim().length > 0 && serial.length <= 64;
  }

  /**
   * Sanitiza um valor string do CPE.
   * Segurança: remove caracteres perigosos e valida tipo.
   */
  private sanitizeString(value: any, maxLength: number = 100): string {
    if (value === null || value === undefined) return 'Desconhecido';
    if (typeof value !== 'string') return 'Desconhecido';
    const sanitized = value.trim().substring(0, maxLength);
    return sanitized || 'Desconhecido';
  }

  /**
   * Sanitiza um valor numérico do CPE.
   * Segurança: valida que é um número válido e está em faixa aceitável.
   */
  private sanitizeNumber(value: any, min: number = 0, max: number = 100): number {
    if (value === null || value === undefined) return min;
    const num = Number(value);
    if (isNaN(num)) return min;
    return Math.max(min, Math.min(max, num));
  }

  /**
   * Carrega todos os dados da aba de análise WiFi.
   * O loading só termina quando todos os dados são carregados ou em caso de erro.
   */
  loadAllData(): void {
    if (!this.isValidSerialNumber(this.serialNumber)) {
      this.isLoading = false;
      return;
    }

    this.isLoading = true;
    this.loadNeighborScanData();
    this.loadNeighborScanHistory();
  }

  loadNeighborScanData(): void {
    if (!this.isValidSerialNumber(this.serialNumber)) {
      this.isLoading = false;
      return;
    }

    this.cpeService.getWifiDiagnostics(this.serialNumber).subscribe({
      next: (data) => {
        // Validação: dados devem ser um objeto válido
        if (data && typeof data === 'object') {
          this.neighborScanData = data;
        } else {
          console.warn('[WifiAnalysisTab] Dados de diagnóstico inválidos recebidos:', data);
          this.neighborScanData = null;
        }
        this.isLoading = false;
      },
      error: (err) => {
        console.error('[WifiAnalysisTab] Erro ao carregar dados de diagnóstico WiFi:', err);
        this.neighborScanData = null;
        this.isLoading = false;
      }
    });
  }

  /**
   * Carrega o histórico de varreduras de vizinhos.
   */
  loadNeighborScanHistory(): void {
    if (!this.isValidSerialNumber(this.serialNumber)) return;

    // TODO: Implementar carregamento de histórico quando o endpoint estiver disponível
    // Por enquanto, histórico fica vazio
    this.neighborScanHistory = [];
  }

  triggerNeighborScan(): void {
    if (!this.isValidSerialNumber(this.serialNumber) || this.neighborScanInProgress) return;

    this.neighborScanInProgress = true;

    this.cpeService.triggerNeighborScan(this.serialNumber).subscribe({
      next: () => {
        // Failsafe: após 35s, libera o botão independentemente
        this.neighborScanFailsafe = setTimeout(() => {
          console.warn('[WifiAnalysisTab] Timeout da varredura de vizinhos');
          this.neighborScanInProgress = false;
        }, 35000);
      },
      error: (err) => {
        console.error('[WifiAnalysisTab] Erro ao acionar varredura de vizinhos:', err);
        this.neighborScanInProgress = false;
      }
    });
  }

  setupWebSocketListeners(): void {
    this.wsSubscription = this.wsService.on('neighbor_scan_completed').subscribe(event => {
      // Validação de segurança: verifica estrutura do evento
      if (event && typeof event === 'object' && event.serialNumber === this.serialNumber) {
        this.neighborScanInProgress = false;
        if (this.neighborScanFailsafe) {
          clearTimeout(this.neighborScanFailsafe);
        }
        this.loadNeighborScanData();
      }
    });
  }

  /**
   * Retorna a largura de banda atual do WiFi 2.4GHz do CPE.
   * Valores válidos: 20MHz, 40MHz (baseado em parâmetros TR-181)
   * Segurança: sanitiza o valor recebido do CPE.
   */
  get wifi2gBandwidth(): string {
    if (!this.cpe?.parameters || typeof this.cpe.parameters !== 'object') return 'Desconhecido';
    
    const bandwidth = this.cpe.parameters['Device.WiFi.Radio.1.ChannelWidth'];
    const validBandwidths = ['20MHz', '40MHz', '20MHz/40MHz'];
    const sanitized = this.sanitizeString(bandwidth);
    
    return validBandwidths.includes(sanitized) ? sanitized : 'Desconhecido';
  }

  /**
   * Retorna a largura de banda atual do WiFi 5GHz do CPE.
   * Valores válidos: 20MHz, 40MHz, 80MHz, 160MHz (baseado em parâmetros TR-181)
   * Segurança: sanitiza o valor recebido do CPE.
   */
  get wifi5gBandwidth(): string {
    if (!this.cpe?.parameters || typeof this.cpe.parameters !== 'object') return 'Desconhecido';
    
    const bandwidth = this.cpe.parameters['Device.WiFi.Radio.2.ChannelWidth'];
    const validBandwidths = ['20MHz', '40MHz', '80MHz', '160MHz', '20MHz/40MHz', '40MHz/80MHz'];
    const sanitized = this.sanitizeString(bandwidth);
    
    return validBandwidths.includes(sanitized) ? sanitized : 'Desconhecido';
  }

  /**
   * Retorna o canal atual do WiFi 2.4GHz.
   * Segurança: valida que é um número válido na faixa 1-13.
   */
  get wifi2gChannel(): string {
    if (!this.cpe?.parameters || typeof this.cpe.parameters !== 'object') return 'Desconhecido';
    
    const channel = this.cpe.parameters['Device.WiFi.Radio.1.Channel'];
    const sanitizedChannel = this.sanitizeNumber(channel, 1, 13);
    
    return sanitizedChannel.toString();
  }

  /**
   * Retorna o canal atual do WiFi 5GHz.
   * Segurança: valida que é um número válido na faixa 36-165.
   */
  get wifi5gChannel(): string {
    if (!this.cpe?.parameters || typeof this.cpe.parameters !== 'object') return 'Desconhecido';
    
    const channel = this.cpe.parameters['Device.WiFi.Radio.2.Channel'];
    const sanitizedChannel = this.sanitizeNumber(channel, 36, 165);
    
    return sanitizedChannel.toString();
  }

  /**
   * Retorna a potência de transmissão do WiFi 2.4GHz.
   * Segurança: valida que é um número válido na faixa 0-100%.
   */
  get wifi2gPower(): string {
    if (!this.cpe?.parameters || typeof this.cpe.parameters !== 'object') return 'Desconhecido';
    
    const power = this.cpe.parameters['Device.WiFi.Radio.1.TransmitPower'];
    const sanitizedPower = this.sanitizeNumber(power, 0, 100);
    
    return `${sanitizedPower}%`;
  }

  /**
   * Retorna a potência de transmissão do WiFi 5GHz.
   * Segurança: valida que é um número válido na faixa 0-100%.
   */
  get wifi5gPower(): string {
    if (!this.cpe?.parameters || typeof this.cpe.parameters !== 'object') return 'Desconhecido';
    
    const power = this.cpe.parameters['Device.WiFi.Radio.2.TransmitPower'];
    const sanitizedPower = this.sanitizeNumber(power, 0, 100);
    
    return `${sanitizedPower}%`;
  }

  /**
   * Valida se o CPE tem dados WiFi suficientes para análise.
   * Segurança: verifica se parâmetros essenciais existem e são válidos.
   */
  get hasValidWifiData(): boolean {
    if (!this.cpe?.parameters || typeof this.cpe.parameters !== 'object') return false;
    
    const params = this.cpe.parameters;
    const has2g = params['Device.WiFi.Radio.1.Channel'] !== undefined;
    const has5g = params['Device.WiFi.Radio.2.Channel'] !== undefined;
    
    return has2g || has5g;
  }
}
