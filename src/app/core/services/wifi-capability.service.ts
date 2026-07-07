// Caminho do arquivo: frontend/src/app/core/services/wifi-capability.service.ts
//
// Wrapper legado/especializado sobre CapabilityService.
// Mantido para compatibilidade; novos componentes devem usar CapabilityService diretamente.

import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { CapabilityService, CapabilitiesResponse } from './capability.service';

export interface WifiCapabilitiesResponse {
  serialNumber: string;
  isTR181: boolean;
  confidence: 'learning' | 'unstable' | 'stable';
  capabilities: Record<string, boolean>;
}

@Injectable({
  providedIn: 'root'
})
export class WifiCapabilityService {
  constructor(private capabilityService: CapabilityService) {}

  getCapabilities(serialNumber: string): Observable<WifiCapabilitiesResponse> {
    return this.capabilityService.getCapabilities(serialNumber, 'wifi') as Observable<WifiCapabilitiesResponse>;
  }
}
