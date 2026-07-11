import {
  Component, OnInit, ChangeDetectionStrategy, ChangeDetectorRef, DestroyRef, inject,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { catchError, finalize, of, forkJoin } from 'rxjs';
import { DiagnosticTargetService } from '../../core/services/diagnostic-target.service';
import { ToastService } from '../../core/services/toast.service';
import { AuthService } from '../../core/services/auth.service';
import { WebSocketService } from '../../core/services/websocket.service';
import {
  DiagnosticTarget, DiagnosticTargetType, DiagnosticTargetAnalysis,
} from '../../core/models';
import {
  DIAGNOSTIC_TYPES, getDiagnosticTypeIcon, getDiagnosticTypeLabel,
} from '../../core/constants/diagnostic.constants';

@Component({
  selector: 'app-diagnostic-targets',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './diagnostic-targets.component.html',
  styleUrls: ['./diagnostic-targets.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DiagnosticTargetsComponent implements OnInit {
  private destroyRef = inject(DestroyRef);

  targets: DiagnosticTarget[] = [];
  loading = true;
  saving = false;
  showForm = false;
  editingId: string | null = null;

  // Análise expandida por target (key = target._id)
  analysisMap: Record<string, DiagnosticTargetAnalysis | null> = {};
  analysisLoadingId: string | null = null;
  expandedAnalysisId: string | null = null;

  // Histórico expandido por target
  historyMap: Record<string, boolean> = {}; // apenas controla loading
  expandedHistoryId: string | null = null;

  form!: FormGroup;
  get isAdmin(): boolean { return this.authService.isAdmin(); }

  readonly targetTypes = DIAGNOSTIC_TYPES;

  constructor(
    private fb: FormBuilder,
    private service: DiagnosticTargetService,
    private toast: ToastService,
    private authService: AuthService,
    private wsService: WebSocketService,
    private cdr: ChangeDetectorRef,
  ) {}

  ngOnInit(): void {
    this.form = this.fb.group({
      host: ['', [Validators.required, Validators.minLength(3)]],
      type: ['IPPing', [Validators.required]],
      label: [''],
      scopeType: ['all', [Validators.required]],
      serialNumbers: [''],
      intervalHours: [6, [Validators.required, Validators.min(1), Validators.max(168)]],
      enabled: [true],
    });
    this.load();

    // Tempo real: escuta eventos globais do scheduler na sala all_cpes.
    // diagnostic_target_result → atualiza lista (pega novo health 24h) + recarrega análise se expandida.
    // diagnostic_target_degraded → toast de aviso + destaca visualmente o item.
    this.wsService.subscribeToAllCpes();
    this.wsService.onDiagnosticTargetResult().pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(ev => {
        if (this.expandedAnalysisId === ev.targetId) delete this.analysisMap[ev.targetId];
        this.load();
      });
    this.wsService.onDiagnosticTargetDegraded().pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(ev => {
        this.toast.warning(`Destino "${ev.host}" (${ev.type}) falhando em ${ev.distinctFailingCpes} CPEs distintas na última hora.`);
        this.cdr.markForCheck();
      });
  }

  private load(): void {
    this.loading = true;
    this.service.list().pipe(
      takeUntilDestroyed(this.destroyRef),
      catchError(() => { this.toast.error('Erro ao carregar destinos de diagnóstico.'); return of([]); }),
      finalize(() => { this.loading = false; this.cdr.markForCheck(); }),
    ).subscribe(targets => {
      this.targets = targets;
      this.cdr.markForCheck();
    });
  }

  // ── Formulário ──────────────────────────────────────────────────────────

  openCreateForm(): void {
    this.editingId = null;
    this.showForm = true;
    this.form.reset({ host: '', type: 'IPPing', label: '', scopeType: 'all', serialNumbers: '', intervalHours: 6, enabled: true });
    this.cdr.markForCheck();
  }

  openEditForm(target: DiagnosticTarget): void {
    this.editingId = target._id ?? null;
    this.showForm = true;
    this.form.patchValue({
      host: target.host,
      type: target.type,
      label: target.label || '',
      scopeType: target.scopeType,
      serialNumbers: (target.serialNumbers || []).join(', '),
      intervalHours: target.intervalHours,
      enabled: target.enabled,
    });
    this.cdr.markForCheck();
  }

  closeForm(): void {
    this.showForm = false;
    this.editingId = null;
    this.cdr.markForCheck();
  }

  save(): void {
    if (this.form.invalid || this.saving || !this.isAdmin) return;
    this.saving = true;
    const v = this.form.value;
    const payload: Record<string, unknown> = {
      host: v.host.trim(),
      label: v.label?.trim() || '',
      scopeType: v.scopeType,
      intervalHours: v.intervalHours,
      enabled: v.enabled,
    };
    if (!this.editingId) {
      // type só é aceito na criação — updateDiagnosticTarget não permite trocar
      // o tipo de um destino já existente (histórico/targetId ficariam inconsistentes)
      payload['type'] = v.type;
    }
    if (v.scopeType === 'selected') {
      const serials = (v.serialNumbers || '').split(',').map((s: string) => s.trim()).filter(Boolean);
      if (serials.length === 0) {
        this.toast.error('Selecione ao menos uma CPE para escopo "selecionadas".');
        this.saving = false;
        this.cdr.markForCheck();
        return;
      }
      payload['serialNumbers'] = serials;
    } else {
      // Sempre envia explicitamente vazio ao trocar pra "todas as CPEs" — sem isso,
      // o backend nunca limpa o array antigo (só atualiza serialNumbers se a chave
      // vier no body) e o destino fica com um array de seriais órfão e enganoso.
      payload['serialNumbers'] = [];
    }

    const req$ = this.editingId
      ? this.service.update(this.editingId, payload)
      : this.service.create(payload as any);

    req$.pipe(
      takeUntilDestroyed(this.destroyRef),
      catchError(err => {
        if (err.status === 409) {
          this.toast.error(err.error?.error || 'Destino duplicado já existe.');
        } else {
          this.toast.error(err?.error?.error || err?.error?.message || 'Erro ao salvar destino.');
        }
        return of(null);
      }),
      finalize(() => { this.saving = false; this.cdr.markForCheck(); }),
    ).subscribe(result => {
      if (result) {
        this.toast.success(this.editingId ? 'Destino atualizado.' : 'Destino criado com sucesso.');
        this.closeForm();
        this.load();
      }
    });
  }

  // ── Toggle enable/disable ───────────────────────────────────────────────

  toggleEnabled(target: DiagnosticTarget): void {
    if (!this.isAdmin) return;
    const newEnabled = !target.enabled;
    this.service.update(target._id!, { enabled: newEnabled }).pipe(
      takeUntilDestroyed(this.destroyRef),
      catchError(() => { this.toast.error('Erro ao alterar status.'); return of(null); }),
    ).subscribe(result => {
      if (result) {
        target.enabled = newEnabled;
        this.toast.success(newEnabled ? 'Destino ativado.' : 'Destino desativado.');
        this.cdr.markForCheck();
      }
    });
  }

  // ── Delete ──────────────────────────────────────────────────────────────

  deleteTarget(target: DiagnosticTarget): void {
    if (!this.isAdmin || !target._id) return;
    if (!confirm(`Remover o destino "${target.label || target.host}" (${target.type})?`)) return;
    this.service.delete(target._id).pipe(
      takeUntilDestroyed(this.destroyRef),
      catchError(() => { this.toast.error('Erro ao remover destino.'); return of(null); }),
    ).subscribe(() => {
      this.toast.success('Destino removido.');
      this.load();
    });
  }

  // ── Análise ─────────────────────────────────────────────────────────────

  toggleAnalysis(target: DiagnosticTarget): void {
    const id = target._id!;
    if (this.expandedAnalysisId === id) {
      this.expandedAnalysisId = null;
      this.cdr.markForCheck();
      return;
    }
    this.expandedAnalysisId = id;
    if (!this.analysisMap[id]) {
      this.analysisLoadingId = id;
      this.service.analysis(id, 30).pipe(
        takeUntilDestroyed(this.destroyRef),
        catchError(() => { this.toast.error('Erro ao carregar análise.'); return of(null); }),
        finalize(() => { this.analysisLoadingId = null; this.cdr.markForCheck(); }),
      ).subscribe(analysis => {
        this.analysisMap[id] = analysis;
        this.cdr.markForCheck();
      });
    }
    this.cdr.markForCheck();
  }

  // ── Helpers ─────────────────────────────────────────────────────────────

  getTypeIcon = getDiagnosticTypeIcon;
  getTypeLabel = getDiagnosticTypeLabel;

  scopeLabel(target: DiagnosticTarget): string {
    if (target.scopeType === 'all') return 'Todas as CPEs';
    const count = target.serialNumbers?.length || 0;
    return `${count} CPE${count !== 1 ? 's' : ''} selecionada${count !== 1 ? 's' : ''}`;
  }

  // Exporta a série diária da análise em CSV — reaproveita o padrão Blob+BOM
  // já usado em cpe-info-tab.component.ts:705-732, sem inventar utilitário novo.
  exportAnalysisCsv(target: DiagnosticTarget): void {
    const a = this.analysisMap[target._id!];
    if (!a?.dailySeries?.length) return;
    const headers = ['day', 'success', 'error', 'total'];
    const rows = a.dailySeries.map(d => [d.day, d.success, d.error, d.total].join(','));
    const csv = [headers.join(','), ...rows].join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `diagnostico_${target.host}_${target.type}_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  // ── Ações em lote ──────────────────────────────────────────────────────
  // Sem endpoint bulk no backend — client-side com forkJoin nos endpoints
  // singulares já existentes. Simples e suficiente pro volume esperado.

  selectedIds = new Set<string>();

  toggleSelection(id: string): void {
    if (this.selectedIds.has(id)) this.selectedIds.delete(id);
    else this.selectedIds.add(id);
  }

  bulkToggleEnabled(enabled: boolean): void {
    if (this.selectedIds.size === 0) return;
    const calls = Array.from(this.selectedIds).map(id => this.service.update(id, { enabled }));
    forkJoin(calls).pipe(
      takeUntilDestroyed(this.destroyRef),
      catchError(() => { this.toast.error('Falha ao atualizar alguns destinos.'); return of(null); }),
    ).subscribe(() => {
      this.toast.success(`${this.selectedIds.size} destino(s) atualizados.`);
      this.selectedIds.clear();
      this.load();
    });
  }

  bulkDelete(): void {
    if (this.selectedIds.size === 0 || !confirm(`Remover ${this.selectedIds.size} destino(s)?`)) return;
    const calls = Array.from(this.selectedIds).map(id => this.service.delete(id));
    forkJoin(calls).pipe(
      takeUntilDestroyed(this.destroyRef),
      catchError(() => { this.toast.error('Falha ao remover alguns destinos.'); return of(null); }),
    ).subscribe(() => {
      this.toast.success('Destinos removidos.');
      this.selectedIds.clear();
      this.load();
    });
  }
}
