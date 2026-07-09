/**
 * @file cpe-devices-tab.component.spec.ts
 *
 * Suite de testes para CpeDevicesTabComponent — AUDITORIA RIGOROSA.
 * Cobre: ciclo de vida, carregamento, refresh manual (retry/backoff/timeout),
 * WebSocket, auto-refresh 60s, contador regressivo, paginação, getters,
 * feedback, renderização de template e regressão dos bugs críticos corrigidos.
 *
 * Padrão: Karma/Jasmine · Angular TestBed · standalone component · fakeAsync
 * Regra: sem console.log em testes — silencia logs internos via spyOn.
 *
 * ESTRATÉGIA DE TIMERS: beforeEach NÃO chama ngOnInit (evita poluir fakeAsync
 * com setInterval virtuais). Cada teste chama explicitamente o método alvo.
 * Testes com tempo usam fakeAsync + tick + discardPeriodicTasks() ao final.
 * setFeedback agenda setTimeout(5000) — todo teste que dispara setFeedback
 * em fakeAsync precisa de tick(5000) para flushar o timer não-periódico.
 */

import { ComponentFixture, TestBed, fakeAsync, tick, discardPeriodicTasks } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { Subject, of, throwError, delay } from 'rxjs';
import { HttpClientTestingModule } from '@angular/common/http/testing';

import { CpeDevicesTabComponent } from './cpe-devices-tab.component';
import { CpeService } from '../../../../../../core/services/cpe.service';
import { WebSocketService } from '../../../../../../core/services/websocket.service';
import { ConnectedDevicesData, WifiHost, EthernetDevice } from '../../../../../../core/models';

// ── Helpers de fixture ────────────────────────────────────────────────────────

/** Constrói um WifiHost mínimo para testes. */
function makeWifiHost(overrides: Partial<WifiHost> = {}): WifiHost {
  return {
    macAddress: 'AA:BB:CC:DD:EE:01',
    hostName: 'iPhone-Teste',
    ipAddress: '192.168.1.10',
    active: true,
    status: 'ativo',
    band: '5GHz',
    ssid: 'Vmoas-5G',
    clientType: 'iPhone',
    qoe: 85,
    qoeLabel: 'Excelente',
    downSpeedMbps: null,
    upSpeedMbps: null,
    operatingStandard: '802.11ax',
    clientEfficiencyRate: null,
    noiseDbm: null,
    signalStrengthDbm: -45,
    snrDb: null,
    ...overrides,
  };
}

/** Constrói um EthernetDevice mínimo para testes. */
function makeEthernetDevice(overrides: Partial<EthernetDevice> = {}): EthernetDevice {
  return {
    macAddress: '11:22:33:44:55:66',
    hostName: 'Desktop-Tecnico',
    ipAddress: '192.168.1.20',
    active: true,
    connectionType: 'Ethernet',
    portName: 'LAN1',
    clientType: null,
    ...overrides,
  };
}

/** Constrói uma resposta ConnectedDevicesData completa. */
function makeDevicesData(overrides: Partial<ConnectedDevicesData> = {}): ConnectedDevicesData {
  return {
    serialNumber: 'TEST001',
    manufacturer: 'TP-Link',
    timestamp: new Date().toISOString(),
    wifiDevices: [makeWifiHost()],
    ethernetDevices: [makeEthernetDevice()],
    totalDevices: 2,
    pagination: { page: 1, limit: 50, total: 1, pages: 1 },
    ...overrides,
  };
}

// ── Stubs de serviços ────────────────────────────────────────────────────────

/** Stub do WebSocketService — expõe Subject controlável para emissão de eventos. */
class WsStub {
  private wifiRefreshSubject = new Subject<{ serialNumber: string; timestamp: string }>();

  /** Emite um evento wifi_data_refreshed para os ouvintes do componente. */
  emitWifiRefreshed(serialNumber: string): void {
    this.wifiRefreshSubject.next({ serialNumber, timestamp: new Date().toISOString() });
  }

  onWifiDataRefreshed() {
    return this.wifiRefreshSubject.asObservable();
  }
}

/** Stub do CpeService — spies controláveis para getConnectedDevices e refreshWifiHosts. */
class CpeServiceStub {
  getConnectedDevices = jasmine.createSpy('getConnectedDevices').and.returnValue(of(makeDevicesData()));
  refreshWifiHosts = jasmine.createSpy('refreshWifiHosts').and.returnValue(of({ message: 'ok' }));
}

// ── Suite principal ───────────────────────────────────────────────────────────

