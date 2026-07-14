// Caminho: src/app/features/audit-logs/audit-logs.component.spec.ts
// Testes unitários do AuditLogsComponent — foco em bugs B21, B23 (memoização e cache).

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AuditLogsComponent } from './audit-logs.component';
import { AuditLogService } from '../../core/services/audit-log.service';
import { WebSocketService } from '../../core/services/websocket.service';
import { AuthService } from '../../core/services/auth.service';
import { ToastService } from '../../core/services/toast.service';
import { of } from 'rxjs';
import { ServerLogEntry } from '../../core/models';

describe('AuditLogsComponent', () => {
  let component: AuditLogsComponent;
  let fixture: ComponentFixture<AuditLogsComponent>;

  const mockAuditLogService = {
    list: jasmine.createSpy('list').and.returnValue(of({
      data: [],
      pagination: { page: 1, limit: 50, total: 0, totalPages: 0 },
    })),
    stats: jasmine.createSpy('stats').and.returnValue(of({
      total: 0,
      byAction: [],
      byResult: [],
      byChannel: [],
    })),
  };

  const mockWebSocketService = {
    subscribeServerLogs: jasmine.createSpy('subscribeServerLogs'),
    unsubscribeServerLogs: jasmine.createSpy('unsubscribeServerLogs'),
    onServerLog: jasmine.createSpy('onServerLog').and.returnValue(of()),
    onServerLogBatch: jasmine.createSpy('onServerLogBatch').and.returnValue(of()),
  };

  const mockAuthService = {
    isAdmin: jasmine.createSpy('isAdmin').and.returnValue(true),
  };

  const mockToast = {
    error: jasmine.createSpy('error'),
    success: jasmine.createSpy('success'),
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AuditLogsComponent],
      providers: [
        { provide: AuditLogService, useValue: mockAuditLogService },
        { provide: WebSocketService, useValue: mockWebSocketService },
        { provide: AuthService, useValue: mockAuthService },
        { provide: ToastService, useValue: mockToast },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AuditLogsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => {
    mockAuditLogService.list.calls.reset();
    mockAuditLogService.stats.calls.reset();
    mockWebSocketService.subscribeServerLogs.calls.reset();
    mockWebSocketService.unsubscribeServerLogs.calls.reset();
  });

  describe('B23: filteredServerLogs memoização com ring buffer cheio', () => {
    it('deve detectar mudança quando push+shift mantém length igual (ring buffer cheio)', () => {
      const MAX = (component as any).MAX_SERVER_LOGS;
      for (let i = 0; i < MAX; i++) {
        (component as any).serverLogs.push({
          seq: i, level: 'info', timestamp: new Date().toISOString(), data: { event: `evt_${i}` },
        });
      }
      (component as any)._serverLogsVersion++;

      component.serverLogLevelFilter = 'all';
      const filtered1 = component.filteredServerLogs;
      expect(filtered1.length).toBe(MAX);

      // Simula push + shift (ring buffer cheio — length permanece MAX)
      (component as any).serverLogs.push({
        seq: MAX, level: 'error', timestamp: new Date().toISOString(), data: { event: 'new_error' },
      });
      (component as any).serverLogs.shift();
      (component as any)._serverLogsVersion++;

      const filtered2 = component.filteredServerLogs;
      expect(filtered2.length).toBe(MAX);
      expect(filtered2.some((l: ServerLogEntry) => l.data.event === 'new_error')).toBe(true);
    });

    it('não deve recompute quando nada mudou (cache válido)', () => {
      (component as any).serverLogs = [
        { seq: 1, level: 'info', timestamp: new Date().toISOString(), data: { event: 'a' } },
      ];
      (component as any)._serverLogsVersion++;

      const filtered1 = component.filteredServerLogs;
      const filtered2 = component.filteredServerLogs;
      expect(filtered1).toBe(filtered2);
    });

    it('deve recompute quando filtro de nível muda', () => {
      (component as any).serverLogs = [
        { seq: 1, level: 'info', timestamp: new Date().toISOString(), data: { event: 'a' } },
        { seq: 2, level: 'error', timestamp: new Date().toISOString(), data: { event: 'b' } },
      ];
      (component as any)._serverLogsVersion++;

      component.serverLogLevelFilter = 'all';
      expect(component.filteredServerLogs.length).toBe(2);

      component.serverLogLevelFilter = 'error';
      expect(component.filteredServerLogs.length).toBe(1);
      expect(component.filteredServerLogs[0].level).toBe('error');
    });

    it('deve recompute quando filtro de evento muda', () => {
      (component as any).serverLogs = [
        { seq: 1, level: 'info', timestamp: new Date().toISOString(), data: { event: 'wifi_scan' } },
        { seq: 2, level: 'info', timestamp: new Date().toISOString(), data: { event: 'cwmp_inform' } },
      ];
      (component as any)._serverLogsVersion++;

      component.serverLogEventFilter = 'wifi';
      expect(component.filteredServerLogs.length).toBe(1);
      expect(component.filteredServerLogs[0].data.event).toBe('wifi_scan');

      component.serverLogEventFilter = 'cwmp';
      expect(component.filteredServerLogs.length).toBe(1);
      expect(component.filteredServerLogs[0].data.event).toBe('cwmp_inform');
    });
  });

  describe('B21: expandedLogCache invalidado em loadAuditLogs', () => {
    it('deve limpar expandedLogCache quando log expandido não está mais na lista', () => {
      mockAuditLogService.list.and.returnValue(of({
        data: [{ _id: 'log1', action: 'REBOOT', channel: 'rest', result: 'success', createdAt: '2026-01-01', username: 'admin' }],
        pagination: { page: 1, limit: 50, total: 1, totalPages: 1 },
      }));

      component.loadAuditLogs();
      fixture.detectChanges();

      component.toggleLogDetails('log1');
      expect(component.getExpandedLog()).not.toBeNull();
      expect(component.expandedLogId).toBe('log1');

      // Reload onde log1 não está mais presente
      mockAuditLogService.list.and.returnValue(of({
        data: [{ _id: 'log2', action: 'LOGIN', channel: 'auth', result: 'success', createdAt: '2026-01-02', username: 'admin' }],
        pagination: { page: 1, limit: 50, total: 1, totalPages: 1 },
      }));

      component.loadAuditLogs();
      fixture.detectChanges();

      expect(component.expandedLogId).toBeNull();
      expect(component.getExpandedLog()).toBeNull();
    });

    it('deve manter expandedLogCache quando log expandido ainda está na lista', () => {
      mockAuditLogService.list.and.returnValue(of({
        data: [{ _id: 'log1', action: 'REBOOT', channel: 'rest', result: 'success', createdAt: '2026-01-01', username: 'admin' }],
        pagination: { page: 1, limit: 50, total: 1, totalPages: 1 },
      }));

      component.loadAuditLogs();
      fixture.detectChanges();

      component.toggleLogDetails('log1');
      expect(component.expandedLogId).toBe('log1');

      component.loadAuditLogs();
      fixture.detectChanges();

      expect(component.expandedLogId).toBe('log1');
    });
  });

  describe('stopServerLogStream', () => {
    it('deve desinscrever subscriptions e resetar estado', () => {
      component.startServerLogStream();
      expect(component.serverLogStreaming).toBe(true);

      component.stopServerLogStream();
      expect(component.serverLogStreaming).toBe(false);
      expect(component.serverLogPaused).toBe(false);
      expect(mockWebSocketService.unsubscribeServerLogs).toHaveBeenCalled();
    });

    it('não deve fazer nada se stream não está ativo', () => {
      component.stopServerLogStream();
      expect(mockWebSocketService.unsubscribeServerLogs).not.toHaveBeenCalled();
    });
  });

  describe('clearServerLogs', () => {
    it('deve limpar logs e expandedServerLogSeq', () => {
      (component as any).serverLogs = [
        { seq: 1, level: 'info', timestamp: new Date().toISOString(), data: { event: 'a' } },
      ];
      component.expandedServerLogSeq = 1;

      component.clearServerLogs();

      expect(component.serverLogs).toEqual([]);
      expect(component.expandedServerLogSeq).toBeNull();
    });
  });
});
