// Caminho: src/app/core/services/audit-log.service.ts
// Service HTTP para consulta de logs de auditoria (GET /api/audit-logs + /stats).
// Segue o padrão de diagnostic-target.service.ts — HttpClient + map.

import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import {
  AuditLog,
  AuditLogFilters,
  AuditLogPaginatedResponse,
  AuditLogStats,
} from '../models';

@Injectable({ providedIn: 'root' })
export class AuditLogService {
  private readonly BASE_URL = `${environment.apiUrl}/api/audit-logs`;

  constructor(private http: HttpClient) {}

  /**
   * Lista logs de auditoria com filtros e paginação.
   * @param filters Filtros opcionais (page, limit, serialNumber, username, action, channel, result, dateFrom, dateTo)
   */
  list(filters: AuditLogFilters = {}): Observable<AuditLogPaginatedResponse> {
    let params = new HttpParams()
      .set('page', String(filters.page ?? 1))
      .set('limit', String(filters.limit ?? 50));

    if (filters.serialNumber) params = params.set('serialNumber', filters.serialNumber);
    if (filters.userId) params = params.set('userId', filters.userId);
    if (filters.username) params = params.set('username', filters.username);
    if (filters.action) params = params.set('action', filters.action);
    if (filters.channel) params = params.set('channel', filters.channel);
    if (filters.result) params = params.set('result', filters.result);
    if (filters.dateFrom) params = params.set('dateFrom', filters.dateFrom);
    if (filters.dateTo) params = params.set('dateTo', filters.dateTo);

    return this.http.get<AuditLogPaginatedResponse>(this.BASE_URL, { params });
  }

  /**
   * Estatísticas agregadas dos audit logs (contagem por action, channel, result).
   * @param filters Filtros opcionais (exceto page/limit)
   */
  stats(filters: Omit<AuditLogFilters, 'page' | 'limit'> = {}): Observable<AuditLogStats> {
    let params = new HttpParams();

    if (filters.serialNumber) params = params.set('serialNumber', filters.serialNumber);
    if (filters.userId) params = params.set('userId', filters.userId);
    if (filters.username) params = params.set('username', filters.username);
    if (filters.action) params = params.set('action', filters.action);
    if (filters.channel) params = params.set('channel', filters.channel);
    if (filters.result) params = params.set('result', filters.result);
    if (filters.dateFrom) params = params.set('dateFrom', filters.dateFrom);
    if (filters.dateTo) params = params.set('dateTo', filters.dateTo);

    return this.http.get<AuditLogStats>(`${this.BASE_URL}/stats`, { params });
  }
}