describe('CpeDevicesTabComponent', () => {
  let fixture: ComponentFixture<CpeDevicesTabComponent>;
  let component: CpeDevicesTabComponent;
  let cpeStub: CpeServiceStub;
  let wsStub: WsStub;

  beforeEach(async () => {
    cpeStub = new CpeServiceStub();
    wsStub = new WsStub();

    await TestBed.configureTestingModule({
      imports: [CpeDevicesTabComponent, HttpClientTestingModule],
      providers: [
        { provide: CpeService, useValue: cpeStub },
        { provide: WebSocketService, useValue: wsStub },
      ],
      // NO_ERRORS_SCHEMA evita erro de componentes filhos (ButtonComponent, SkeletonComponent)
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();

    fixture = TestBed.createComponent(CpeDevicesTabComponent);
    component = fixture.componentInstance;
    component.serialNumber = 'TEST001';
  });

  afterEach(() => {
    // fixture.destroy() dispara ngOnDestroy → clearInterval nos intervals reais
    fixture.destroy();
  });

  // ── 1. Criação e ciclo de vida ───────────────────────────────────────────

  describe('Criação e ciclo de vida', () => {
    it('deve criar o componente', () => {
      expect(component).toBeTruthy();
    });

    it('deve ter serialNumber vazio por padrão antes do @Input', () => {
      const fresh = TestBed.createComponent(CpeDevicesTabComponent).componentInstance;
      expect(fresh.serialNumber).toBe('');
    });

    it('deve ter valores padrão corretos nos campos de estado', () => {
      expect(component.isLoading).toBeFalse();
      expect(component.refreshing).toBeFalse();
      expect(component.backgroundRefreshing).toBeFalse();
      expect(component.devicesData).toBeNull();
      expect(component.currentPage).toBe(1);
      expect(component.itemsPerPage).toBe(50);
      expect(component.totalPages).toBe(1);
      expect(component.nextRefreshInSeconds).toBe(60);
      expect(component.feedbackMessage).toBe('');
      expect(component.refreshRetryCount).toBe(0);
      expect(component.lastRefreshDurationMs).toBeNull();
      expect(component.lastRefreshAt).toBeNull();
    });

    it('ngOnInit deve carregar dados, ouvir WS, iniciar auto-refresh e countdown', fakeAsync(() => {
      spyOn(component as any, 'loadConnectedDevices').and.callThrough();
      spyOn(component as any, 'listenWifiDataRefreshed').and.callThrough();
      spyOn(component as any, 'startHostsAutoRefresh').and.callThrough();
      spyOn(component as any, 'startCountdownTimer').and.callThrough();

      component.ngOnInit();
      tick();

      expect((component as any).loadConnectedDevices).toHaveBeenCalled();
      expect((component as any).listenWifiDataRefreshed).toHaveBeenCalled();
      expect((component as any).startHostsAutoRefresh).toHaveBeenCalled();
      expect((component as any).startCountdownTimer).toHaveBeenCalled();

      discardPeriodicTasks();
    }));

    it('ngOnDestroy deve limpar intervals, subscriptions HTTP e WS', fakeAsync(() => {
      component.ngOnInit();
      tick();

      const httpSubs = (component as any).httpSubs;
      spyOn(httpSubs, 'unsubscribe').and.callThrough();

      component.ngOnDestroy();

      expect((component as any).hostsRefreshInterval).toBeNull();
      expect((component as any).countdownInterval).toBeNull();
      expect(httpSubs.unsubscribe).toHaveBeenCalled();

      discardPeriodicTasks();
    }));

    it('ngOnDestroy deve limpar feedbackTimeout se ativo', fakeAsync(() => {
      (component as any).setFeedback('Teste', 'info');
      expect((component as any).feedbackTimeout).not.toBeNull();

      component.ngOnDestroy();

      expect((component as any).feedbackTimeout).toBeNull();

      discardPeriodicTasks();
    }));
  });

  // ── 2. Carregamento de dados ─────────────────────────────────────────────

  describe('loadConnectedDevices', () => {
    it('deve setar isLoading=true inicialmente e chamar getConnectedDevices', () => {
      component.loadConnectedDevices();
      expect(cpeStub.getConnectedDevices).toHaveBeenCalledWith('TEST001', 1, 50);
      // of() é síncrono → isLoading já voltou para false após subscribe
      expect(component.isLoading).toBeFalse();
    });

    it('deve popular devicesData e totalPages em sucesso', () => {
      const data = makeDevicesData({
        wifiDevices: [makeWifiHost(), makeWifiHost({ macAddress: 'AA:BB:CC:DD:EE:02' })],
        totalDevices: 2,
        pagination: { page: 1, limit: 50, total: 2, pages: 1 },
      });
      cpeStub.getConnectedDevices.and.returnValue(of(data));

      component.loadConnectedDevices();

      expect(component.devicesData).toEqual(data);
      expect(component.totalPages).toBe(1);
      expect(component.isLoading).toBeFalse();
    });

    it('deve calcular totalPages do pagination.pages', () => {
      const data = makeDevicesData({
        pagination: { page: 1, limit: 50, total: 120, pages: 3 },
      });
      cpeStub.getConnectedDevices.and.returnValue(of(data));

      component.loadConnectedDevices();

      expect(component.totalPages).toBe(3);
    });

    it('deve defaultar totalPages para 1 se pagination.pages for undefined', () => {
      const data = makeDevicesData();
      // Remove pagination para simular resposta malformada
      (data as any).pagination = undefined;
      cpeStub.getConnectedDevices.and.returnValue(of(data));

      component.loadConnectedDevices();

      expect(component.totalPages).toBe(1);
    });

    it('deve exibir feedback de erro e isLoading=false quando a chamada falha', () => {
      cpeStub.getConnectedDevices.and.returnValue(throwError(() => ({ status: 500 })));

      component.loadConnectedDevices();

      expect(component.isLoading).toBeFalse();
      expect(component.feedbackType).toBe('error');
      expect(component.feedbackMessage).toContain('Erro ao carregar');
    });

    it('não deve chamar o serviço se serialNumber for vazio', () => {
      component.serialNumber = '';
      cpeStub.getConnectedDevices.calls.reset();
      component.loadConnectedDevices();
      expect(cpeStub.getConnectedDevices).not.toHaveBeenCalled();
    });

    it('deve limpar feedback anterior ao iniciar novo carregamento', () => {
      component.feedbackMessage = 'Mensagem antiga';
      component.loadConnectedDevices();
      // clearFeedback é chamado antes do subscribe; of() é síncrono então
      // setFeedback de erro (se houver) sobrescreve. Em sucesso, feedback fica vazio.
      expect(component.feedbackMessage).toBe('');
    });
  });

  // ── 3. reloadDevicesDataSilently (BUG CRÍTICO: forceRefresh=true) ─────────

  describe('reloadDevicesDataSilently', () => {
    it('deve chamar getConnectedDevices com forceRefresh=true (bypass cache)', () => {
      (component as any).reloadDevicesDataSilently();
      // 4º argumento = forceRefresh — deve ser true para bypassar cache stale
      expect(cpeStub.getConnectedDevices).toHaveBeenCalledWith('TEST001', 1, 50, true);
    });

    it('não deve setar isLoading=true (recarga silenciosa sem flicker)', () => {
      component.isLoading = false;
      cpeStub.getConnectedDevices.and.returnValue(of(makeDevicesData()));

      (component as any).reloadDevicesDataSilently();

      expect(component.isLoading).toBeFalse();
    });

    it('deve atualizar devicesData em sucesso sem exibir feedback', () => {
      const data = makeDevicesData({ totalDevices: 5 });
      cpeStub.getConnectedDevices.and.returnValue(of(data));
      component.feedbackMessage = '';

      (component as any).reloadDevicesDataSilently();

      expect(component.devicesData).toEqual(data);
      expect(component.feedbackMessage).toBe('');
    });

    it('deve manter dados em tela silenciosamente em erro', () => {
      const existing = makeDevicesData({ totalDevices: 3 });
      component.devicesData = existing;
      cpeStub.getConnectedDevices.and.returnValue(throwError(() => ({ status: 500 })));

      (component as any).reloadDevicesDataSilently();

      // Dados antigos permanecem — não zera devicesData
      expect(component.devicesData).toEqual(existing);
    });

    it('não deve chamar o serviço se serialNumber for vazio', () => {
      component.serialNumber = '';
      cpeStub.getConnectedDevices.calls.reset();
      (component as any).reloadDevicesDataSilently();
      expect(cpeStub.getConnectedDevices).not.toHaveBeenCalled();
    });
  });

  // ── 4. refreshDevicesData — pipeline RxJS (retry/backoff/timeout) ────────

  describe('refreshDevicesData', () => {
    beforeEach(() => {
      // Inicia só o listener WS (sem intervals do auto-refresh/countdown)
      (component as any).listenWifiDataRefreshed();
      cpeStub.refreshWifiHosts.calls.reset();
    });

    it('não deve disparar se já estiver refreshing', () => {
      component.refreshing = true;
      component.refreshDevicesData();
      expect(cpeStub.refreshWifiHosts).not.toHaveBeenCalled();
    });

    it('não deve disparar se backgroundRefreshing estiver ativo', () => {
      component.backgroundRefreshing = true;
      component.refreshDevicesData();
      expect(cpeStub.refreshWifiHosts).not.toHaveBeenCalled();
    });

    it('não deve disparar se serialNumber for vazio', () => {
      component.serialNumber = '';
      component.refreshDevicesData();
      expect(cpeStub.refreshWifiHosts).not.toHaveBeenCalled();
    });

    it('deve setar refreshing, backgroundRefreshing, refreshStartTime e retryCount=0 ao iniciar', fakeAsync(() => {
      cpeStub.refreshWifiHosts.and.returnValue(of({ message: 'ok' }).pipe(delay(100)));
      component.refreshDevicesData();
      tick(50);

      expect(component.refreshing).toBeTrue();
      expect(component.backgroundRefreshing).toBeTrue();
      expect((component as any).refreshStartTime).not.toBeNull();
      expect(component.refreshRetryCount).toBe(0);

      // Limpa o pipeline pendente (WS nunca emitirá neste teste)
      if ((component as any).refreshSub) (component as any).refreshSub.unsubscribe();
      tick(5_000); // flush setFeedback setTimeout
      discardPeriodicTasks();
    }));

    it('deve resetar nextRefreshInSeconds para 60 ao iniciar', () => {
      component.nextRefreshInSeconds = 15;
      cpeStub.refreshWifiHosts.and.returnValue(of({ message: 'ok' }).pipe(delay(100)));

      component.refreshDevicesData();

      expect(component.nextRefreshInSeconds).toBe(60);
    });

    it('deve exibir feedback info "Aguardando a CPE responder" ao iniciar', () => {
      cpeStub.refreshWifiHosts.and.returnValue(of({ message: 'ok' }).pipe(delay(100)));

      component.refreshDevicesData();

      expect(component.feedbackType).toBe('info');
      expect(component.feedbackMessage).toContain('Aguardando');
    });

    it('HTTP 409 deve exibir feedback info e NÃO entrar em retry', () => {
      cpeStub.refreshWifiHosts.and.returnValue(throwError(() => ({ status: 409, message: 'conflito' })));

      component.refreshDevicesData();

      expect(component.refreshing).toBeFalse();
      expect(component.backgroundRefreshing).toBeFalse();
      expect(component.feedbackType).toBe('info');
      expect(component.feedbackMessage).toContain('em andamento');
      expect((component as any).refreshStartTime).toBeNull();
    });

    it('HTTP erro genérico deve exibir feedback error e resetar refreshStartTime', () => {
      cpeStub.refreshWifiHosts.and.returnValue(throwError(() => ({ status: 500 })));

      component.refreshDevicesData();

      expect(component.refreshing).toBeFalse();
      expect(component.feedbackType).toBe('error');
      expect(component.feedbackMessage).toContain('Erro ao solicitar');
      expect((component as any).refreshStartTime).toBeNull();
    });

    it('sucesso via WS deve medir duração, exibir toast success e resetar estado', fakeAsync(() => {
      cpeStub.refreshWifiHosts.and.returnValue(of({ message: 'ok' }));

      component.refreshDevicesData();
      tick();

      // Antes do WS: aguardando resposta
      expect(component.backgroundRefreshing).toBeTrue();

      // Emite o evento WS para esta CPE
      wsStub.emitWifiRefreshed('TEST001');
      tick();

      expect(component.refreshing).toBeFalse();
      expect(component.backgroundRefreshing).toBeFalse();
      expect(component.feedbackType).toBe('success');
      expect(component.feedbackMessage).toContain('tempo real');
      expect(component.lastRefreshDurationMs).not.toBeNull();
      expect(component.lastRefreshAt).not.toBeNull();
      expect((component as any).refreshStartTime).toBeNull();

      tick(5_000); // flush setFeedback setTimeout
      discardPeriodicTasks();
    }));

    it('evento WS de outra CPE não deve afetar este componente', fakeAsync(() => {
      cpeStub.refreshWifiHosts.and.returnValue(of({ message: 'ok' }));

      component.refreshDevicesData();
      tick();

      wsStub.emitWifiRefreshed('OTHER_CPE_999');
      tick();

      // Continua aguardando — não foi para esta CPE
      expect(component.backgroundRefreshing).toBeTrue();
      expect(component.feedbackType).not.toBe('success');

      if ((component as any).refreshSub) (component as any).refreshSub.unsubscribe();
      tick(5_000); // flush setFeedback setTimeout
      discardPeriodicTasks();
    }));

    it('timeout (CPE não responde) deve disparar retry com backoff e esgotar em 3', fakeAsync(() => {
      cpeStub.refreshWifiHosts.and.returnValue(of({ message: 'ok' }));

      component.refreshDevicesData();
      tick();

      // Sequência: initial(30s) → retry1(15s+30s) → retry2(30s+30s) → retry3(60s+30s) → esgota
      tick(30_000);  // t=30s: timeout 1 → retry 1 (delay 15s, retryCount=1)
      expect(component.refreshRetryCount).toBe(1);
      expect(component.feedbackMessage).toContain('tentativa 1/3');

      tick(15_000);  // t=45s: retry 1 dispara (re-enfileira refreshWifiHosts)
      tick(30_000);  // t=75s: timeout 2 → retry 2 (delay 30s, retryCount=2)
      expect(component.refreshRetryCount).toBe(2);

      tick(30_000);  // t=105s: retry 2 dispara
      tick(30_000);  // t=135s: timeout 3 → retry 3 (delay 60s, retryCount=3)
      expect(component.refreshRetryCount).toBe(3);

      tick(60_000);  // t=195s: retry 3 dispara
      tick(30_000);  // t=225s: timeout 4 → retries esgotados → catchError final

      expect(component.feedbackType).toBe('error');
      expect(component.feedbackMessage).toContain('3 tentativas');
      expect(component.refreshing).toBeFalse();
      expect(component.backgroundRefreshing).toBeFalse();
      expect((component as any).refreshStartTime).toBeNull();

      tick(5_000); // flush setFeedback setTimeout
      discardPeriodicTasks();
    }));

    it('deve cancelar pipeline anterior ao disparar novo refresh', () => {
      cpeStub.refreshWifiHosts.and.returnValue(of({ message: 'ok' }).pipe(delay(5000)));

      component.refreshDevicesData();
      const firstSub = (component as any).refreshSub;

      // Aguarda o background liberar (simula conclusão sem WS)
      component.refreshing = false;
      component.backgroundRefreshing = false;

      component.refreshDevicesData();
      const secondSub = (component as any).refreshSub;

      expect(secondSub).not.toBe(firstSub);
    });
  });

  // ── 5. listenWifiDataRefreshed — manual vs auto-refresh ──────────────────

  describe('listenWifiDataRefreshed (manual vs auto-refresh)', () => {
    beforeEach(() => {
      (component as any).listenWifiDataRefreshed();
    });

    it('auto-refresh (refreshStartTime null) deve recarregar silenciosamente SEM toast', () => {
      (component as any).refreshStartTime = null;
      cpeStub.getConnectedDevices.calls.reset();
      cpeStub.getConnectedDevices.and.returnValue(of(makeDevicesData({ totalDevices: 7 })));
      component.feedbackMessage = '';

      wsStub.emitWifiRefreshed('TEST001');

      expect(cpeStub.getConnectedDevices).toHaveBeenCalledWith('TEST001', 1, 50, true);
      expect(component.devicesData?.totalDevices).toBe(7);
      expect(component.feedbackMessage).toBe('');
      expect(component.refreshing).toBeFalse();
      expect(component.backgroundRefreshing).toBeFalse();
    });

    it('manual refresh (refreshStartTime set) deve medir duração e exibir toast success', () => {
      (component as any).refreshStartTime = Date.now() - 2500;
      component.feedbackMessage = '';

      wsStub.emitWifiRefreshed('TEST001');

      expect(component.lastRefreshDurationMs).not.toBeNull();
      expect(component.lastRefreshDurationMs! >= 2500).toBeTrue();
      expect(component.feedbackType).toBe('success');
      expect(component.feedbackMessage).toContain('tempo real');
    });

    it('manual refresh deve reiniciar auto-refresh e resetar countdown (sincronização)', fakeAsync(() => {
      (component as any).startHostsAutoRefresh();
      (component as any).startCountdownTimer();
      (component as any).refreshStartTime = Date.now();
      component.nextRefreshInSeconds = 30; // simula countdown parcial

      wsStub.emitWifiRefreshed('TEST001');
      tick(0); // flush microtasks apenas (não dispara 1s countdown interval)

      // Após refresh manual concluir, countdown deve ser resetado para 60
      // e auto-refresh reiniciado (sincroniza contador com intervalo real)
      expect(component.nextRefreshInSeconds).toBe(60);

      // setFeedback (toast success) agenda setTimeout(5000) — precisa flushar
      tick(5_000);
      discardPeriodicTasks();
    }));

    it('auto-refresh NÃO deve reiniciar countdown (só manual faz isso)', fakeAsync(() => {
      (component as any).startCountdownTimer();
      (component as any).refreshStartTime = null; // auto-refresh
      component.nextRefreshInSeconds = 30;

      wsStub.emitWifiRefreshed('TEST001');
      tick();

      // Auto-refresh não reseta countdown — ele continua decrementando
      expect(component.nextRefreshInSeconds).toBe(30);

      discardPeriodicTasks();
    }));

    it('deve resetar refreshRetryCount ao receber evento WS', () => {
      component.refreshRetryCount = 2;
      (component as any).refreshStartTime = Date.now();

      wsStub.emitWifiRefreshed('TEST001');

      expect(component.refreshRetryCount).toBe(0);
    });

    it('evento WS de outra CPE não deve disparar reload', () => {
      (component as any).refreshStartTime = Date.now();
      cpeStub.getConnectedDevices.calls.reset();

      wsStub.emitWifiRefreshed('OUTRA_CPE');

      expect(cpeStub.getConnectedDevices).not.toHaveBeenCalled();
    });

    it('não deve iniciar listener se serialNumber for vazio', () => {
      // beforeEach já chamou listenWifiDataRefreshed() e setou wsRefreshSub.
      // Limpa para simular estado antes de qualquer listener.
      if ((component as any).wsRefreshSub) {
        (component as any).wsRefreshSub.unsubscribe();
        (component as any).wsRefreshSub = undefined;
      }
      component.serialNumber = '';
      cpeStub.getConnectedDevices.calls.reset();
      (component as any).listenWifiDataRefreshed();

      wsStub.emitWifiRefreshed('');

      expect((component as any).wsRefreshSub).toBeUndefined();
    });
  });

  // ── 6. Auto-refresh 60s ──────────────────────────────────────────────────

  describe('startHostsAutoRefresh', () => {
    it('não deve disparar refreshWifiHosts enquanto refreshing estiver ativo', fakeAsync(() => {
      component.refreshing = true;
      (component as any).startHostsAutoRefresh();

      tick(60_000);
      expect(cpeStub.refreshWifiHosts).not.toHaveBeenCalled();

      discardPeriodicTasks();
    }));

    it('não deve disparar enquanto backgroundRefreshing estiver ativo', fakeAsync(() => {
      component.backgroundRefreshing = true;
      (component as any).startHostsAutoRefresh();

      tick(60_000);
      expect(cpeStub.refreshWifiHosts).not.toHaveBeenCalled();

      discardPeriodicTasks();
    }));

    it('deve disparar refreshWifiHosts a cada 60s quando ocioso', fakeAsync(() => {
      (component as any).startHostsAutoRefresh();
      cpeStub.refreshWifiHosts.calls.reset();

      tick(60_000);
      expect(cpeStub.refreshWifiHosts.calls.count()).toBe(1);

      tick(60_000);
      expect(cpeStub.refreshWifiHosts.calls.count()).toBe(2);

      discardPeriodicTasks();
    }));

    it('deve resetar nextRefreshInSeconds ao disparar auto-refresh', fakeAsync(() => {
      (component as any).startHostsAutoRefresh();
      component.nextRefreshInSeconds = 10;

      tick(60_000);
      expect(component.nextRefreshInSeconds).toBe(60);

      discardPeriodicTasks();
    }));

    it('stopHostsAutoRefresh deve limpar o interval', fakeAsync(() => {
      (component as any).startHostsAutoRefresh();
      expect((component as any).hostsRefreshInterval).not.toBeNull();

      (component as any).stopHostsAutoRefresh();
      expect((component as any).hostsRefreshInterval).toBeNull();

      discardPeriodicTasks();
    }));

    it('startHostsAutoRefresh deve limpar interval anterior antes de criar novo', fakeAsync(() => {
      (component as any).startHostsAutoRefresh();
      const firstInterval = (component as any).hostsRefreshInterval;

      (component as any).startHostsAutoRefresh();
      const secondInterval = (component as any).hostsRefreshInterval;

      expect(secondInterval).not.toBe(firstInterval);

      discardPeriodicTasks();
    }));
  });

  // ── 7. Contador regressivo ───────────────────────────────────────────────

  describe('startCountdownTimer', () => {
    it('deve decrementar nextRefreshInSeconds a cada 1s', fakeAsync(() => {
      component.nextRefreshInSeconds = 60;
      (component as any).startCountdownTimer();

      tick(1_000);
      expect(component.nextRefreshInSeconds).toBe(59);

      tick(1_000);
      expect(component.nextRefreshInSeconds).toBe(58);

      discardPeriodicTasks();
    }));

    it('deve reiniciar para 60 ao chegar a 0', fakeAsync(() => {
      component.nextRefreshInSeconds = 2;
      (component as any).startCountdownTimer();

      tick(1_000);
      expect(component.nextRefreshInSeconds).toBe(1);

      tick(1_000);
      expect(component.nextRefreshInSeconds).toBe(60);

      discardPeriodicTasks();
    }));

    it('stopCountdownTimer deve limpar o interval', fakeAsync(() => {
      (component as any).startCountdownTimer();
      expect((component as any).countdownInterval).not.toBeNull();

      (component as any).stopCountdownTimer();
      expect((component as any).countdownInterval).toBeNull();

      discardPeriodicTasks();
    }));

    it('startCountdownTimer deve limpar interval anterior antes de criar novo', fakeAsync(() => {
      (component as any).startCountdownTimer();
      const firstInterval = (component as any).countdownInterval;

      (component as any).startCountdownTimer();
      const secondInterval = (component as any).countdownInterval;

      expect(secondInterval).not.toBe(firstInterval);

      discardPeriodicTasks();
    }));
  });

  // ── 8. Paginação ─────────────────────────────────────────────────────────

  describe('Paginação', () => {
    it('nextPage deve incrementar currentPage e recarregar', () => {
      component.totalPages = 3;
      component.currentPage = 1;
      cpeStub.getConnectedDevices.calls.reset();

      component.nextPage();

      expect(component.currentPage).toBe(2);
      expect(cpeStub.getConnectedDevices).toHaveBeenCalledWith('TEST001', 2, 50);
    });

    it('nextPage não deve passar de totalPages', () => {
      component.totalPages = 2;
      component.currentPage = 2;
      component.nextPage();
      expect(component.currentPage).toBe(2);
    });

    it('prevPage deve decrementar currentPage e recarregar', () => {
      component.totalPages = 3;
      component.currentPage = 2;
      cpeStub.getConnectedDevices.calls.reset();

      component.prevPage();

      expect(component.currentPage).toBe(1);
      expect(cpeStub.getConnectedDevices).toHaveBeenCalledWith('TEST001', 1, 50);
    });

    it('prevPage não deve ir abaixo de 1', () => {
      component.currentPage = 1;
      component.prevPage();
      expect(component.currentPage).toBe(1);
    });

    it('nextPage não deve disparar se totalPages for 1', () => {
      component.totalPages = 1;
      component.currentPage = 1;
      cpeStub.getConnectedDevices.calls.reset();

      component.nextPage();

      expect(cpeStub.getConnectedDevices).not.toHaveBeenCalled();
    });
  });

  // ── 9. Getters e helpers ─────────────────────────────────────────────────

  describe('Getters e helpers', () => {
    it('activeWifiCount deve contar apenas hosts não-inativos', () => {
      component.devicesData = makeDevicesData({
        wifiDevices: [
          makeWifiHost({ macAddress: '01', status: 'ativo' }),
          makeWifiHost({ macAddress: '02', status: 'ocioso' }),
          makeWifiHost({ macAddress: '03', status: 'inativo' }),
        ],
      });
      expect(component.activeWifiCount).toBe(2); // ativo + ocioso
    });

    it('activeWifiCount deve ser 0 quando devicesData for null', () => {
      component.devicesData = null;
      expect(component.activeWifiCount).toBe(0);
    });

    it('activeWifiCount deve ser 0 quando wifiDevices for undefined', () => {
      component.devicesData = makeDevicesData();
      (component.devicesData as any).wifiDevices = undefined;
      expect(component.activeWifiCount).toBe(0);
    });

    it('activeEthernetCount deve contar apenas dispositivos ativos', () => {
      component.devicesData = makeDevicesData({
        ethernetDevices: [
          makeEthernetDevice({ macAddress: '01', active: true }),
          makeEthernetDevice({ macAddress: '02', active: false }),
        ],
      });
      expect(component.activeEthernetCount).toBe(1);
    });

    it('activeEthernetCount deve ser 0 quando devicesData for null', () => {
      component.devicesData = null;
      expect(component.activeEthernetCount).toBe(0);
    });

    it('activeEthernetCount deve ser 0 quando ethernetDevices for undefined', () => {
      component.devicesData = makeDevicesData();
      (component.devicesData as any).ethernetDevices = undefined;
      expect(component.activeEthernetCount).toBe(0);
    });

    it('lastRefreshDurationText deve formatar segundos abaixo de 60', () => {
      (component as any).lastRefreshDurationMs = 4600;
      expect(component.lastRefreshDurationText).toBe('4.6s');
    });

    it('lastRefreshDurationText deve formatar minutos acima de 60s', () => {
      (component as any).lastRefreshDurationMs = 125_000; // 2m 5s
      expect(component.lastRefreshDurationText).toBe('2m 5s');
    });

    it('lastRefreshDurationText deve retornar string vazia quando null', () => {
      (component as any).lastRefreshDurationMs = null;
      expect(component.lastRefreshDurationText).toBe('');
    });

    it('lastRefreshAtText deve retornar string vazia quando null', () => {
      (component as any).lastRefreshAt = null;
      expect(component.lastRefreshAtText).toBe('');
    });

    it('lastRefreshAtText deve retornar horário formatado pt-BR', () => {
      const d = new Date(2026, 6, 9, 14, 30, 45);
      (component as any).lastRefreshAt = d;
      const text = component.lastRefreshAtText;
      expect(text).toContain('14');
      expect(text).toContain('30');
      expect(text).toContain('45');
    });

    it('trackByMac deve retornar o macAddress do WifiHost', () => {
      const host = makeWifiHost({ macAddress: 'AA:BB:CC:DD:EE:FF' });
      expect(component.trackByMac(0, host)).toBe('AA:BB:CC:DD:EE:FF');
    });

    it('trackByMac deve funcionar com EthernetDevice', () => {
      const dev = makeEthernetDevice({ macAddress: '11:22:33:44:55:66' });
      expect(component.trackByMac(0, dev)).toBe('11:22:33:44:55:66');
    });

    it('trackByMac deve retornar macAddress mesmo se for string vazia', () => {
      const host = makeWifiHost({ macAddress: '' });
      expect(component.trackByMac(0, host)).toBe('');
    });
  });

  // ── 10. Feedback (toast inline) ──────────────────────────────────────────

  describe('setFeedback / clearFeedback', () => {
    it('setFeedback deve definir mensagem e tipo', () => {
      (component as any).setFeedback('Teste msg', 'error');
      expect(component.feedbackMessage).toBe('Teste msg');
      expect(component.feedbackType).toBe('error');
    });

    it('clearFeedback deve limpar a mensagem', () => {
      (component as any).setFeedback('Teste msg', 'info');
      (component as any).clearFeedback();
      expect(component.feedbackMessage).toBe('');
    });

    it('setFeedback deve auto-limpar após 5s', fakeAsync(() => {
      (component as any).setFeedback('Temporário', 'success');
      expect(component.feedbackMessage).toBe('Temporário');

      tick(5_000);
      expect(component.feedbackMessage).toBe('');

      discardPeriodicTasks();
    }));

    it('setFeedback consecutivo deve cancelar timeout anterior', fakeAsync(() => {
      (component as any).setFeedback('Primeiro', 'info');
      const firstTimeout = (component as any).feedbackTimeout;
      (component as any).setFeedback('Segundo', 'error');

      expect((component as any).feedbackTimeout).not.toBe(firstTimeout);
      expect(component.feedbackMessage).toBe('Segundo');

      tick(5_000);
      discardPeriodicTasks();
    }));

    it('setFeedback deve suportar os três tipos: success, error, info', () => {
      (component as any).setFeedback('Sucesso', 'success');
      expect(component.feedbackType).toBe('success');

      (component as any).setFeedback('Erro', 'error');
      expect(component.feedbackType).toBe('error');

      (component as any).setFeedback('Info', 'info');
      expect(component.feedbackType).toBe('info');
    });
  });

  // ── 11. Renderização de template ─────────────────────────────────────────
  //
  // NOTA: fixture.detectChanges() dispara ngOnInit → loadConnectedDevices()
  // → o stub retorna of(makeDevicesData()) e sobrescreve devicesData. Por isso,
  // configuramos o stub return ANTES de detectChanges, ou setamos devicesData
  // APÓS detectChanges e chamamos detectChanges novamente.

  describe('Renderização de template', () => {
    it('deve renderizar tabela Wi-Fi quando há dispositivos', () => {
      cpeStub.getConnectedDevices.and.returnValue(of(makeDevicesData({
        wifiDevices: [makeWifiHost({ hostName: 'MeuiPhone' })],
        ethernetDevices: [],
      })));
      fixture.detectChanges(); // dispara ngOnInit → load

      const hostEl = fixture.nativeElement.querySelector('.devices-table');
      expect(hostEl).not.toBeNull();
      expect(fixture.nativeElement.textContent).toContain('MeuiPhone');
    });

    it('deve renderizar empty-state Wi-Fi quando não há dispositivos', () => {
      cpeStub.getConnectedDevices.and.returnValue(of(makeDevicesData({
        wifiDevices: [],
        ethernetDevices: [],
      })));
      fixture.detectChanges();

      const emptyEl = fixture.nativeElement.querySelector('.empty-state');
      expect(emptyEl).not.toBeNull();
      expect(fixture.nativeElement.textContent).toContain('Nenhum dispositivo Wi-Fi');
    });

    it('deve renderizar skeleton quando isLoading=true', () => {
      // Serviço async → isLoading permanece true após detectChanges
      cpeStub.getConnectedDevices.and.returnValue(of(makeDevicesData()).pipe(delay(5000)));
      fixture.detectChanges();

      const loadingEl = fixture.nativeElement.querySelector('.loading-state');
      expect(loadingEl).not.toBeNull();
    });

    it('deve renderizar header com contadores de Wi-Fi e Ethernet', () => {
      cpeStub.getConnectedDevices.and.returnValue(of(makeDevicesData({
        wifiDevices: [
          makeWifiHost({ macAddress: '01', status: 'ativo' }),
          makeWifiHost({ macAddress: '02', status: 'ocioso' }),
          makeWifiHost({ macAddress: '03', status: 'inativo' }),
        ],
        ethernetDevices: [makeEthernetDevice(), makeEthernetDevice({ macAddress: '02', active: false })],
        totalDevices: 5,
      })));
      fixture.detectChanges();

      const subtitle = fixture.nativeElement.querySelector('.subtitle');
      // activeWifiCount=2 (ativo + ocioso, inativo filtrado), activeEthernetCount=1
      expect(subtitle.textContent).toContain('2');
      expect(subtitle.textContent).toContain('1');
    });

    it('deve renderizar badge de background refreshing quando ativo', () => {
      component.backgroundRefreshing = true;
      // detectChanges sem ngOnInit — seta estado após init
      fixture.detectChanges();
      component.backgroundRefreshing = true; // re-seta após init sobrescrever
      fixture.detectChanges();

      const badge = fixture.nativeElement.querySelector('.refresh-pulse');
      expect(badge).not.toBeNull();
    });

    it('deve renderizar badge de sucesso quando lastRefreshAt setado e não refreshing', () => {
      // Spy em loadConnectedDevices para evitar que ngOnInit chame clearFeedback
      // e interfira no estado que estamos testando
      spyOn(component, 'loadConnectedDevices').and.callFake(() => {
        component.isLoading = false;
        component.devicesData = makeDevicesData();
        component['cdr'].markForCheck();
      });
      component.lastRefreshAt = new Date();
      (component as any).lastRefreshDurationMs = 1500;
      component.backgroundRefreshing = false;
      fixture.detectChanges();

      const badge = fixture.nativeElement.querySelector('.refresh-ok');
      expect(badge).not.toBeNull();
    });

    it('não deve renderizar badge de sucesso quando backgroundRefreshing ativo', () => {
      fixture.detectChanges();
      component.lastRefreshAt = new Date();
      component.backgroundRefreshing = true;
      fixture.detectChanges();

      const badge = fixture.nativeElement.querySelector('.refresh-ok');
      expect(badge).toBeNull();
    });

    it('deve renderizar footer de monitoramento quando não está loading', () => {
      fixture.detectChanges();

      const footer = fixture.nativeElement.querySelector('.monitor-footer');
      expect(footer).not.toBeNull();
    });

    it('deve renderizar paginação quando totalPages > 1', () => {
      cpeStub.getConnectedDevices.and.returnValue(of(makeDevicesData({
        wifiDevices: Array.from({ length: 60 }, (_, i) => makeWifiHost({ macAddress: `MAC${i}` })),
        pagination: { page: 1, limit: 50, total: 60, pages: 2 },
      })));
      fixture.detectChanges();

      const pagination = fixture.nativeElement.querySelector('.pagination-controls');
      expect(pagination).not.toBeNull();
    });

    it('não deve renderizar paginação quando totalPages = 1', () => {
      cpeStub.getConnectedDevices.and.returnValue(of(makeDevicesData()));
      fixture.detectChanges();

      const pagination = fixture.nativeElement.querySelector('.pagination-controls');
      expect(pagination).toBeNull();
    });

    it('deve renderizar feedback inline quando feedbackMessage não está vazio', () => {
      // Spy em loadConnectedDevices para evitar que ngOnInit chame clearFeedback
      spyOn(component, 'loadConnectedDevices').and.callFake(() => {
        component.isLoading = false;
        component.devicesData = makeDevicesData();
        component['cdr'].markForCheck();
      });
      component.feedbackMessage = 'Mensagem de teste';
      component.feedbackType = 'success';
      fixture.detectChanges();

      const feedback = fixture.nativeElement.querySelector('.feedback');
      expect(feedback).not.toBeNull();
      expect(feedback.classList).toContain('feedback-success');
    });

    it('deve renderizar tabela Ethernet quando há dispositivos cabo', () => {
      cpeStub.getConnectedDevices.and.returnValue(of(makeDevicesData({
        wifiDevices: [],
        ethernetDevices: [makeEthernetDevice({ hostName: 'MeuDesktop' })],
      })));
      fixture.detectChanges();

      expect(fixture.nativeElement.textContent).toContain('MeuDesktop');
      expect(fixture.nativeElement.textContent).toContain('Dispositivos Ethernet');
    });
  });

  // ── 12. Regressão — bugs críticos corrigidos ─────────────────────────────

  describe('Regressão — bugs críticos corrigidos', () => {
    it('BUG #1: reloadDevicesDataSilently NÃO deve usar cache (forceRefresh=true)', () => {
      (component as any).reloadDevicesDataSilently();
      const callArgs = cpeStub.getConnectedDevices.calls.mostRecent().args;
      expect(callArgs[3]).toBeTrue();
    });

    it('BUG #1: loadConnectedDevices (load inicial) DEVE usar cache (forceRefresh=false/default)', () => {
      component.loadConnectedDevices();
      const callArgs = cpeStub.getConnectedDevices.calls.mostRecent().args;
      // 4º argumento não passado → undefined → falsy → cache ativo
      expect(callArgs[3]).toBeUndefined();
    });

    it('BUG #2: refreshStartTime deve ser null após refresh manual concluir', fakeAsync(() => {
      (component as any).listenWifiDataRefreshed();
      cpeStub.refreshWifiHosts.and.returnValue(of({ message: 'ok' }));
      component.refreshDevicesData();
      tick();

      wsStub.emitWifiRefreshed('TEST001');
      tick();

      expect((component as any).refreshStartTime).toBeNull();

      tick(5_000);
      discardPeriodicTasks();
    }));

    it('BUG #2: auto-refresh não deve computar lastRefreshDurationMs', () => {
      (component as any).listenWifiDataRefreshed();
      (component as any).refreshStartTime = null;
      (component as any).lastRefreshDurationMs = null;

      wsStub.emitWifiRefreshed('TEST001');

      expect((component as any).lastRefreshDurationMs).toBeNull();
    });

    it('BUG #2: refreshStartTime deve ser null após HTTP 409', () => {
      (component as any).listenWifiDataRefreshed();
      cpeStub.refreshWifiHosts.and.returnValue(throwError(() => ({ status: 409 })));

      component.refreshDevicesData();

      expect((component as any).refreshStartTime).toBeNull();
    });

    it('BUG #2: refreshStartTime deve ser null após HTTP erro genérico', () => {
      (component as any).listenWifiDataRefreshed();
      cpeStub.refreshWifiHosts.and.returnValue(throwError(() => ({ status: 500 })));

      component.refreshDevicesData();

      expect((component as any).refreshStartTime).toBeNull();
    });

    it('BUG #2: refreshStartTime deve ser null após 3 retries esgotarem', fakeAsync(() => {
      (component as any).listenWifiDataRefreshed();
      cpeStub.refreshWifiHosts.and.returnValue(of({ message: 'ok' }));
      component.refreshDevicesData();
      tick();

      tick(30_000);  // timeout 1 → retry 1
      tick(15_000);  // retry 1 dispara
      tick(30_000);  // timeout 2 → retry 2
      tick(30_000);  // retry 2 dispara
      tick(30_000);  // timeout 3 → retry 3
      tick(60_000);  // retry 3 dispara
      tick(30_000);  // timeout 4 → esgota → catchError

      expect((component as any).refreshStartTime).toBeNull();
      expect(component.refreshing).toBeFalse();

      tick(5_000);
      discardPeriodicTasks();
    }));

    it('BUG #3: signal-badge não deve aplicar classe signal-good quando signalStrengthDbm é null', () => {
      cpeStub.getConnectedDevices.and.returnValue(of(makeDevicesData({
        wifiDevices: [makeWifiHost({ signalStrengthDbm: null })],
        ethernetDevices: [],
      })));
      fixture.detectChanges();

      const signalBadge = fixture.nativeElement.querySelector('.signal-badge');
      expect(signalBadge.classList).not.toContain('signal-good');
      expect(signalBadge.classList).not.toContain('signal-medium');
      expect(signalBadge.classList).not.toContain('signal-weak');
      expect(signalBadge.textContent.trim()).toBe('—');
    });

    it('BUG #3: signal-badge deve aplicar signal-good quando signalStrengthDbm > -50', () => {
      cpeStub.getConnectedDevices.and.returnValue(of(makeDevicesData({
        wifiDevices: [makeWifiHost({ signalStrengthDbm: -40 })],
        ethernetDevices: [],
      })));
      fixture.detectChanges();

      const signalBadge = fixture.nativeElement.querySelector('.signal-badge');
      expect(signalBadge.classList).toContain('signal-good');
    });

    it('BUG #3: signal-badge deve aplicar signal-medium quando -70 < dbm <= -50', () => {
      cpeStub.getConnectedDevices.and.returnValue(of(makeDevicesData({
        wifiDevices: [makeWifiHost({ signalStrengthDbm: -60 })],
        ethernetDevices: [],
      })));
      fixture.detectChanges();

      const signalBadge = fixture.nativeElement.querySelector('.signal-badge');
      expect(signalBadge.classList).toContain('signal-medium');
    });

    it('BUG #3: signal-badge deve aplicar signal-weak quando dbm <= -70', () => {
      cpeStub.getConnectedDevices.and.returnValue(of(makeDevicesData({
        wifiDevices: [makeWifiHost({ signalStrengthDbm: -80 })],
        ethernetDevices: [],
      })));
      fixture.detectChanges();

      const signalBadge = fixture.nativeElement.querySelector('.signal-badge');
      expect(signalBadge.classList).toContain('signal-weak');
    });

    it('BUG #4: QoE badge deve mostrar N/A quando qoe é null', () => {
      cpeStub.getConnectedDevices.and.returnValue(of(makeDevicesData({
        wifiDevices: [makeWifiHost({ qoe: null })],
        ethernetDevices: [],
      })));
      fixture.detectChanges();

      const qoeNa = fixture.nativeElement.querySelector('.qoe-na');
      expect(qoeNa).not.toBeNull();
      expect(qoeNa.textContent.trim()).toBe('N/A');
    });

    it('BUG #4: QoE badge deve mostrar valor quando qoe não é null', () => {
      cpeStub.getConnectedDevices.and.returnValue(of(makeDevicesData({
        wifiDevices: [makeWifiHost({ qoe: 92 })],
        ethernetDevices: [],
      })));
      fixture.detectChanges();

      const qoeBadge = fixture.nativeElement.querySelector('.qoe-badge');
      expect(qoeBadge).not.toBeNull();
      expect(qoeBadge.textContent.trim()).toBe('92');
    });

    it('BUG #12: refresh manual deve reiniciar auto-refresh e sincronizar countdown', fakeAsync(() => {
      (component as any).listenWifiDataRefreshed();
      (component as any).startHostsAutoRefresh();
      (component as any).startCountdownTimer();

      cpeStub.refreshWifiHosts.and.returnValue(of({ message: 'ok' }));
      component.refreshDevicesData();
      tick();

      // Antes do WS: countdown foi resetado para 60 pelo refreshDevicesData
      expect(component.nextRefreshInSeconds).toBe(60);

      // Decrementa um pouco
      tick(10_000);
      expect(component.nextRefreshInSeconds).toBe(50);

      // CPE responde → listenWifiDataRefreshed reinicia auto-refresh + countdown
      wsStub.emitWifiRefreshed('TEST001');
      tick();

      // Countdown deve ser resetado para 60 (sincronizado com novo intervalo)
      expect(component.nextRefreshInSeconds).toBe(60);

      tick(5_000);
      discardPeriodicTasks();
    }));
  });
});
