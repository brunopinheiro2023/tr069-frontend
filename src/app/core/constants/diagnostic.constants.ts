// Caminho do arquivo: src/app/core/constants/diagnostic.constants.ts
//
// CONSTANTES DE DIAGNÓSTICO — ícones e labels centralizados para os 4 tipos
// de diagnóstico periódico suportados pelo scheduler (DiagnosticTarget).
//
// Usado por:
//   - diagnostic-targets.component (página admin de destinos)
//   - cpe-periodic-diagnostics-tab.component (aba dentro do cpe-details)
//
// Material Symbols Rounded — nomes verificados contra o vocabulário de ícones
// já em uso (e comprovadamente renderizando) neste projeto, não inventados:
//   IPPing     → 'network_ping'    (cpe-info-tab.component.ts — métrica WAN latency)
//   TraceRoute → 'route'           (traceroute-diagnostic-card.component.html)
//   DNSLookup  → 'dns'             (dns-lookup-card.component.html)
//   UDPEcho    → 'hub'             (udp-echo-card.component.html)
// 'ping', 'udp' e 'stethoscope' NÃO são ligaduras válidas de Material Symbols —
// renderizam como texto literal quebrado em vez de ícone.
//
// Quando um tipo não reconhecido aparece (futuro), cai no fallback 'help'.

import { DiagnosticTargetType } from '../models';

export const DIAGNOSTIC_TYPE_ICONS: Record<DiagnosticTargetType, string> = {
  IPPing: 'network_ping',
  TraceRoute: 'route',
  DNSLookup: 'dns',
  UDPEcho: 'hub',
};

export const DIAGNOSTIC_TYPE_LABELS: Record<DiagnosticTargetType, string> = {
  IPPing: 'IP Ping',
  TraceRoute: 'Trace Route',
  DNSLookup: 'DNS Lookup',
  UDPEcho: 'UDP Echo',
};

/** Lista ordenada para selects/radios no formulário. */
export const DIAGNOSTIC_TYPES: { value: DiagnosticTargetType; label: string; icon: string }[] = [
  { value: 'IPPing', label: DIAGNOSTIC_TYPE_LABELS.IPPing, icon: DIAGNOSTIC_TYPE_ICONS.IPPing },
  { value: 'TraceRoute', label: DIAGNOSTIC_TYPE_LABELS.TraceRoute, icon: DIAGNOSTIC_TYPE_ICONS.TraceRoute },
  { value: 'DNSLookup', label: DIAGNOSTIC_TYPE_LABELS.DNSLookup, icon: DIAGNOSTIC_TYPE_ICONS.DNSLookup },
  { value: 'UDPEcho', label: DIAGNOSTIC_TYPE_LABELS.UDPEcho, icon: DIAGNOSTIC_TYPE_ICONS.UDPEcho },
];

/** Fallback para tipos não reconhecidos (extensibilidade futura). */
export const DIAGNOSTIC_TYPE_ICON_FALLBACK = 'help';

/** Retorna o ícone Material Symbols para um tipo de diagnóstico. */
export function getDiagnosticTypeIcon(type: string): string {
  return DIAGNOSTIC_TYPE_ICONS[type as DiagnosticTargetType] || DIAGNOSTIC_TYPE_ICON_FALLBACK;
}

/** Retorna o label legível para um tipo de diagnóstico. */
export function getDiagnosticTypeLabel(type: string): string {
  return DIAGNOSTIC_TYPE_LABELS[type as DiagnosticTargetType] || type;
}
