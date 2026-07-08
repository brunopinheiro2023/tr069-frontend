/**
 * @file cpe-info-tab.component.spec.ts
 *
 * Suite de testes para CpeInfoTabComponent.
 * Cobre: lógica pura (getters/helpers), integração com serviços (mocks),
 * tratamento de WebSocket e fluxo de dados de telemetria.
 *
 * Padrão: Karma/Jasmine · Angular TestBed · standalone component
 * Regra: sem console.log em testes — usa spyOn para silenciar o logInfo/logWarn/logError interno.
 */

import { ComponentFixture, TestBed, fakeAsync, tick, discardPeriodicTasks } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA, ChangeDetectorRef } from '@angular/core';
import { PLATFORM_ID } from '@angular/core';
import { Subject, of, throwError, EMPTY } from 'rxjs';
import { HttpClientTestingModule } from '@angular/common/http/testing';

import { CpeInfoTabComponent } from './cpe-info-tab.component';
import { CpeService } from '../../../../../../core/services/cpe.service';
import { WebSocketService } from '../../../../../../core/services/websocket.service';
import { ToastService } from '../../../../../../core/services/toast.service';
import { DiagnosticParserService } from '../../../../../../core/services/diagnostic-parser.service';
import { TelemetryCacheService } from '../../../../../../core/services/telemetry-cache.service';
import { TelemetryData, TelemetryAlert, TelemetrySnapshot, CpeDevice } from '../../../../../../core/models';

// ── Helpers de fixture ────────────────────────────────────────────────────────

/** Retorna um objeto CpeDevice mínimo para uso nos testes. */
function makeCpe(overrides: Partial<CpeDevice> = {}): CpeDevice {
  return {
    serialNumber: 'TEST001',
    oui: '000000',
    isOnline: true,
    ...overrides,
  } as CpeDevice;
}

/** Retorna um TelemetryData flat com os campos mais usados nos testes. */
function makeTelemetry(overrides: Partial<TelemetryData> = {}): TelemetryData {
  return {
    cpuUsage:   45,
    memoryFree: 50000,
    memoryTotal: 128000,
    uptime:     3600,
    opticalRx:  -20,
    opticalTx:  -3,
    gponStatus: 'up',
    wanStatus:  'connected',
    ...overrides,
  };
}

/** Retorna um TelemetryAlert ativo mínimo. */
function makeAlert(overrides: Partial<TelemetryAlert> = {}): TelemetryAlert {
  return {
    serialNumber: 'TEST001',
    metric: 'cpuUsage',
    severity: 'warning',
    status: 'active',
    value: 92,
    triggeredAt: new Date().toISOString(),
    message: 'CPU alto',
    ...overrides,
  };
}

// ── Stubs de serviços ────────────────────────────────────────────────────────

class WsStub {
  private subjects: Record<string, Subject<any>> = {};

  /** Retorna (e cria se necessário) o Subject para um dado evento WS. */
  private subject(event: string): Subject<any> {
    if (!this.subjects[event]) this.subjects[event] = new Subject();
    return this.subjects[event];
  }

  /** Emite um evento WS para os ouvintes do componente. */
  emit(event: string, payload: unknown): void {
    this.subject(event).next(payload);
  }

  // Métodos que o componente subscreve
  onTelemetryUpdate()        { return this.subject('telemetry_update').asObservable(); }
  onTelemetryProgress()      { return this.subject('telemetry_progress').asObservable(); }
  onTelemetryComplete()      { return this.subject('telemetry_complete').asObservable(); }
  onTelemetryAlert()         { return this.subject('telemetry_alert').asObservable(); }
  onTelemetryAlertResolved() { return this.subject('telemetry_alert_resolved').asObservable(); }
  onTelemetryAlertBatch()    { return this.subject('telemetry_alert_batch').asObservable(); }
  onAnalysisUpdate()         { return this.subject('analysis_update').asObservable(); }
  onDriverAcquired()         { return this.subject('driver_acquired').asObservable(); }
  onViewOnly()               { return this.subject('view_only').asObservable(); }
  onForceViewOnly()          { return this.subject('force_view_only').asObservable(); }
  onDriverReleased()         { return this.subject('driver_released').asObservable(); }
  onViewersUpdated()         { return this.subject('viewers_updated').asObservable(); }
  onCpeLocked()              { return this.subject('cpe_locked').asObservable(); }
  onCpeUnlocked()            { return this.subject('cpe_unlocked').asObservable(); }
  onCpeValueChange()         { return this.subject('cpe_value_change').asObservable(); }

  subscribeToCpe   = jasmine.createSpy('subscribeToCpe');
  unsubscribeFromCpe = jasmine.createSpy('unsubscribeFromCpe');
  emitDriverKeepalive = jasmine.createSpy('emitDriverKeepalive');
  isConnected = true;
}

class CpeServiceStub {
  requestTelemetry   = jasmine.createSpy().and.returnValue(of({ status: 'queued' }));
  requestVitals      = jasmine.createSpy().and.returnValue(of({ status: 'queued' }));
  getLatestVitals    = jasmine.createSpy().and.returnValue(of({ success: true, data: {} }));
  getTelemetryCache  = jasmine.createSpy().and.returnValue(EMPTY);
  getTelemetryAnalysis = jasmine.createSpy().and.returnValue(EMPTY);
  getTelemetryVitalsHistory = jasmine.createSpy().and.returnValue(
    of({ success: true, data: [], count: 0 })
  );
  getHealthScoreBreakdown = jasmine.createSpy().and.returnValue(EMPTY);
  getCpeAlerts = jasmine.createSpy().and.returnValue(of({ data: [] }));
  getIncidentStatus = jasmine.createSpy().and.returnValue(
    of({ active: false, expiresInSeconds: null })
  );
  getLastIntervention = jasmine.createSpy().and.returnValue(of({ found: false }));
  updateWanConfig = jasmine.createSpy().and.returnValue(of({}));
}

class ToastStub {
  success = jasmine.createSpy('success');
  error   = jasmine.createSpy('error');
  warning = jasmine.createSpy('warning');
  info    = jasmine.createSpy('info');
}

class CacheSvcStub {
  saveLatestTelemetry = jasmine.createSpy('saveLatestTelemetry');
  loadLatestTelemetry = jasmine.createSpy('loadLatestTelemetry').and.returnValue(null);
  saveHistory         = jasmine.createSpy('saveHistory').and.returnValue(Promise.resolve());
  loadHistory         = jasmine.createSpy('loadHistory').and.returnValue(Promise.resolve(null));
  clearSerialHistory  = jasmine.createSpy('clearSerialHistory').and.returnValue(Promise.resolve());
}

