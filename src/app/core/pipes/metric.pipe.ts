import { Pipe, PipeTransform } from '@angular/core';
import { TelemetryData } from '../models';

type MetricTransform = 'memPercent' | 'uptimeHours' | 'formatBytes';

/**
 * Pipe genérico e performático para extrair e formatar métricas de telemetria.
 * Substitui múltiplos getters no componente, otimizando a detecção de mudanças com OnPush.
 */
@Pipe({
  name: 'metric',
  standalone: true,
  pure: true
})
export class MetricPipe implements PipeTransform {

  transform(
    telemetryData: TelemetryData | null,
    key: string,
    options?: {
      unit?: string;
      fallback?: string;
      transform?: MetricTransform;
      zeroAsNull?: boolean;
    }
  ): string {
    const fallback = options?.fallback ?? '—';
    if (!telemetryData) return fallback;

    // Lógica de transformação especial
    if (options?.transform === 'memPercent') {
      const free = this.getMetricValue(telemetryData, 'memoryFree');
      const total = this.getMetricValue(telemetryData, 'memoryTotal');
      if (free === null || total === null || total <= 0) return fallback;
      const percent = Math.round(((total - free) / total) * 100);
      return `${percent}${options?.unit || '%'}`;
    }

    if (options?.transform === 'uptimeHours') {
      const up = this.getMetricValue(telemetryData, 'uptime');
      if (up === null || up < 0) return fallback;
      const hours = Math.floor(up / 3600);
      return `${hours}${options?.unit || 'h'}`;
    }

    if (options?.transform === 'formatBytes') {
      const bytes = this.getMetricValue(telemetryData, key);
      if (bytes === null || bytes < 0) return fallback;
      const units = ['B', 'KB', 'MB', 'GB', 'TB'];
      let value = bytes;
      let unitIndex = 0;
      while (value >= 1024 && unitIndex < units.length - 1) {
        value /= 1024;
        unitIndex++;
      }
      return `${value.toFixed(2)} ${units[unitIndex]}`;
    }

    // Extração padrão de métrica
    const value = this.getMetricValue(telemetryData, key);
    if (value === null) return fallback;
    if (options?.zeroAsNull && value === 0) return fallback;

    return `${value}${options?.unit || ''}`.trim();
  }

  private getMetricValue(telemetryData: TelemetryData, key: string): number | null {
    const metric = telemetryData?.[key] as any;
    if (metric === undefined || metric === null) return null;

    const value = typeof metric === 'object' && 'value' in metric ? metric.value : metric;
    if (value === undefined || value === null) return null;

    const num = typeof value === 'number' ? value : parseFloat(String(value));
    return isNaN(num) ? null : num;
  }
}
