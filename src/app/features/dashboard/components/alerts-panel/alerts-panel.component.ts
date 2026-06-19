// Caminho do arquivo: frontend/src/app/features/dashboard/components/alerts-panel/alerts-panel.component.ts

import { Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef, DestroyRef, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { Observable, of, catchError, retry } from 'rxjs';
import { CpeService } from '../../../../core/services/cpe.service';
import { WebSocketService } from '../../../../core/services/websocket.service';
import { ToastService } from '../../../../core/services/toast.service';
import { TelemetryAlert } from '../../../../core/models';

@Component({
  selector: 'app-alerts-panel',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './alerts-panel.component.html',
  styleUrls: ['./alerts-panel.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AlertsPanelComponent implements OnInit, OnDestroy {
  private cdr = inject(ChangeDetectorRef);
  private destroyRef = inject(DestroyRef); // Gerenciador de ciclo de vida moderno do Angular 17+
  private toastService = inject(ToastService);
  private router = inject(Router);

  alerts: TelemetryAlert[] = [];
  isPanelOpen = false;

  constructor(private cpeService: CpeService, private wsService: WebSocketService) {}

  ngOnInit(): void {
    // Carga inicial via REST com retry automático
    this.cpeService.getActiveAlerts().pipe(
      retry({ count: 1, delay: 2000 }),
      catchError(err => {
        console.error('[AlertsPanel] Falha ao carregar alertas iniciais', err);
        this.toastService.warning('Não foi possível carregar alertas — exibindo apenas eventos novos');
        return of({ data: [] });
      })
    ).subscribe(res => { this.alerts = res.data; this.cdr.detectChanges(); });

    // Novos alertas em tempo real (individuais - warning ou critical isolado)
    this.wsService.onTelemetryAlert().pipe(takeUntilDestroyed(this.destroyRef)).subscribe((event) => {
      // Evita duplicar se já existir alerta ativo da mesma CPE+métrica (escalada warning→critical)
      const newAlert: TelemetryAlert = {
        serialNumber: event.serialNumber,
        metric: event.metric,
        severity: event.severity,
        status: 'active',
        value: event.value,
        message: event.message,
        triggeredAt: event.timestamp,
      };
      this.alerts = [
        newAlert,
        ...this.alerts.filter(a => !(a.serialNumber === event.serialNumber && a.metric === event.metric)),
      ];
      if (event.severity === 'critical') {
        this.toastService.error(`${event.serialNumber}: ${event.message}`, 8000);
      }
      this.cdr.detectChanges();
    });

    // Batch de alertas críticos em massa (anti alert-fatigue)
    this.wsService.onTelemetryAlertBatch().pipe(takeUntilDestroyed(this.destroyRef)).subscribe((batch) => {
      // Adiciona todos os alertas do batch à lista
      const newAlerts: TelemetryAlert[] = batch.alerts.map(a => ({
        serialNumber: a.serialNumber,
        metric: a.metric,
        severity: a.severity as 'warning' | 'critical',
        status: 'active',
        value: a.value,
        message: a.message,
        triggeredAt: a.timestamp,
      }));

      // Remove duplicatas (mesma CPE+métrica) e adiciona novos
      const existingKeys = new Set(this.alerts.map(a => `${a.serialNumber}-${a.metric}`));
      const uniqueNewAlerts = newAlerts.filter(a => !existingKeys.has(`${a.serialNumber}-${a.metric}`));
      this.alerts = [...uniqueNewAlerts, ...this.alerts].slice(0, 200);

      // Toast agregado se batch grande (>5 alertas), toasts individuais se pequeno
      if (batch.count > 5) {
        this.toastService.error(`⚠ ${batch.count} CPEs com alertas críticos simultâneos — possível incidente em massa`, 10000);
      } else {
        batch.alerts.filter(a => a.severity === 'critical').forEach(a => {
          this.toastService.error(`${a.serialNumber}: ${a.message}`, 8000);
        });
      }
      this.cdr.detectChanges();
    });

    // Alertas resolvidos — remove da lista
    this.wsService.onTelemetryAlertResolved().pipe(takeUntilDestroyed(this.destroyRef)).subscribe((event) => {
      this.alerts = this.alerts.filter(a => !(a.serialNumber === event.serialNumber && a.metric === event.metric));
      this.cdr.detectChanges();
    });
  }

  ngOnDestroy(): void {}

  acknowledgeAlert(alertId: string): void {
    this.cpeService.acknowledgeAlert(alertId).subscribe({
      next: (updatedAlert) => {
        const index = this.alerts.findIndex(a => a._id === alertId);
        if (index !== -1) {
          this.alerts[index] = updatedAlert;
          this.cdr.detectChanges();
        }
      },
      error: (err) => {
        console.error('[AlertsPanel] Erro ao reconhecer alerta', err);
      }
    });
  }

  togglePanel(): void {
    this.isPanelOpen = !this.isPanelOpen;
  }

  goToDetails(serialNumber: string): void {
    this.router.navigate(['/dashboard/cpe', serialNumber]);
    this.isPanelOpen = false;
  }

  get criticalCount(): number {
    return this.alerts.filter(a => a.severity === 'critical').length;
  }

  get groupedAlerts(): { serialNumber: string; alerts: TelemetryAlert[]; maxSeverity: string }[] {
    const groups = new Map<string, TelemetryAlert[]>();
    this.alerts.forEach(a => {
      const arr = groups.get(a.serialNumber) || [];
      arr.push(a);
      groups.set(a.serialNumber, arr);
    });
    return Array.from(groups.entries()).map(([serialNumber, alerts]) => ({
      serialNumber,
      alerts,
      maxSeverity: alerts.some(a => a.severity === 'critical') ? 'critical' : 'warning'
    }));
  }

  trackByAlert(index: number, alert: TelemetryAlert): string {
    return `${alert.serialNumber}-${alert.metric}`;
  }

  trackByGroup(index: number, group: { serialNumber: string; alerts: TelemetryAlert[]; maxSeverity: string }): string {
    return group.serialNumber;
  }
}
