import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ButtonComponent } from '@app/core/components/button/button.component';
import { NgChartsModule } from 'ng2-charts';
import { ChartConfiguration } from 'chart.js';

export interface PingResult {
  averageResponseTime?: number;
  minResponseTime?: number;
  maxResponseTime?: number;
  successCount?: number;
  failureCount?: number;
  diagnosticsState?: string;
}

@Component({
  selector: 'app-ping-diagnostic-card',
  standalone: true,
  imports: [CommonModule, ButtonComponent, NgChartsModule],
  templateUrl: './ping-diagnostic-card.component.html',
  styleUrls: ['./ping-diagnostic-card.component.scss']
})
export class PingDiagnosticCardComponent {
  @Input() serialNumber: string = '';
  @Input() readOnly: boolean = false;
  @Input() isSupported: boolean = true;
  @Input() isRunning: boolean = false;
  @Input() result: PingResult | null = null;
  @Input() history: any[] = [];
  @Input() host: string = '8.8.8.8';

  @Output() hostChange = new EventEmitter<string>();
  @Output() runPing = new EventEmitter<string>();

  // Configuração do gráfico de histórico
  public lineChartData: ChartConfiguration<'line'>['data'] = {
    labels: [],
    datasets: [
      {
        data: [],
        label: 'Latência (ms)',
        borderColor: '#22c55e',
        backgroundColor: 'rgba(34, 197, 94, 0.1)',
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
          text: 'Latência (ms)'
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

    // Extrai labels (datas) e dados (latência média)
    this.lineChartData.labels = sortedHistory.map(h => {
      const date = new Date(h.timestamp);
      return date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    });

    this.lineChartData.datasets[0].data = sortedHistory.map(h => h.averageResponseTime || 0);
  }

  onHostChange(value: string): void {
    this.host = value;
    this.hostChange.emit(value);
  }

  onRunPing(): void {
    this.runPing.emit(this.host);
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
