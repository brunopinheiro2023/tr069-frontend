import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ButtonComponent } from '@app/core/components/button/button.component';
import { NgChartsModule } from 'ng2-charts';
import { ChartConfiguration } from 'chart.js';

export interface DNSLookupResult {
  successCount?: number;
  resultCount?: number;
  diagnosticsState?: string;
  resolvedIPs?: string[];
}

@Component({
  selector: 'app-dns-lookup-card',
  standalone: true,
  imports: [CommonModule, ButtonComponent, NgChartsModule],
  templateUrl: './dns-lookup-card.component.html',
  styleUrls: ['./dns-lookup-card.component.scss']
})
export class DNSLookupCardComponent {
  @Input() serialNumber: string = '';
  @Input() readOnly: boolean = false;
  @Input() isSupported: boolean = true;
  @Input() isRunning: boolean = false;
  @Input() result: DNSLookupResult | null = null;
  @Input() history: any[] = [];
  @Input() hostName: string = 'google.com';

  @Output() hostNameChange = new EventEmitter<string>();
  @Output() runDNSLookup = new EventEmitter<string>();

  // Configuração do gráfico de histórico
  public lineChartData: ChartConfiguration<'line'>['data'] = {
    labels: [],
    datasets: [
      {
        data: [],
        label: 'Sucessos',
        borderColor: '#f59e0b',
        backgroundColor: 'rgba(245, 158, 11, 0.1)',
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
          text: 'Sucessos'
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

    // Extrai labels (datas) e dados (sucessos)
    this.lineChartData.labels = sortedHistory.map(h => {
      const date = new Date(h.timestamp);
      return date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    });

    this.lineChartData.datasets[0].data = sortedHistory.map(h => h.successCount || 0);
  }

  onHostNameChange(value: string): void {
    this.hostName = value;
    this.hostNameChange.emit(value);
  }

  onRunDNSLookup(): void {
    this.runDNSLookup.emit(this.hostName);
  }
}