// ── Suite principal ───────────────────────────────────────────────────────────

describe('CpeInfoTabComponent', () => {
  let fixture:   ComponentFixture<CpeInfoTabComponent>;
  let component: CpeInfoTabComponent;
  let cpeStub:   CpeServiceStub;
  let wsStub:    WsStub;
  let toastStub: ToastStub;
  let cacheStub: CacheSvcStub;

  beforeEach(async () => {
    cpeStub   = new CpeServiceStub();
    wsStub    = new WsStub();
    toastStub = new ToastStub();
    cacheStub = new CacheSvcStub();

    await TestBed.configureTestingModule({
      imports: [CpeInfoTabComponent, HttpClientTestingModule],
      providers: [
        { provide: CpeService,           useValue: cpeStub   },
        { provide: WebSocketService,     useValue: wsStub    },
        { provide: ToastService,         useValue: toastStub },
        { provide: TelemetryCacheService, useValue: cacheStub },
        { provide: DiagnosticParserService, useValue: {
            parseOmciRx:      (v: string) => parseFloat(v) / 500,
            parseOmciTx:      (v: string) => parseFloat(v) / 1000,
            parseOmciTemp:    (v: string) => parseFloat(v) / 256,
            parseOmciVoltage: (v: string) => parseFloat(v) * 0.0001,
            parseOmciBias:    (v: string) => parseFloat(v) * 0.002,
          }
        },
        { provide: PLATFORM_ID, useValue: 'browser' },
      ],
      // NO_ERRORS_SCHEMA evita erro de componentes externos (ng2-charts, etc.)
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();

    fixture   = TestBed.createComponent(CpeInfoTabComponent);
    component = fixture.componentInstance;
    component.serialNumber = 'TEST001';
    component.cpe = makeCpe();
  });

  afterEach(() => {
    // Garante cleanup de timers pendentes
    fixture.destroy();
  });

  // ── 1. Criação ───────────────────────────────────────────────────────────

  describe('Criação', () => {
    it('deve ser criado com sucesso', () => {
      fixture.detectChanges();
      expect(component).toBeTruthy();
    });

    it('deve ter os valores padrão corretos', () => {
      expect(component.telemetryData).toBeNull();
      expect(component.telemetryLoading).toBeFalse();
      expect(component.vitalsLoading).toBeFalse();
      expect(component.isViewOnly).toBeFalse();
      expect(component.isCpeBusy).toBeFalse();
      expect(component.selectedPeriodHours).toBe(6);
      expect(component.wifiTabSelected).toBe('2g');
    });

    it('deve subscribir à sala WebSocket no ngOnInit', () => {
      fixture.detectChanges();
      expect(wsStub.subscribeToCpe).toHaveBeenCalledWith('TEST001');
    });

    it('deve cancelar subscrição da sala WebSocket no ngOnDestroy', () => {
      fixture.detectChanges();
      fixture.destroy();
      expect(wsStub.unsubscribeFromCpe).toHaveBeenCalledWith('TEST001');
    });
  });

  // ── 2. Getters puros ─────────────────────────────────────────────────────

  describe('Getters puros', () => {
    beforeEach(() => fixture.detectChanges());

    describe('formatUptimeHuman()', () => {
      it('retorna "—" para null', () => expect(component.formatUptimeHuman(null)).toBe('—'));
      it('retorna "—" para NaN', () => expect(component.formatUptimeHuman(NaN)).toBe('—'));
      it('retorna segundos quando < 60s', () => expect(component.formatUptimeHuman(45)).toBe('45s'));
      it('retorna minutos quando 60–3599s', () => expect(component.formatUptimeHuman(90)).toBe('1m'));
      it('retorna horas quando 3600–86399s', () => expect(component.formatUptimeHuman(7200)).toBe('2h'));
      it('retorna dias quando >= 86400s', () => expect(component.formatUptimeHuman(86400)).toBe('1d'));
      it('retorna "2d 3h" para 2 dias e 3 horas', () => expect(component.formatUptimeHuman(86400 * 2 + 3600 * 3)).toBe('2d 3h'));
      it('omite horas quando resto é zero (ex: "3d")', () => expect(component.formatUptimeHuman(86400 * 3)).toBe('3d'));
    });

    describe('ramUsagePercent', () => {
      it('retorna null quando telemetryData é null', () => {
        component.telemetryData = null;
        expect(component.ramUsagePercent).toBeNull();
      });

      it('retorna null quando memoryTotal é 0 (evita divisão por zero)', () => {
        component.telemetryData = makeTelemetry({ memoryFree: 0, memoryTotal: 0 });
        expect(component.ramUsagePercent).toBeNull();
      });

      it('calcula percentual correto (50% uso)', () => {
        // memFree=64000, memTotal=128000 → uso = 64000/128000 = 50%
        component.telemetryData = makeTelemetry({ memoryFree: 64000, memoryTotal: 128000 });
        expect(component.ramUsagePercent).toBe(50);
      });

      it('calcula corretamente quando uso é 0% (tudo livre)', () => {
        component.telemetryData = makeTelemetry({ memoryFree: 128000, memoryTotal: 128000 });
        expect(component.ramUsagePercent).toBe(0);
      });

      it('suporta telemetryData no formato TelemetryMetric {value, unit}', () => {
        component.telemetryData = {
          memoryFree:  { value: '32000', unit: 'KB', description: '' },
          memoryTotal: { value: '128000', unit: 'KB', description: '' },
        };
        expect(component.ramUsagePercent).toBe(75);
      });
    });

    describe('rxZone / txZone', () => {
      it('rxZone retorna "unknown" quando opticalRx não existe', () => {
        component.telemetryData = {};
        expect(component.rxZone).toBe('unknown');
      });

      it('rxZone retorna "ok" para valor >= -22 dBm', () => {
        component.telemetryData = makeTelemetry({ opticalRx: -20 });
        expect(component.rxZone).toBe('ok');
      });

      it('rxZone retorna "warning" para valor entre -22 e -27 dBm', () => {
        component.telemetryData = makeTelemetry({ opticalRx: -25 });
        expect(component.rxZone).toBe('warning');
      });

      it('rxZone retorna "critical" para valor < -27 dBm', () => {
        component.telemetryData = makeTelemetry({ opticalRx: -30 });
        expect(component.rxZone).toBe('critical');
      });

      it('txZone retorna "ok" para valor >= -5 dBm', () => {
        component.telemetryData = makeTelemetry({ opticalTx: -3 });
        expect(component.txZone).toBe('ok');
      });

      it('txZone retorna "warning" para valor entre -5 e -8 dBm', () => {
        component.telemetryData = makeTelemetry({ opticalTx: -6 });
        expect(component.txZone).toBe('warning');
      });

      it('txZone retorna "critical" para valor < -8 dBm', () => {
        component.telemetryData = makeTelemetry({ opticalTx: -10 });
        expect(component.txZone).toBe('critical');
      });
    });

    describe('isRxCritical', () => {
      it('retorna false quando telemetryData é null', () => {
        component.telemetryData = null;
        expect(component.isRxCritical).toBeFalse();
      });

      it('retorna false quando RX está em zona ok', () => {
        component.telemetryData = makeTelemetry({ opticalRx: -20 });
        expect(component.isRxCritical).toBeFalse();
      });

      it('retorna true quando RX está abaixo do threshold critical (-27)', () => {
        component.telemetryData = makeTelemetry({ opticalRx: -30 });
        expect(component.isRxCritical).toBeTrue();
      });
    });

    describe('activeAlerts', () => {
      it('retorna apenas alertas com status "active"', () => {
        component.cpeAlerts = [
          makeAlert({ status: 'active' }),
          makeAlert({ status: 'resolved' }),
          makeAlert({ status: 'active' }),
        ];
        expect(component.activeAlerts.length).toBe(2);
        expect(component.activeAlerts.every(a => a.status === 'active')).toBeTrue();
      });

      it('limita a 10 alertas mesmo que hajam mais', () => {
        component.cpeAlerts = Array.from({ length: 15 }, (_, i) =>
          makeAlert({ metric: `metric${i}`, triggeredAt: new Date(i * 1000).toISOString() })
        );
        expect(component.activeAlerts.length).toBe(10);
      });
    });

    describe('sortedAnalysisEntries', () => {
      it('retorna array vazio quando analysisData é null', () => {
        component.analysisData = null;
        expect(component.sortedAnalysisEntries).toEqual([]);
      });

      it('ordena: critical antes de warning antes de ok', () => {
        component.analysisData = {
          serialNumber: 'TEST001',
          analyzedAt: new Date().toISOString(),
          summary: { overallHealth: 'warning', alertCount: 2, alerts: [] },
          analyses: {
            a: { severity: 'ok',       message: 'ok' },
            b: { severity: 'critical', message: 'crit' },
            c: { severity: 'warning',  message: 'warn' },
          },
        } as any;
        const entries = component.sortedAnalysisEntries;
        expect(entries[0].data.severity).toBe('critical');
        expect(entries[1].data.severity).toBe('warning');
        expect(entries[2].data.severity).toBe('ok');
      });
    });

    describe('cacheLabel', () => {
      it('retorna "Nenhuma telemetria disponível" quando lastUpdated é null', () => {
        component.lastUpdated = null;
        expect(component.cacheLabel).toBe('Nenhuma telemetria disponível');
      });

      it('retorna "Atualizado agora · via TR-069" quando menos de 5s', () => {
        component.lastUpdated = new Date();
        expect(component.cacheLabel).toBe('Atualizado agora · via TR-069');
      });

      it('retorna "Atualizado há Xs" para menos de 60s', () => {
        component.lastUpdated = new Date(Date.now() - 30_000);
        expect(component.cacheLabel).toMatch(/Atualizado há \d+s/);
      });

      it('retorna "Atualizado há Xmin" para >= 60s', () => {
        component.lastUpdated = new Date(Date.now() - 120_000);
        expect(component.cacheLabel).toMatch(/Atualizado há \d+min/);
      });
    });

    describe('stringValue()', () => {
      it('retorna null quando telemetryData é null', () => {
        component.telemetryData = null;
        expect(component.stringValue('wanStatus')).toBeNull();
      });

      it('retorna null quando chave não existe', () => {
        component.telemetryData = makeTelemetry();
        expect(component.stringValue('inexistente')).toBeNull();
      });

      it('retorna string de valor primitivo', () => {
        component.telemetryData = { wanStatus: 'connected' };
        expect(component.stringValue('wanStatus')).toBe('connected');
      });

      it('retorna string de TelemetryMetric { value }', () => {
        component.telemetryData = {
          gponStatus: { value: 'up', unit: '', description: '' }
        };
        expect(component.stringValue('gponStatus')).toBe('up');
      });
    });

    describe('overallHealthLabel', () => {
      it('retorna "Desconhecido" quando analysisData é null', () => {
        component.analysisData = null;
        expect(component.overallHealthLabel).toBe('Desconhecido');
      });

      it('traduz "good" → "Bom"', () => {
        component.analysisData = { summary: { overallHealth: 'good' } } as any;
        expect(component.overallHealthLabel).toBe('Bom');
      });

      it('traduz "critical" → "Crítico"', () => {
        component.analysisData = { summary: { overallHealth: 'critical' } } as any;
        expect(component.overallHealthLabel).toBe('Crítico');
      });

      it('traduz "warning" → "Atenção"', () => {
        component.analysisData = { summary: { overallHealth: 'warning' } } as any;
        expect(component.overallHealthLabel).toBe('Atenção');
      });
    });

    describe('isRefreshInCooldown / refreshButtonLabel', () => {
      it('isRefreshInCooldown é false quando contador é 0', () => {
        component['refreshCountdownSeconds'] = 0;
        expect(component.isRefreshInCooldown).toBeFalse();
      });

      it('isRefreshInCooldown é true quando contador > 0', () => {
        component['refreshCountdownSeconds'] = 30;
        expect(component.isRefreshInCooldown).toBeTrue();
      });

      it('refreshButtonLabel retorna "Coletar Dados" quando contador é 0', () => {
        component['refreshCountdownSeconds'] = 0;
        expect(component.refreshButtonLabel).toBe('Coletar Dados');
      });

      it('refreshButtonLabel inclui contador regressivo quando > 0', () => {
        component['refreshCountdownSeconds'] = 42;
        expect(component.refreshButtonLabel).toBe('Coletar Dados (42s)');
      });
    });
  });

  // ── 3. healthScoreColor / healthScoreBadge ───────────────────────────────

  describe('healthScoreColor()', () => {
    beforeEach(() => fixture.detectChanges());

    it('retorna classe verde para score >= 80', () => {
      expect(component.healthScoreColor(90)).toBe('bg-green-500');
      expect(component.healthScoreColor(80)).toBe('bg-green-500');
    });

    it('retorna classe amarela para 50 <= score < 80', () => {
      expect(component.healthScoreColor(50)).toBe('bg-yellow-400');
      expect(component.healthScoreColor(79)).toBe('bg-yellow-400');
    });

    it('retorna classe vermelha para score < 50', () => {
      expect(component.healthScoreColor(0)).toBe('bg-red-500');
      expect(component.healthScoreColor(49)).toBe('bg-red-500');
    });
  });

  describe('usageBarColor()', () => {
    beforeEach(() => fixture.detectChanges());

    it('retorna vermelho para pct >= 85', () => {
      expect(component.usageBarColor(85)).toBe('bg-red-500');
      expect(component.usageBarColor(100)).toBe('bg-red-500');
    });

    it('retorna amarelo para 70 <= pct < 85', () => {
      expect(component.usageBarColor(70)).toBe('bg-yellow-400');
      expect(component.usageBarColor(84)).toBe('bg-yellow-400');
    });

    it('retorna verde para pct < 70', () => {
      expect(component.usageBarColor(69)).toBe('bg-green-500');
      expect(component.usageBarColor(0)).toBe('bg-green-500');
    });
  });

  // ── 4. TrackBy helpers ───────────────────────────────────────────────────

  describe('TrackBy helpers', () => {
    beforeEach(() => fixture.detectChanges());

    it('trackByAnalysisKey retorna a chave da entry', () => {
      const entry = { key: 'opticalTrend', data: {} };
      expect(component.trackByAnalysisKey(0, entry)).toBe('opticalTrend');
    });

    it('trackByAlertSeverityMsg retorna metric+triggeredAt', () => {
      const alert = makeAlert({ metric: 'cpuUsage', triggeredAt: '2024-01-01T00:00:00Z' });
      const result = component.trackByAlertSeverityMsg(0, alert);
      expect(result).toBe('cpuUsage2024-01-01T00:00:00Z');
    });

    it('trackByKvKey retorna a chave', () => {
      expect(component.trackByKvKey(0, { key: 'connectivity' } as any)).toBe('connectivity');
    });
  });

  // ── 5. timeAgo() ────────────────────────────────────────────────────────

  describe('timeAgo()', () => {
    beforeEach(() => fixture.detectChanges());

    it('retorna string vazia para timestamp undefined', () => {
      expect(component.timeAgo(undefined)).toBe('');
    });

    it('retorna "agora" para menos de 1 minuto', () => {
      expect(component.timeAgo(new Date().toISOString())).toBe('agora');
    });

    it('retorna "há Xmin" para menos de 1 hora', () => {
      const ts = new Date(Date.now() - 5 * 60_000).toISOString();
      expect(component.timeAgo(ts)).toBe('há 5min');
    });

    it('retorna "há Xh" para menos de 24 horas', () => {
      const ts = new Date(Date.now() - 3 * 3600_000).toISOString();
      expect(component.timeAgo(ts)).toBe('há 3h');
    });

    it('retorna "há Xd" para 1+ dias', () => {
      const ts = new Date(Date.now() - 2 * 86400_000).toISOString();
      expect(component.timeAgo(ts)).toBe('há 2d');
    });
  });

  // ── 6. alertIcon / analysisBadge / opticalZoneClass ─────────────────────

  describe('alertIcon()', () => {
    beforeEach(() => fixture.detectChanges());

    it('retorna 🔴 para "critical"', () => expect(component.alertIcon('critical')).toBe('🔴'));
    it('retorna ⚠️ para "warning"',  () => expect(component.alertIcon('warning')).toBe('⚠️'));
  });

  describe('analysisBadge()', () => {
    beforeEach(() => fixture.detectChanges());

    it('retorna 🔴 para severity critical', () => {
      expect(component.analysisBadge({ severity: 'critical' })).toBe('🔴');
    });
    it('retorna ⚠️ para severity warning', () => {
      expect(component.analysisBadge({ severity: 'warning' })).toBe('⚠️');
    });
    it('retorna ✅ para severity ok', () => {
      expect(component.analysisBadge({ severity: 'ok' })).toBe('✅');
    });
    it('retorna ✅ para status normal', () => {
      expect(component.analysisBadge({ status: 'normal' })).toBe('✅');
    });
    it('retorna "" quando sem severidade', () => {
      expect(component.analysisBadge({})).toBe('');
    });
  });

  describe('opticalZoneClass()', () => {
    beforeEach(() => fixture.detectChanges());

    it('retorna classe verde para ok', () => {
      expect(component.opticalZoneClass('ok')).toContain('text-green-500');
    });
    it('retorna classe amarela para warning', () => {
      expect(component.opticalZoneClass('warning')).toContain('text-yellow-500');
    });
    it('retorna classe vermelha para critical', () => {
      expect(component.opticalZoneClass('critical')).toContain('text-red-500');
    });
    it('retorna classe cinza para unknown', () => {
      expect(component.opticalZoneClass('unknown')).toContain('text-gray-400');
    });
  });

  // ── 7. Flash visual ──────────────────────────────────────────────────────

  describe('Flash visual (triggerFlash / hasFlash)', () => {
    beforeEach(() => fixture.detectChanges());

    it('hasFlash retorna false para métrica não-piscando', () => {
      expect(component.hasFlash('cpuUsage')).toBeFalse();
    });

    it('hasFlash retorna true após triggerFlash', fakeAsync(() => {
      component.triggerFlash('cpuUsage');
      expect(component.hasFlash('cpuUsage')).toBeTrue();
      tick(2001); // FLASH_DURATION_MS = 2000
      expect(component.hasFlash('cpuUsage')).toBeFalse();
    }));

    it('não recria timer se a métrica já está piscando', fakeAsync(() => {
      component.triggerFlash('cpuUsage');
      const timerSizeBefore = (component as any).flashTimers.size;
      component.triggerFlash('cpuUsage'); // duplicado — não deve adicionar
      expect((component as any).flashTimers.size).toBe(timerSizeBefore);
      tick(2001);
      discardPeriodicTasks();
    }));

    it('respeita limite MAX_FLASH_TIMERS sem lançar exceção', fakeAsync(() => {
      // Enche até o limite
      for (let i = 0; i < 35; i++) {
        component.triggerFlash(`metric_${i}`);
      }
      // Não deve lançar exceção — timers além do limite são ignorados
      expect((component as any).flashTimers.size).toBeLessThanOrEqual(30);
      tick(2001);
      discardPeriodicTasks();
    }));
  });

  // ── 8. autoSelectWifiTab ─────────────────────────────────────────────────

  describe('autoSelectWifiTab()', () => {
    beforeEach(() => fixture.detectChanges());

    it('seleciona "5g" quando só existe dado de 5GHz', () => {
      component.telemetryData = { wifi5gChannel: 36 };
      (component as any).autoSelectWifiTab();
      expect(component.wifiTabSelected).toBe('5g');
    });

    it('seleciona "2g" quando só existe dado de 2.4GHz', () => {
      component.wifiTabSelected = '5g'; // força estado inicial
      component.telemetryData = { wifi2gChannel: 6 };
      (component as any).autoSelectWifiTab();
      expect(component.wifiTabSelected).toBe('2g');
    });

    it('mantém seleção atual quando ambas as bandas existem', () => {
      component.wifiTabSelected = '5g';
      component.telemetryData = { wifi2gChannel: 6, wifi5gChannel: 36 };
      (component as any).autoSelectWifiTab();
      expect(component.wifiTabSelected).toBe('5g');
    });
  });

  // ── 9. formatMeasuredAt ──────────────────────────────────────────────────

  describe('formatMeasuredAt()', () => {
    beforeEach(() => fixture.detectChanges());

    it('retorna segundos para tempo < 60s', () => {
      const ts = new Date(Date.now() - 30_000).toISOString();
      expect(component.formatMeasuredAt(ts)).toMatch(/\d+s/);
    });

    it('retorna minutos para tempo entre 60s e 3600s', () => {
      const ts = new Date(Date.now() - 300_000).toISOString();
      expect(component.formatMeasuredAt(ts)).toMatch(/\d+min/);
    });

    it('retorna horas para tempo > 3600s', () => {
      const ts = new Date(Date.now() - 7200_000).toISOString();
      expect(component.formatMeasuredAt(ts)).toMatch(/\d+h/);
    });
  });

  // ── 10. WebSocket: telemetry_update ─────────────────────────────────────

  describe('WebSocket: telemetry_update', () => {
    beforeEach(() => fixture.detectChanges());

    it('atualiza telemetryData ao receber evento para o serialNumber correto', () => {
      const data = makeTelemetry({ cpuUsage: 77 });
      wsStub.emit('telemetry_update', {
        serialNumber: 'TEST001',
        data,
        timestamp: new Date().toISOString(),
        source: 'standard',
      });
      expect(component.telemetryData?.['cpuUsage']).toBe(77);
    });

    it('ignora evento de outro serialNumber', () => {
      component.telemetryData = makeTelemetry({ cpuUsage: 10 });
      wsStub.emit('telemetry_update', {
        serialNumber: 'OUTRO_CPE',
        data: makeTelemetry({ cpuUsage: 99 }),
        timestamp: new Date().toISOString(),
      });
      expect(component.telemetryData?.['cpuUsage']).toBe(10);
    });

    it('faz merge parcial para source "vitals"', () => {
      component.telemetryData = makeTelemetry({ opticalTx: -3 });
      wsStub.emit('telemetry_update', {
        serialNumber: 'TEST001',
        data: { cpuUsage: 55, wanStatus: 'connected' },
        timestamp: new Date().toISOString(),
        source: 'vitals',
      });
      // opticalTx pré-existente deve ser preservado
      expect(component.telemetryData?.['opticalTx']).toBe(-3);
      // novos campos vitals devem ser mesclados
      expect(component.telemetryData?.['cpuUsage']).toBe(55);
    });

    it('processa todos os campos para source "standard"', () => {
      component.telemetryData = {};
      wsStub.emit('telemetry_update', {
        serialNumber: 'TEST001',
        data: makeTelemetry({ opticalTx: -4, wifi5gChannel: 100 }),
        timestamp: new Date().toISOString(),
        source: 'standard',
      });
      expect(component.telemetryData?.['opticalTx']).toBe(-4);
      expect(component.telemetryData?.['wifi5gChannel']).toBe(100);
    });

    it('desliga vitalsLoading ao receber qualquer telemetry_update', () => {
      component['vitalsLoading'] = true;
      wsStub.emit('telemetry_update', {
        serialNumber: 'TEST001',
        data: makeTelemetry(),
        timestamp: new Date().toISOString(),
        source: 'standard',
      });
      expect(component.vitalsLoading).toBeFalse();
    });

    it('marca isPartialResult quando partial=true', () => {
      wsStub.emit('telemetry_update', {
        serialNumber: 'TEST001',
        data: makeTelemetry(),
        timestamp: new Date().toISOString(),
        partial: true,
      });
      expect(component.isPartialResult).toBeTrue();
    });

    it('atualiza lastUpdated com o timestamp do evento', () => {
      const ts = '2024-06-01T12:00:00.000Z';
      wsStub.emit('telemetry_update', {
        serialNumber: 'TEST001',
        data: makeTelemetry(),
        timestamp: ts,
        source: 'standard',
      });
      expect(component.lastUpdated?.toISOString()).toBe(ts);
    });
  });

  // ── 11. WebSocket: telemetry_complete ────────────────────────────────────

  describe('WebSocket: telemetry_complete', () => {
    beforeEach(() => fixture.detectChanges());

    it('desliga telemetryLoading ao completar coleta solicitada pelo usuário', () => {
      component['telemetryLoading'] = true;
      component['userRequestedTelemetry'] = true;
      wsStub.emit('telemetry_complete', {
        serialNumber: 'TEST001',
        timestamp: new Date().toISOString(),
        totalChunks: 5,
        source: 'on-demand',
        partial: false,
      });
      expect(component.telemetryLoading).toBeFalse();
    });

    it('ignora evento de outro serialNumber', () => {
      component['telemetryLoading'] = true;
      component['userRequestedTelemetry'] = true;
      wsStub.emit('telemetry_complete', {
        serialNumber: 'OUTRO',
        timestamp: new Date().toISOString(),
        totalChunks: 1,
        source: 'on-demand',
        partial: false,
      });
      expect(component.telemetryLoading).toBeTrue();
    });

    it('não fecha spinner se a source é "standard" e usuário não solicitou', () => {
      component['telemetryLoading'] = true;
      component['userRequestedTelemetry'] = false;
      wsStub.emit('telemetry_complete', {
        serialNumber: 'TEST001',
        timestamp: new Date().toISOString(),
        totalChunks: 1,
        source: 'standard',
        partial: false,
      });
      expect(component.telemetryLoading).toBeTrue();
    });

    it('define isPartialResult=true quando partial=true', () => {
      component['userRequestedTelemetry'] = true;
      wsStub.emit('telemetry_complete', {
        serialNumber: 'TEST001',
        timestamp: new Date().toISOString(),
        totalChunks: 3,
        source: 'on-demand',
        partial: true,
      });
      expect(component.isPartialResult).toBeTrue();
    });
  });

  // ── 12. WebSocket: telemetry_progress ───────────────────────────────────

  describe('WebSocket: telemetry_progress', () => {
    beforeEach(() => fixture.detectChanges());

    it('atualiza telemetryProgress com o percentual recebido', () => {
      wsStub.emit('telemetry_progress', {
        serialNumber: 'TEST001',
        completedChunks: 2,
        totalChunks: 5,
        percent: 40,
      });
      expect(component.telemetryProgress).toBe(40);
    });

    it('ignora evento de outro serialNumber', () => {
      component.telemetryProgress = 0;
      wsStub.emit('telemetry_progress', {
        serialNumber: 'OUTRO',
        completedChunks: 3,
        totalChunks: 5,
        percent: 60,
      });
      expect(component.telemetryProgress).toBe(0);
    });
  });

  // ── 13. WebSocket: alertas ───────────────────────────────────────────────

  describe('WebSocket: telemetry_alert', () => {
    beforeEach(() => fixture.detectChanges());

    it('adiciona alerta ao array cpeAlerts', () => {
      wsStub.emit('telemetry_alert', {
        serialNumber: 'TEST001',
        metric: 'opticalRx',
        severity: 'critical',
        value: -32,
        message: 'Sinal crítico',
        timestamp: new Date().toISOString(),
      });
      expect(component.cpeAlerts.length).toBe(1);
      expect(component.cpeAlerts[0].metric).toBe('opticalRx');
      expect(component.cpeAlerts[0].status).toBe('active');
    });

    it('limita cpeAlerts a 50 entradas', () => {
      // Insere 60 alertas
      for (let i = 0; i < 60; i++) {
        wsStub.emit('telemetry_alert', {
          serialNumber: 'TEST001',
          metric: `m${i}`,
          severity: 'warning',
          value: i,
          message: `msg${i}`,
          timestamp: new Date().toISOString(),
        });
      }
      expect(component.cpeAlerts.length).toBe(50);
    });

    it('ignora alerta de outro serialNumber', () => {
      wsStub.emit('telemetry_alert', {
        serialNumber: 'OUTRO',
        metric: 'cpuUsage',
        severity: 'warning',
        value: 90,
        message: 'CPU alto',
        timestamp: new Date().toISOString(),
      });
      expect(component.cpeAlerts.length).toBe(0);
    });
  });

  describe('WebSocket: telemetry_alert_resolved', () => {
    beforeEach(() => fixture.detectChanges());

    it('remove o alerta correspondente do array', () => {
      component.cpeAlerts = [
        makeAlert({ metric: 'cpuUsage' }),
        makeAlert({ metric: 'opticalRx' }),
      ];
      wsStub.emit('telemetry_alert_resolved', {
        serialNumber: 'TEST001',
        metric: 'cpuUsage',
        timestamp: new Date().toISOString(),
      });
      expect(component.cpeAlerts.length).toBe(1);
      expect(component.cpeAlerts[0].metric).toBe('opticalRx');
    });
  });

  // ── 14. WebSocket: presença (Single Driver) ──────────────────────────────

  describe('WebSocket: presença (Single Driver)', () => {
    beforeEach(() => fixture.detectChanges());

    it('sai do modo view-only ao receber driver_acquired', () => {
      component['isViewOnly'] = true;
      wsStub.emit('driver_acquired', { serialNumber: 'TEST001', username: 'tech1' });
      expect(component.isViewOnly).toBeFalse();
    });

    it('entra em modo view-only ao receber view_only', () => {
      wsStub.emit('view_only', {
        serialNumber: 'TEST001',
        driver: 'tech2',
        message: 'Outro técnico está controlando esta CPE.',
      });
      expect(component.isViewOnly).toBeTrue();
    });

    it('entra em modo view-only ao receber force_view_only', () => {
      wsStub.emit('force_view_only', {
        serialNumber: 'TEST001',
        message: 'Forçado.',
      });
      expect(component.isViewOnly).toBeTrue();
    });

    it('sai do modo view-only ao receber driver_released', () => {
      component['isViewOnly'] = true;
      wsStub.emit('driver_released', { serialNumber: 'TEST001' });
      expect(component.isViewOnly).toBeFalse();
    });

    it('atualiza viewers ao receber viewers_updated', () => {
      wsStub.emit('viewers_updated', {
        serialNumber: 'TEST001',
        viewers: ['tech1', 'tech2'],
      });
      expect(component.viewers).toEqual(['tech1', 'tech2']);
    });

    it('seta isCpeBusy=true ao receber cpe_locked', () => {
      wsStub.emit('cpe_locked', { serialNumber: 'TEST001', source: 'telemetry' });
      expect(component.isCpeBusy).toBeTrue();
    });

    it('seta isCpeBusy=false ao receber cpe_unlocked', () => {
      component['isCpeBusy'] = true;
      wsStub.emit('cpe_unlocked', { serialNumber: 'TEST001' });
      expect(component.isCpeBusy).toBeFalse();
    });

    it('ignora eventos de outro serialNumber', () => {
      component['isViewOnly'] = false;
      wsStub.emit('view_only', { serialNumber: 'OUTRO', driver: 'x', message: '' });
      expect(component.isViewOnly).toBeFalse();
    });
  });

  // ── 15. WebSocket: analysis_update ──────────────────────────────────────

  describe('WebSocket: analysis_update', () => {
    beforeEach(() => fixture.detectChanges());

    it('atualiza analysisData e analysisUpdatedAt ao receber evento', () => {
      const analysis = { serialNumber: 'TEST001', analyses: {}, summary: {} } as any;
      const ts = '2024-06-01T10:00:00Z';
      wsStub.emit('analysis_update', {
        serialNumber: 'TEST001',
        analysis,
        timestamp: ts,
      });
      expect(component.analysisData).toEqual(analysis);
      expect(component.analysisUpdatedAt?.toISOString()).toBe(new Date(ts).toISOString());
    });
  });

  // ── 16. requestTelemetry() ───────────────────────────────────────────────

  describe('requestTelemetry()', () => {
    beforeEach(() => fixture.detectChanges());

    it('chama cpeService.requestTelemetry com o serialNumber correto', () => {
      component.requestTelemetry();
      expect(cpeStub.requestTelemetry).toHaveBeenCalledWith('TEST001');
    });

    it('não chama a API quando serialNumber é inválido', () => {
      component.serialNumber = '';
      component.requestTelemetry();
      expect(cpeStub.requestTelemetry).not.toHaveBeenCalled();
      expect(toastStub.error).toHaveBeenCalled();
    });

    it('não chama a API durante cooldown e exibe toast de info', () => {
      component['refreshCountdownSeconds'] = 30;
      component.requestTelemetry();
      expect(cpeStub.requestTelemetry).not.toHaveBeenCalled();
      expect(toastStub.info).toHaveBeenCalled();
    });

    it('ativa telemetryLoading ao iniciar', fakeAsync(() => {
      component.requestTelemetry();
      expect(component.telemetryLoading).toBeTrue();
      // Drena o setTimeout de 45s criado por requestTelemetry, depois os intervals do heartbeat
      tick(TELEMETRY_CONFIG_TEST.REQUEST_TIMEOUT_MS);
      discardPeriodicTasks();
      // Após timeout, telemetryLoading deve ter sido resetado pelo handler interno
      expect(component.telemetryLoading).toBeFalse();
    }));

    it('exibe toast de erro quando API falha', fakeAsync(() => {
      cpeStub.requestTelemetry.and.returnValue(throwError(() => ({ error: { error: 'CPE offline' } })));
      component.requestTelemetry();
      tick(1);
      expect(toastStub.error).toHaveBeenCalledWith('CPE offline');
      expect(component.telemetryLoading).toBeFalse();
      // requestTelemetry cria um setTimeout de 45s (telemetryTimeoutId) — precisa ser drenado
      // staggered init (150ms, 300ms, 450ms) já foram absorvidos no ngOnInit via detectChanges
      tick(45000);
      discardPeriodicTasks();
    }));

    it('exibe toast de info para cache hit', fakeAsync(() => {
      cpeStub.requestTelemetry.and.returnValue(of({
        source: 'cache',
        cacheAgeMs: 5000,
        message: 'dados do cache',
      }));
      component.requestTelemetry();
      tick(1);
      expect(toastStub.info).toHaveBeenCalled();
      expect(component.telemetryLoading).toBeFalse();
      // requestTelemetry cria um setTimeout de 45s — drena antes de fechar fakeAsync
      tick(45000);
      // startRefreshCooldown cria setInterval de cooldown — descarta com discardPeriodicTasks
      discardPeriodicTasks();
    }));
  });

  // ── 17. requestVitals() ──────────────────────────────────────────────────

  describe('requestVitals()', () => {
    beforeEach(() => fixture.detectChanges());

    it('chama cpeService.requestVitals com o serialNumber correto', () => {
      component.requestVitals();
      expect(cpeStub.requestVitals).toHaveBeenCalledWith('TEST001');
    });

    it('não chama a API quando serialNumber é inválido', () => {
      component.serialNumber = 'XX'; // < 4 chars → inválido
      component.requestVitals();
      expect(cpeStub.requestVitals).not.toHaveBeenCalled();
    });

    it('não chama a API quando vitalsLoading já é true (debounce)', () => {
      component['vitalsLoading'] = true;
      component.requestVitals();
      expect(cpeStub.requestVitals).not.toHaveBeenCalled();
    });

    it('exibe toast de erro quando API falha', fakeAsync(() => {
      cpeStub.requestVitals.and.returnValue(throwError(() => ({
        error: { error: 'Timeout vitals' }
      })));
      component.requestVitals();
      // retry({ count: 2, delay: 2000 }) → aguarda 2 tentativas × 2000ms antes do catchError
      tick(4001);
      expect(toastStub.error).toHaveBeenCalled();
      expect(component.vitalsLoading).toBeFalse();
      // Drena timers de staggered init (150ms, 300ms, 450ms) — já consumidos pelo tick(4001)
      discardPeriodicTasks();
    }));
  });

  // ── 18. saveWanConfig() ──────────────────────────────────────────────────

  describe('saveWanConfig()', () => {
    beforeEach(() => {
      fixture.detectChanges();
      component.cpe = makeCpe({ pppoeUsername: 'user1', wanDnsIsp: '8.8.8.8', wanMtu: 1492, wanVlanId: 100 });
      component['wanConfigFields'] = {
        pppoeUsername: 'user1',
        dnsServer1: '8.8.8.8',
        dnsServer2: '',
        mtu: 1492,
        vlanId: 100,
      };
    });

    it('exibe warning quando nenhuma alteração é detectada', () => {
      component.saveWanConfig();
      expect(toastStub.warning).toHaveBeenCalledWith('Nenhuma alteração detectada.');
      expect(cpeStub.updateWanConfig).not.toHaveBeenCalled();
    });

    it('chama updateWanConfig quando há mudança detectada', () => {
      component['wanConfigFields'].pppoeUsername = 'user2';
      component.saveWanConfig();
      expect(cpeStub.updateWanConfig).toHaveBeenCalledWith(
        'TEST001',
        jasmine.objectContaining({ pppoeUsername: 'user2' })
      );
    });

    it('exibe erro para DNS primário inválido', () => {
      component['wanConfigFields'].dnsServer1 = '999.999.999.999';
      component.saveWanConfig();
      expect(toastStub.error).toHaveBeenCalledWith(jasmine.stringMatching(/DNS Primário inválido/));
      expect(cpeStub.updateWanConfig).not.toHaveBeenCalled();
    });

    it('exibe erro para DNS secundário inválido', () => {
      component['wanConfigFields'].dnsServer2 = 'invalid';
      component.saveWanConfig();
      expect(toastStub.error).toHaveBeenCalledWith(jasmine.stringMatching(/DNS Secundário inválido/));
    });

    it('aceita DNS primário vazio (campo opcional)', () => {
      component['wanConfigFields'].pppoeUsername = 'user2';
      component['wanConfigFields'].dnsServer1 = '';
      expect(() => component.saveWanConfig()).not.toThrow();
      expect(cpeStub.updateWanConfig).toHaveBeenCalled();
    });

    it('exibe toast de sucesso após salvar', () => {
      component['wanConfigFields'].mtu = 1400;
      component.saveWanConfig();
      expect(toastStub.success).toHaveBeenCalled();
    });

    it('exibe toast de erro quando updateWanConfig falha', () => {
      cpeStub.updateWanConfig.and.returnValue(throwError(() => ({
        error: { error: 'Erro de rede' }
      })));
      component['wanConfigFields'].mtu = 1400;
      component.saveWanConfig();
      expect(toastStub.error).toHaveBeenCalledWith('Erro de rede');
    });
  });

  // ── 19. loadWanConfig() ──────────────────────────────────────────────────

  describe('loadWanConfig()', () => {
    beforeEach(() => fixture.detectChanges());

    it('preenche wanConfigFields com dados da CPE', () => {
      component.cpe = makeCpe({ pppoeUsername: 'pppe', wanDnsIsp: '1.1.1.1', wanMtu: 1400, wanVlanId: 10 });
      component.loadWanConfig();
      expect(component['wanConfigFields'].pppoeUsername).toBe('pppe');
      expect(component['wanConfigFields'].dnsServer1).toBe('1.1.1.1');
      expect(component['wanConfigFields'].mtu).toBe(1400);
      expect(component['wanConfigFields'].vlanId).toBe(10);
    });

    it('ativa isEditingWanConfig', () => {
      component.loadWanConfig();
      expect(component['isEditingWanConfig']).toBeTrue();
    });

    it('não lança exceção quando cpe é null', () => {
      component.cpe = null;
      expect(() => component.loadWanConfig()).not.toThrow();
    });
  });

  // ── 20. exportHistoryCsv() ───────────────────────────────────────────────

  describe('exportHistoryCsv()', () => {
    beforeEach(() => fixture.detectChanges());

    it('não lança exceção quando rawHistory está vazio', () => {
      component.rawHistory = [];
      expect(() => component.exportHistoryCsv()).not.toThrow();
    });

    it('cria link de download com nome correto', () => {
      const linkSpy = jasmine.createSpyObj('a', ['click']);
      linkSpy.href = '';
      linkSpy.download = '';
      spyOn(document, 'createElement').and.returnValue(linkSpy as any);
      spyOn(URL, 'createObjectURL').and.returnValue('blob:mock');
      spyOn(URL, 'revokeObjectURL');

      component.rawHistory = [{
        timestamp: '2024-01-01T00:00:00Z',
        cpuUsage: 50,
      }];
      component.exportHistoryCsv();

      expect(linkSpy.download).toMatch(/telemetria_TEST001_\d+h_\d{4}-\d{2}-\d{2}\.csv/);
      expect(linkSpy.click).toHaveBeenCalled();
      expect(URL.revokeObjectURL).toHaveBeenCalled();
    });
  });

  // ── 21. changeHistoryPeriod() ────────────────────────────────────────────

  describe('changeHistoryPeriod()', () => {
    beforeEach(() => fixture.detectChanges());

    it('não recarrega quando período é o mesmo', () => {
      const callsBefore = cpeStub.getTelemetryVitalsHistory.calls.count();
      component.changeHistoryPeriod(6); // 6 é o padrão
      expect(cpeStub.getTelemetryVitalsHistory.calls.count()).toBe(callsBefore);
    });

    it('chama loadHistory quando período muda', () => {
      const callsBefore = cpeStub.getTelemetryVitalsHistory.calls.count();
      component.changeHistoryPeriod(24);
      expect(cpeStub.getTelemetryVitalsHistory.calls.count()).toBeGreaterThan(callsBefore);
    });

    it('reseta datasets do gráfico ao mudar período', () => {
      component.changeHistoryPeriod(24);
      expect(component.chartLabels.length).toBe(0);
      expect(component.opticalChartLabels.length).toBe(0);
    });
  });

  // ── 22. ngOnChanges ──────────────────────────────────────────────────────

  describe('ngOnChanges()', () => {
    beforeEach(() => fixture.detectChanges());

    it('não lança exceção quando cpe é null', () => {
      expect(() => {
        component.ngOnChanges({ cpe: { currentValue: null, previousValue: null, firstChange: false, isFirstChange: () => false } });
      }).not.toThrow();
    });

    it('extrai fallback de telemetria quando cpe.parameters muda', () => {
      const cpe = makeCpe({
        parameters: [{ name: 'Device.SomeNS.CPUUsage', value: '42' }]
      } as any);
      component.cpe = cpe;
      component.ngOnChanges({
        cpe: { currentValue: cpe, previousValue: null, firstChange: false, isFirstChange: () => false }
      });
      // Deve não lançar exceção — fallback extraído silenciosamente
      expect(component).toBeTruthy();
    });
  });

  // ── 23. getAnalysisInfo() ────────────────────────────────────────────────

  describe('getAnalysisInfo()', () => {
    beforeEach(() => fixture.detectChanges());

    it('retorna label em português para chaves conhecidas', () => {
      expect(component.getAnalysisInfo('opticalTrend')).toBe('Tendência Óptica');
      expect(component.getAnalysisInfo('rebootStability')).toBe('Estabilidade de Reboot');
      expect(component.getAnalysisInfo('memoryLeak')).toBe('Vazamento de Memória');
    });

    it('retorna a própria chave para análises desconhecidas', () => {
      expect(component.getAnalysisInfo('chaveInexistente')).toBe('chaveInexistente');
    });
  });

  // ── 24. Heartbeat ────────────────────────────────────────────────────────

  describe('Heartbeat (emitDriverKeepalive)', () => {
    it('emite keepalive a cada 30s quando conectado', fakeAsync(() => {
      fixture.detectChanges();
      tick(30_000);
      expect(wsStub.emitDriverKeepalive).toHaveBeenCalledWith('TEST001');
      tick(30_000);
      expect(wsStub.emitDriverKeepalive).toHaveBeenCalledTimes(2);
      discardPeriodicTasks();
    }));

    it('não emite keepalive quando WebSocket está desconectado', fakeAsync(() => {
      wsStub.isConnected = false;
      fixture.detectChanges();
      tick(30_000);
      expect(wsStub.emitDriverKeepalive).not.toHaveBeenCalled();
      discardPeriodicTasks();
    }));
  });

  // ── 25. Countdown de cooldown ────────────────────────────────────────────

  describe('Cooldown de refresh', () => {
    beforeEach(() => fixture.detectChanges());

    it('inicia countdown com 60s e decrementa a cada segundo', fakeAsync(() => {
      (component as any).startRefreshCooldown(null);
      expect(component.isRefreshInCooldown).toBeTrue();
      tick(1000);
      expect(component['refreshCountdownSeconds']).toBe(59);
      tick(59_000); // zera o contador
      expect(component['refreshCountdownSeconds']).toBe(0);
      expect(component.isRefreshInCooldown).toBeFalse();
    }));

    it('para o countdown ao chamar stopRefreshCooldown', fakeAsync(() => {
      (component as any).startRefreshCooldown(null);
      tick(5000);
      (component as any).stopRefreshCooldown();
      expect(component['refreshCountdownSeconds']).toBe(0);
    }));
  });

});

// ── Constante exportada para testes (espelha TELEMETRY_CONFIG interno) ───────
// Necessário para calcular timeouts nos testes de fakeAsync
const TELEMETRY_CONFIG_TEST = {
  REQUEST_TIMEOUT_MS: 45_000,
} as const;
