import { Pipe, PipeTransform } from '@angular/core';

/**
 * Pipe puro e performático para formatar bytes em unidades legíveis (KB, MB, GB).
 * Substitui o método formatBytes() no componente para otimizar a detecção de mudanças.
 */
@Pipe({
  name: 'formatBytes',
  standalone: true,
  pure: true
})
export class FormatBytesPipe implements PipeTransform {
  transform(bytes: number | null | undefined, decimals = 2): string {
    if (bytes === null || bytes === undefined || bytes === 0) return '0 B';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
  }
}
