import {
  Component, OnInit, ChangeDetectionStrategy, ChangeDetectorRef, DestroyRef, inject, Input,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { catchError, of } from 'rxjs';
import { DiagnosticTargetService } from '../../../../../../core/services/diagnostic-target.service';
import {
  DiagnosticTarget, DiagnosticTargetHistoryEntry,
} from '../../../../../../core/models';
import {
  getDiagnosticTypeIcon,
} from '../../../../../../core/constants/diagnostic.constants';

@Component({
  selector: 'app-cpe-periodic-diagnostics-tab',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './cpe-periodic-diagnostics-tab.component.html',
  styleUrls: ['./cpe-periodic-diagnostics-tab.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CpePeriodicDiagnosticsTabComponent implements OnInit {
  @Input() serialNumber: string = '';
  @Input() isCpeOffline: boolean = false;

  private destroyRef = inject(DestroyRef);

  targets: DiagnosticTarget[] = [];
  // Histórico por targetId (filtrado por serialNumber)
  historyByTarget: Record<string, DiagnosticTargetHistoryEntry[]> = {};
  loading = true;
  expandedTargetId: string | null = null;

  constructor(
    private service: DiagnosticTargetService,
    private cdr: ChangeDetectorRef,
  ) {}

  ngOnInit(): void {
    this.loadTargets();
  }

  private loadTargets(): void {
    this.loading = true;
    this.service.list().pipe(
      takeUntilDestroyed(this.destroyRef),
      catchError(() => of([])),
    ).subscribe(targets => {
      // Filtra apenas destinos que se aplicam a esta CPE
      this.targets = targets.filter(t =>
        t.enabled && (t.scopeType === 'all' || (t.serialNumbers || []).includes(this.serialNumber))
      );
      this.loading = false;
      this.cdr.markForCheck();
    });
  }

  toggleHistory(target: DiagnosticTarget): void {
    const id = target._id!;
    if (this.expandedTargetId === id) {
      this.expandedTargetId = null;
      this.cdr.markForCheck();
      return;
    }
    this.expandedTargetId = id;
    if (!this.historyByTarget[id]) {
      this.service.history(id, 20, this.serialNumber).pipe(
        takeUntilDestroyed(this.destroyRef),
        catchError(() => of([])),
      ).subscribe(history => {
        this.historyByTarget[id] = history;
        this.cdr.markForCheck();
      });
    }
    this.cdr.markForCheck();
  }

  // Extrai um valor legível do resultado (varia por tipo de diagnóstico) — campos
  // espelham exatamente cwmpController_diagnosticResult.js#mappedResults por tipo.
  resultSummary(entry: DiagnosticTargetHistoryEntry): string {
    const r = entry.results || {};
    const num = (k: string): number => typeof r[k] === 'number' ? r[k] as number : 0;
    switch (entry.diagnosticType) {
      case 'IPPing':
        return `avg ${r['averageResponseTime'] ?? '—'}ms (min ${r['minResponseTime'] ?? '—'} / max ${r['maxResponseTime'] ?? '—'}) · ${num('successCount')}/${num('successCount') + num('failureCount')} ok`;
      case 'TraceRoute':
        return `${r['hopCount'] ?? '—'} hops · ${r['responseTime'] ?? '—'}ms total`;
      case 'DNSLookup': {
        const ips = Array.isArray(r['resolvedIPs']) ? (r['resolvedIPs'] as unknown[]).length : 0;
        return `${r['successCount'] ?? '—'} resposta(s) · ${ips} IP(s) resolvido(s)`;
      }
      case 'UDPEcho':
        return `${r['packetsReceived'] ?? '—'}/${r['packetsResponded'] ?? '—'} pacotes · ${r['bytesReceived'] ?? 0}B recebidos`;
      default:
        return JSON.stringify(r).slice(0, 60);
    }
  }

  getTypeIcon = getDiagnosticTypeIcon;

  // 'Completed' aceito por compatibilidade com histórico gravado antes da
  // normalização na origem (cwmpController_diagnosticResult.js) — dados novos
  // sempre chegam como 'Complete', mas o registro de teste real (2026-07-11,
  // DNSLookup) ainda tem 'Completed' persistido e precisa continuar exibindo certo.
  // Estados de erro TR-069 são sempre prefixados Error_ (Error_Timeout,
  // Error_CannotResolveHostName, Error_Internal, etc.) — nunca o literal "Error".
  stateClass(state: string): string {
    if (state === 'Complete' || state === 'Completed') return 'state-ok';
    if (state?.startsWith('Error_')) return 'state-err';
    if (state === 'Requested' || state === 'Running') return 'state-pending';
    return '';
  }
}
