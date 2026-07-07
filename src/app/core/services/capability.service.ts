// Caminho do arquivo: frontend/src/app/core/services/capability.service.ts

import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { tap, catchError } from 'rxjs/operators';
import { environment } from '../../../environments/environment';

export type CapabilityModule = 'wifi' | 'wan' | 'lan' | 'nat' | 'radio' | 'system' | 'diagnostics' | 'qos';

export interface CapabilitiesResponse {
  serialNumber: string;
  module: CapabilityModule;
  isTR181: boolean;
  confidence: 'learning' | 'unstable' | 'stable';
  capabilities: Record<string, boolean>;
  groups: Array<{ key: string; label: string; paths: string[]; supported: boolean }>;
}

/**
 * Service genérico de capabilities por módulo.
 * Centraliza a consulta de quais funcionalidades TR-069 uma CPE suporta.
 */
@Injectable({
  providedIn: 'root'
})
export class CapabilityService {
  private readonly API_URL = `${environment.apiUrl}/api/cpe`;
  // Cache em memória: chave = "serial:module"
  private cache = new Map<string, { data: CapabilitiesResponse; timestamp: number }>();
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutos
  private readonly MAX_CACHE_SIZE = 100;

  constructor(private http: HttpClient) {}

  /**
   * Consulta as capabilities de um módulo para uma CPE.
   * Usa cache em memória para reduzir latência e carga no backend.
   */
  getCapabilities(serialNumber: string, module: CapabilityModule): Observable<CapabilitiesResponse> {
    const cacheKey = `${serialNumber}:${module}`;
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      return of(cached.data);
    }

    return this.http.get<CapabilitiesResponse>(`${this.API_URL}/${serialNumber}/capabilities/${module}`).pipe(
      tap(response => this.setCache(cacheKey, response)),
      catchError(() => {
        // Fallback permissivo: exibe todas as capabilities se o endpoint falhar.
        const fallback: CapabilitiesResponse = {
          serialNumber,
          module,
          isTR181: true,
          confidence: 'learning',
          capabilities: {},
          groups: []
        };
        return of(fallback);
      })
    );
  }

  private setCache(cacheKey: string, data: CapabilitiesResponse): void {
    if (this.cache.size >= this.MAX_CACHE_SIZE) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) this.cache.delete(oldestKey);
    }
    this.cache.set(cacheKey, { data, timestamp: Date.now() });
  }
}
