import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ButtonComponent } from '@app/core/components/button/button.component';
import { NgChartsModule } from 'ng2-charts';
import { ChartConfiguration } from 'chart.js';

export interface UDPEchoResult {
  packetsReceived?: number;
  packetsResponded?: number;
  bytesReceived?: number;
  sourceIP?: string;
  diagnosticsState?: string;
}

@Component({
  selector: 'app-udp-echo-card',
  standalone: true,
  imports: [CommonModule, ButtonComponent, NgChartsModule],
  templateUrl: './udp-echo-card.component.html',
  styleUrls: ['./udp-echo-card.component.scss']
})
export class UDPEchoCardComponent {
  @Input() serialNumber: string = '';
  @Input() readOnly: boolean = false;
  @Input() isSupported: boolean = true;
  @Input() isRunning: boolean = false;
  @Input() result: UDPEchoResult | null = null;
  @Input() history: any[] = [];
  @Input() udpPort: number = 7;
  @Input() sourceIPAddress: string = '';

  @Output() udpPortChange = new EventEmitter<number>();
  @Output() sourceIPAddressChange = new EventEmitter<string>();
  @Output() runUDPEcho = new EventEmitter<{ udpPort: number; sourceIPAddress: string }>();

  // Configuração do gráfico de histórico
  public lineChartData: ChartConfiguration<'line'>['data'] = {
    labels: [],
    datasets: [
      {
        data: [],
        label: 'Pacotes Recebidos',
        borderColor: '#ec4899',
        backgroundColor: 'rgba(236, 72, 153, 0.1)',
        tension: 0.3,
        fill: true
      }
    ]
  };

  public lineChartOptions: ChartConfiguration<'line'>['options'] = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: false
      }
    },
    scales: {
      y: {
        beginAtZero: true,
        title: {
          display: true,
          text: 'Pacotes Recebidos'
        }
      }
    }
  };

  // Atualiza o gráfico quando o histórico mudar
  ngOnChanges(): void {
    this.updateChart();
  }

  private updateChart(): void {
    if (!this.history || this.history.length === 0) return;

    // Ordena histórico por timestamp (mais recente primeiro)
    const sortedHistory = [...this.history].sort((a, b) => 
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    ).reverse();

    // Extrai labels (datas) e dados (pacotes recebidos)
    this.lineChartData.labels = sortedHistory.map(h => {
      const date = new Date(h.timestamp);
      return date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    });

    this.lineChartData.datasets[0].data = sortedHistory.map(h => h.results?.packetsReceived || 0);
  }

  onUdpPortChange(value: string): void {
    this.udpPort = parseInt(value, 10);
    this.udpPortChange.emit(this.udpPort);
  }

  onSourceIPAddressChange(value: string): void {
    this.sourceIPAddress = value;
    this.sourceIPAddressChange.emit(value);
  }

  onRunUDPEcho(): void {
    this.runUDPEcho.emit({
      udpPort: this.udpPort,
      sourceIPAddress: this.sourceIPAddress
    });
  }

  /** Timestamp do diagnóstico mais recente (history[0] = mais recente, ordenado pelo backend). */
  get lastRunTimestamp(): string {
    const ts = this.history?.[0]?.timestamp;
    return typeof ts === 'string' && ts.length > 0 ? ts : '';
  }

  /** Formata timestamp ISO para exibição pt-BR. Segue padrão do neighbor-scan-card. */
  formatTimestamp(timestamp: string): string {
    if (!timestamp || typeof timestamp !== 'string') return '';
    try {
      const date = new Date(timestamp);
      if (isNaN(date.getTime())) return '';
      return date.toLocaleString('pt-BR');
    } catch {
      return '';
    }
  }

  formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    const v = bytes / Math.pow(k, i);
    return `${v.toFixed(2)} ${sizes[i]}`;
  }
}
