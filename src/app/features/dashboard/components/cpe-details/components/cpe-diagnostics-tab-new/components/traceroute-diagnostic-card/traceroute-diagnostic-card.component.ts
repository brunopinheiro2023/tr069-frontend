import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ButtonComponent } from '@app/core/components/button/button.component';
import { NgChartsModule } from 'ng2-charts';
import { ChartConfiguration } from 'chart.js';

export interface TraceRouteResult {
  hopCount?: number;
  responseTime?: number;
  diagnosticsState?: string;
  hops?: Array<{
    hopNumber: number;
    ipAddress: string;
    responseTime: number;
  }>;
}

@Component({
  selector: 'app-traceroute-diagnostic-card',
  standalone: true,
  imports: [CommonModule, ButtonComponent, NgChartsModule],
  templateUrl: './traceroute-diagnostic-card.component.html',
  styleUrls: ['./traceroute-diagnostic-card.component.scss']
})
export class TraceRouteDiagnosticCardComponent {
  @Input() serialNumber: string = '';
  @Input() readOnly: boolean = false;
  @Input() isSupported: boolean = true;
  @Input() isRunning: boolean = false;
  @Input() result: TraceRouteResult | null = null;
  @Input() history: any[] = [];
  @Input() host: string = '8.8.8.8';

  @Output() hostChange = new EventEmitter<string>();
  @Output() runTraceRoute = new EventEmitter<string>();

  // Configuração do gráfico de histórico
  public lineChartData: ChartConfiguration<'line'>['data'] = {
    labels: [],
    datasets: [
      {
        data: [],
        label: 'Hops',
        borderColor: '#3b82f6',
        backgroundColor: 'rgba(59, 130, 246, 0.1)',
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
          text: 'Número de Hops'
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

    // Extrai labels (datas) e dados (número de hops)
    this.lineChartData.labels = sortedHistory.map(h => {
      const date = new Date(h.timestamp);
      return date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    });

    this.lineChartData.datasets[0].data = sortedHistory.map(h => h.routeHops?.length || 0);
  }

  onHostChange(value: string): void {
    this.host = value;
    this.hostChange.emit(value);
  }

  onRunTraceRoute(): void {
    this.runTraceRoute.emit(this.host);
  }
}
