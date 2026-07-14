import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { environment } from '../../../environments/environment';
import {
  DiagnosticTarget,
  DiagnosticTargetCreate,
  DiagnosticTargetUpdate,
  DiagnosticTargetHistoryEntry,
  DiagnosticTargetAnalysis,
  DiagnosticOverview,
} from '../models';

@Injectable({ providedIn: 'root' })
export class DiagnosticTargetService {
  private readonly BASE_URL = `${environment.apiUrl}/api/diagnostic-targets`;

  constructor(private http: HttpClient) {}

  /** Lista todos os destinos de diagnóstico cadastrados. */
  list(): Observable<DiagnosticTarget[]> {
    return this.http.get<{ success: boolean; data: DiagnosticTarget[]; count: number }>(this.BASE_URL).pipe(
      map(res => res.data)
    );
  }

  /** Cria um novo destino de diagnóstico. */
  create(data: DiagnosticTargetCreate): Observable<DiagnosticTarget> {
    return this.http.post<{ success: boolean; data: DiagnosticTarget }>(this.BASE_URL, data).pipe(
      map(res => res.data)
    );
  }

  /** Atualiza um destino existente. */
  update(id: string, data: DiagnosticTargetUpdate): Observable<DiagnosticTarget> {
    return this.http.put<{ success: boolean; data: DiagnosticTarget }>(`${this.BASE_URL}/${id}`, data).pipe(
      map(res => res.data)
    );
  }

  /** Remove um destino de diagnóstico. */
  delete(id: string): Observable<void> {
    return this.http.delete<{ success: boolean; message: string }>(`${this.BASE_URL}/${id}`).pipe(
      map(() => void 0)
    );
  }

  /** Histórico de execuções de um destino (todas as CPEs ou filtrado por serialNumber). */
  history(id: string, limit: number = 100, serialNumber?: string): Observable<DiagnosticTargetHistoryEntry[]> {
    let url = `${this.BASE_URL}/${id}/history?limit=${limit}`;
    if (serialNumber) url += `&serialNumber=${encodeURIComponent(serialNumber)}`;
    return this.http.get<{ success: boolean; data: DiagnosticTargetHistoryEntry[]; count: number }>(url)
      .pipe(map(res => res.data));
  }

  /** Análise agregada de um destino (taxa de sucesso, latência, série diária). */
  analysis(id: string, days: number = 30): Observable<DiagnosticTargetAnalysis | null> {
    return this.http.get<{ success: boolean; data: DiagnosticTargetAnalysis | null }>(
      `${this.BASE_URL}/${id}/analysis?days=${days}`
    ).pipe(map(res => res.data));
  }

  /** Visão geral agregada de todos os destinos ativos (gráfico do dashboard). */
  overview(days: number = 7): Observable<{ data: DiagnosticOverview | null; message?: string }> {
    return this.http.get<{ success: boolean; data: DiagnosticOverview | null; message?: string }>(
      `${this.BASE_URL}/overview?days=${days}`
    ).pipe(map(res => ({ data: res.data, message: res.message })));
  }
}
