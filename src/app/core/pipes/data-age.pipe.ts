import { Pipe, PipeTransform } from '@angular/core';

/**
 * Pipe que transforma um Date em string legível indicando há quanto tempo os dados foram coletados.
 * Exemplos: "há 2 min", "há 45 min", "há 2 h", "há 1 dia(s)"
 */
@Pipe({
  name: 'dataAge',
  standalone: true
})
export class DataAgePipe implements PipeTransform {
  transform(value: Date | string | null | undefined): string {
    if (!value) return 'Desconhecido';
    
    const date = typeof value === 'string' ? new Date(value) : value;
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) return 'Agora mesmo';
    if (diffMins < 60) return `Há ${diffMins} min`;
    
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `Há ${diffHours} h`;
    
    const diffDays = Math.floor(diffHours / 24);
    return `Há ${diffDays} dia(s)`;
  }
}
