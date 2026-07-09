import { Component, Input, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CpeService } from '../../../../../../core/services/cpe.service';
import { ToastService } from '../../../../../../core/services/toast.service';
import { CpePrediction, CpePredictionFactor } from '../../../../../../core/models';

/**
 * Aba "IA" na página de detalhes da CPE.
 * Exibe o score de risco de falha gerado pelo motor heurístico do backend,
 * fatores individualizados, causas prováveis e ações sugeridas.
 */
@Component({
  selector: 'app-cpe-ai-tab',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './cpe-ai-tab.component.html',
  styleUrls: ['./cpe-ai-tab.component.scss'],
})
export class CpeAiTabComponent implements OnChanges {
  @Input() serialNumber: string = '';
  /** CPE está offline — a IA usa cache de 20min do backend, então pode funcionar. */
  @Input() isCpeOffline: boolean = false;

  prediction: CpePrediction | null = null;
  loading = false;
  error: string | null = null;

  /** Score mínimo para considerar o risco visivelmente preocupante. */
  readonly MEDIUM_RISK_THRESHOLD = 30;
  readonly HIGH_RISK_THRESHOLD   = 60;
  readonly CRITICAL_THRESHOLD    = 85;

  constructor(
    private cpeService: CpeService,
    private toastService: ToastService,
  ) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['serialNumber'] && this.serialNumber) {
      this.loadPrediction();
    }
  }

  loadPrediction(): void {
    if (!this.serialNumber) return;
    this.loading = true;
    this.error = null;

    this.cpeService.predictFailure(this.serialNumber).subscribe({
      next: (data: CpePrediction) => {
        this.prediction = data;
        this.loading = false;
      },
      error: (_err: unknown) => {
        this.error = 'Não foi possível gerar a predição.';
        this.loading = false;
        this.toastService.error('Erro ao carregar análise de falhas da CPE.');
      },
    });
  }

  /** Retorna classe CSS para o badge de risco. */
  get riskBadgeClass(): string {
    const level = this.prediction?.prediction?.riskLevel;
    return level ?? 'low';
  }

  /** Label amigável para o fator (i18n simplificado). */
  factorLabel(key: string): string {
    const labels: Record<string, string> = {
      gponSignal:      'Sinal GPON',
      connectivity:    'Conectividade',
      memoryHealth:    'Memória Livre',
      cpuHealth:       'Carga de CPU',
      hostStability:   'Dispositivos Conectados',
      wifiNoise:       'Ruído Wi-Fi',
      opticalTrend:    'Tendência Óptica',
      memoryLeakTrend: 'Vazamento de Memória',
      laserHealth:     'Saúde do Laser',
    };
    return labels[key] || key;
  }

  /** Delta de score desde a última verificação. */
  factorDelta(key: string): number | null {
    if (!this.prediction?.previousFactors) return null;
    const current = this.prediction.factors?.[key as keyof CpePrediction['factors']] as CpePredictionFactor | undefined;
    const previous = this.prediction.previousFactors[key as keyof CpePrediction['previousFactors']] as CpePredictionFactor | undefined;
    if (!current || !previous) return null;
    if (current.score === null || previous.score === null) return null;
    const delta = current.score - previous.score;
    return Math.abs(delta) >= 5 ? delta : null; // só mostra mudanças relevantes
  }

  /** Valor absoluto do delta para exibição. */
  absDelta(key: string): number {
    const delta = this.factorDelta(key);
    return delta !== null ? Math.abs(delta) : 0;
  }

  /** Indica se o delta é positivo (piorou) ou negativo (melhorou). */
  deltaDirection(key: string): 'up' | 'down' | null {
    const delta = this.factorDelta(key);
    if (delta === null) return null;
    return delta > 0 ? 'up' : 'down';
  }

  /** Score de um fator, ou 0 se indisponível. */
  factorScore(key: string): number {
    const factor = this.prediction?.factors?.[key as keyof CpePrediction['factors']] as CpePredictionFactor | undefined;
    return factor?.score ?? 0;
  }

  /** Status de um fator para estilo. */
  factorStatus(key: string): 'good' | 'warning' | 'critical' | 'unavailable' {
    const factor = this.prediction?.factors?.[key as keyof CpePrediction['factors']] as CpePredictionFactor | undefined;
    return factor?.status ?? 'good';
  }

  /** Mensagem do fator. */
  factorMessage(key: string): string {
    const factor = this.prediction?.factors?.[key as keyof CpePrediction['factors']] as CpePredictionFactor | undefined;
    return factor?.message ?? '';
  }

  /** Barras de progresso para o score (para visualização). */
  barWidth(score: number): string {
    return `${Math.min(score, 100)}%`;
  }

  /** Cor da barra de progresso. */
  barColor(score: number): string {
    if (score >= 80) return 'var(--accent-danger)';
    if (score >= 60) return 'var(--accent-warning)';
    if (score >= 30) return '#ffb547';
    return 'var(--accent-success)';
  }

  factorKeys(): string[] {
    if (!this.prediction) return [];
    return Object.keys(this.prediction.factors);
  }
}
