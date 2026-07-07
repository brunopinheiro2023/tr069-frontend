import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { environment } from '../../../environments/environment';
import { ProviderConfig, ProviderConfigUpdate } from '../models';

@Injectable({ providedIn: 'root' })
export class ProviderConfigService {
  private readonly BASE_URL = `${environment.apiUrl}/api/provider-config`;

  constructor(private http: HttpClient) {}

  get(): Observable<ProviderConfig> {
    return this.http.get<{ success: boolean; data: ProviderConfig }>(this.BASE_URL).pipe(
      map(res => res.data)
    );
  }

  save(data: ProviderConfigUpdate): Observable<ProviderConfig> {
    return this.http.post<{ success: boolean; data: ProviderConfig }>(this.BASE_URL, data).pipe(
      map(res => res.data)
    );
  }

  update(id: string, data: ProviderConfigUpdate): Observable<ProviderConfig> {
    return this.http.put<{ success: boolean; data: ProviderConfig }>(`${this.BASE_URL}/${id}`, data).pipe(
      map(res => res.data)
    );
  }
}
