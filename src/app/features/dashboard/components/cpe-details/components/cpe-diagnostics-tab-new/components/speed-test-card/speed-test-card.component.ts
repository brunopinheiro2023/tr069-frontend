import { Component, Input, Output, EventEmitter, OnChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ButtonComponent } from '@app/core/components/button/button.component';
import { NgChartsModule } from 'ng2-charts';
import { ChartConfiguration } from 'chart.js';

export interface SpeedTestResult {
  throughput?: number;
  bytes?: number;
  duration?: number;
  diagnosticsState?: string;
}

@Component({
  selector: 'app-speed-test-card',
  standalone: true,
  imports: [CommonModule, ButtonComponent, NgChartsModule],
  templateUrl: './speed-test-card.component.html',
  styleUrls: ['./speed-test-card.component.scss']
})
export class SpeedTestCardComponent implements OnChanges {
  @Input() serialNumber: string = '';
  @Input() readOnly: boolean = false;
  @Input() isSupported: boolean = true;
  @Input() isRunning: boolean = false;
  @Input() result: SpeedTestResult | null = null;
  @Input() history: any[] = [];
  @Input() direction: 'download' | 'upload' = 'download';
  @Input() url: string = '';
  @Input() connections: number = 1;
  @Input() errorState: string | null = null;

  @Output() directionChange = new EventEmitter<'download' | 'upload'>();
  @Output() urlChange = new EventEmitter<string>();
  @Output() connectionsChange = new EventEmitter<number>();
  @Output() runSpeedTest = new EventEmitter<{ direction: 'download' | 'upload'; url: string; connections: number }>();

  // Configuração do gráfico de histórico
  public lineChartData: ChartConfiguration<'line'>['data'] = {
    labels: [],
    datasets: [
      {
        data: [],
        label: 'Throughput (Mbps)',
        borderColor: '#8b5cf6',
        backgroundColor: 'rgba(139, 92, 246, 0.1)',
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
          text: 'Throughput (Mbps)'
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

    // Extrai labels (datas) e dados (throughput)
    this.lineChartData.labels = sortedHistory.map(h => {
      const date = new Date(h.timestamp);
      return date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    });

    this.lineChartData.datasets[0].data = sortedHistory.map(h => h.results?.throughput || 0);
  }

  readonly SPEED_TEST_URLS = {
    download: 'http://speedtest.tele2.net/10MB.zip',
    upload: ''
  };

  readonly SPEED_TEST_PLACEHOLDERS = {
    download: 'http://servidor/arquivo.bin (ex: http://speedtest.tele2.net/10MB.zip)',
    upload: 'http://servidor/upload (servidor HTTP que aceite POST/PUT)'
  };

  onDirectionChange(newDirection: 'download' | 'upload'): void {
    this.direction = newDirection;
    this.url = this.SPEED_TEST_URLS[newDirection];
    this.directionChange.emit(newDirection);
    this.urlChange.emit(this.url);
  }

  onUrlChange(value: string): void {
    this.url = value;
    this.urlChange.emit(value);
  }

  onConnectionsChange(value: string): void {
    this.connections = parseInt(value, 10);
    this.connectionsChange.emit(this.connections);
  }

  onRunSpeedTest(): void {
    this.runSpeedTest.emit({
      direction: this.direction,
      url: this.url,
      connections: this.connections
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
