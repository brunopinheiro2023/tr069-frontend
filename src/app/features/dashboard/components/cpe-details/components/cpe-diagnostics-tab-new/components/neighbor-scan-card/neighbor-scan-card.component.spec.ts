/**
 * @file neighbor-scan-card.component.spec.ts
 *
 * Suite de testes para NeighborScanCardComponent.
 * Cobre: lógica pura (getters/helpers), filtro de insights host-specific,
 * displayChannels5g, isSuggestedChannel, memoização no setter de result,
 * emissão de eventos (runScan, applyRecommendation).
 *
 * Padrão: Karma/Jasmine · Angular TestBed · standalone component
 */

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';

import {
  NeighborScanCardComponent,
  NeighborScanResult,
} from './neighbor-scan-card.component';
import { ChannelEntry, ChannelSuggestion, WifiInsight } from '@app/core/models';

// ── Helpers de fixture ────────────────────────────────────────────────────────

/** Cria um ChannelEntry para uso nos testes. */
function makeChannel(overrides: Partial<ChannelEntry> = {}): ChannelEntry {
  return {
    channel: 1,
    neighborCount: 0,
    interferenceScore: 0,
    ...overrides,
  } as ChannelEntry;
}

/** Cria um ChannelSuggestion completo. */
function makeSuggestion(
  overrides: Partial<ChannelSuggestion> = {},
): ChannelSuggestion {
  return {
    bestChannel: 11,
    currentChannel: 6,
    currentScore: 2.5,
    bestScore: 0.5,
    improvement: 2.0,
    shouldChange: true,
    reason: 'Canal 6 saturado, canal 11 livre',
    ...overrides,
  } as ChannelSuggestion;
}

/** Cria um WifiInsight para uso nos testes. */
function makeInsight(overrides: Partial<WifiInsight> = {}): WifiInsight {
  return {
    id: 'insight-1',
    severity: 'warning',
    category: 'canal',
    title: 'Canal saturado',
    description: 'Canal 6 tem 5 vizinhos',
    sourceParam: 'Device.WiFi.Radio.1.Channel',
    actionable: true,
    action: {
      type: 'set_channel',
      band: '2.4GHz',
      parameter: 'Device.WiFi.Radio.1.Channel',
      value: '11',
    },
    ...overrides,
  } as WifiInsight;
}

/** Cria um NeighborScanResult completo com channelSaturation. */
function makeResult(
  overrides: Partial<NeighborScanResult> = {},
): NeighborScanResult {
  return {
    serialNumber: 'TEST001',
    neighboringWiFiResultCount: 5,
    timestamp: '2026-01-15T10:00:00.000Z',
    channelSaturation: {
      isRealData: true,
      bands: {
        '2.4GHz': {
          band: '2.4GHz',
          channels: {
            1: makeChannel({
              channel: 1,
              neighborCount: 2,
              interferenceScore: 1.5,
            }),
            6: makeChannel({
              channel: 6,
              neighborCount: 5,
              interferenceScore: 3.2,
            }),
            11: makeChannel({
              channel: 11,
              neighborCount: 0,
              interferenceScore: 0,
            }),
          },
          suggestion: makeSuggestion(),
        },
        '5GHz': {
          band: '5GHz',
          channels: {
            36: makeChannel({
              channel: 36,
              neighborCount: 0,
              interferenceScore: 0,
            }),
            149: makeChannel({
              channel: 149,
              neighborCount: 1,
              interferenceScore: 0.5,
            }),
          },
          suggestion: makeSuggestion({
            bestChannel: 36,
            currentChannel: 149,
            shouldChange: true,
            reason: 'Canal 36 livre',
          }),
        },
      },
    },
    bands: {
      '2.4GHz': {
        totalClients: 3,
        radio: { bandwidth: '20MHz', snr: 30, noise: -90, channel: 6 },
      },
      '5GHz': {
        totalClients: 2,
        radio: { bandwidth: '80MHz', snr: 35, noise: -95, channel: 149 },
      },
    },
    summary: { totalClients: 5, hasCongestion: true, criticalClients: 1 },
    ...overrides,
  } as NeighborScanResult;
}

// ── Suite principal ───────────────────────────────────────────────────────────

describe('NeighborScanCardComponent', () => {
  let fixture: ComponentFixture<NeighborScanCardComponent>;
  let component: NeighborScanCardComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [NeighborScanCardComponent],
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();

    fixture = TestBed.createComponent(NeighborScanCardComponent);
    component = fixture.componentInstance;
    component.serialNumber = 'TEST001';
  });

  afterEach(() => {
    fixture.destroy();
  });

  // ── 1. Criação ──────────────────────────────────────────────────────────────

  describe('Criação', () => {
    it('deve ser criado com sucesso', () => {
      fixture.detectChanges();
      expect(component).toBeTruthy();
    });

    it('deve ter valores padrão corretos', () => {
      expect(component.serialNumber).toBe('TEST001');
      expect(component.readOnly).toBeFalse();
      expect(component.isSupported).toBeTrue();
      expect(component.isRunning).toBeFalse();
      expect(component.applyInProgress).toBeFalse();
      expect(component.result).toBeNull();
      expect(component.insights).toEqual([]);
    });
  });

  // ── 2. Getters de dados básicos ─────────────────────────────────────────────

  describe('Getters de dados', () => {
    it('hasRealData deve retornar true quando isRealData=true', () => {
      component.result = makeResult();
      expect(component.hasRealData).toBeTrue();
    });

    it('hasRealData deve retornar false quando result é null', () => {
      component.result = null;
      expect(component.hasRealData).toBeFalse();
    });

    it('hasRealData deve retornar false quando isRealData não é true', () => {
      component.result = makeResult({
        channelSaturation: { isRealData: false, bands: {} },
      });
      expect(component.hasRealData).toBeFalse();
    });

    it('neighborCount deve sanitizar valor numérico válido', () => {
      component.result = makeResult({ neighboringWiFiResultCount: 32 });
      expect(component.neighborCount).toBe(32);
    });

    it('neighborCount deve retornar 0 para valor inválido', () => {
      component.result = makeResult({ neighboringWiFiResultCount: -1 });
      expect(component.neighborCount).toBe(0);
    });

    it('neighborCount deve retornar 0 quando result é null', () => {
      component.result = null;
      expect(component.neighborCount).toBe(0);
    });

    it('hasSaturationData deve validar objeto channelSaturation', () => {
      component.result = makeResult();
      expect(component.hasSaturationData).toBeTrue();
    });

    it('hasSaturationData deve retornar false sem channelSaturation', () => {
      component.result = makeResult({ channelSaturation: undefined });
      expect(component.hasSaturationData).toBeFalse();
    });

    it('lastScanTimestamp deve retornar string válida', () => {
      component.result = makeResult({ timestamp: '2026-01-15T10:00:00.000Z' });
      expect(component.lastScanTimestamp).toBe('2026-01-15T10:00:00.000Z');
    });

    it('lastScanTimestamp deve retornar string vazia quando inválido', () => {
      component.result = makeResult({ timestamp: undefined });
      expect(component.lastScanTimestamp).toBe('');
    });
  });

  // ── 3. Memoização de canais (setter de result) ──────────────────────────────

  describe('Memoização de canais', () => {
    it('channels2g deve extrair e ordenar canais da banda 2.4GHz', () => {
      component.result = makeResult();
      const channels = component.channels2g;
      expect(channels.length).toBe(3);
      expect(channels[0].channel).toBe(1);
      expect(channels[1].channel).toBe(6);
      expect(channels[2].channel).toBe(11);
    });

    it('channels5g deve extrair e ordenar canais da banda 5GHz', () => {
      component.result = makeResult();
      const channels = component.channels5g;
      expect(channels.length).toBe(2);
      expect(channels[0].channel).toBe(36);
      expect(channels[1].channel).toBe(149);
    });

    it('channels2g deve retornar array vazio sem channelSaturation', () => {
      component.result = null;
      expect(component.channels2g).toEqual([]);
    });

    it('channels5g deve retornar array vazio sem channelSaturation', () => {
      component.result = null;
      expect(component.channels5g).toEqual([]);
    });

    it('setter de result deve recalcular canais memoizados', () => {
      component.result = makeResult();
      expect(component.channels2g.length).toBe(3);

      // Novo result com dados diferentes
      component.result = makeResult({
        channelSaturation: {
          isRealData: true,
          bands: {
            '2.4GHz': {
              band: '2.4GHz',
              channels: {
                1: makeChannel({ channel: 1, neighborCount: 10 }),
              },
            },
            '5GHz': { band: '5GHz', channels: {} },
          },
        },
      });
      expect(component.channels2g.length).toBe(1);
      expect(component.channels2g[0].neighborCount).toBe(10);
    });
  });

  // ── 4. displayChannels5g (filtro de canais vazios) ──────────────────────────

  describe('displayChannels5g', () => {
    it('deve manter canais com neighborCount > 0', () => {
      component.result = makeResult();
      const displayed = component.displayChannels5g;
      const ch149 = displayed.find((c) => c.channel === 149);
      expect(ch149).toBeDefined();
      expect(ch149!.neighborCount).toBe(1);
    });

    it('deve manter canais não-sobrepostos mesmo sem vizinhos', () => {
      component.result = makeResult();
      const displayed = component.displayChannels5g;
      // Canal 36 é não-sobreposto (UNII-1) e tem neighborCount=0 — deve aparecer
      const ch36 = displayed.find((c) => c.channel === 36);
      expect(ch36).toBeDefined();
    });

    it('deve manter canal atual mesmo se vazio e não-sobreposto', () => {
      component.result = makeResult({
        channelSaturation: {
          isRealData: true,
          bands: {
            '2.4GHz': { band: '2.4GHz', channels: {} },
            '5GHz': {
              band: '5GHz',
              channels: {
                100: makeChannel({
                  channel: 100,
                  neighborCount: 0,
                  interferenceScore: 0,
                }),
              },
              suggestion: makeSuggestion({
                bestChannel: 36,
                currentChannel: 100,
                shouldChange: true,
              }),
            },
          },
        },
      });
      const displayed = component.displayChannels5g;
      // Canal 100 não é não-sobreposto, mas é o currentChannel — deve aparecer
      const ch100 = displayed.find((c) => c.channel === 100);
      expect(ch100).toBeDefined();
    });

    it('deve filtrar canais completamente vazios e não-sobrepostos', () => {
      component.result = makeResult({
        channelSaturation: {
          isRealData: true,
          bands: {
            '2.4GHz': { band: '2.4GHz', channels: {} },
            '5GHz': {
              band: '5GHz',
              channels: {
                100: makeChannel({
                  channel: 100,
                  neighborCount: 0,
                  interferenceScore: 0,
                }),
                104: makeChannel({
                  channel: 104,
                  neighborCount: 0,
                  interferenceScore: 0,
                }),
              },
              suggestion: makeSuggestion({
                bestChannel: 36,
                currentChannel: 149,
                shouldChange: true,
              }),
            },
          },
        },
      });
      const displayed = component.displayChannels5g;
      // Canais 100 e 104 são DFS, não-sobrepostos, sem vizinhos e não são currentChannel
      expect(displayed.find((c) => c.channel === 100)).toBeUndefined();
      expect(displayed.find((c) => c.channel === 104)).toBeUndefined();
    });
  });

  // ── 5. Sugestões de canal ───────────────────────────────────────────────────

  describe('Sugestões', () => {
    it('suggestion2g deve retornar sugestão da banda 2.4GHz', () => {
      component.result = makeResult();
      expect(component.suggestion2g).not.toBeNull();
      expect(component.suggestion2g?.bestChannel).toBe(11);
    });

    it('suggestion5g deve retornar sugestão da banda 5GHz', () => {
      component.result = makeResult();
      expect(component.suggestion5g).not.toBeNull();
      expect(component.suggestion5g?.bestChannel).toBe(36);
    });

    it('suggestion2g deve retornar null sem channelSaturation', () => {
      component.result = null;
      expect(component.suggestion2g).toBeNull();
    });
  });

  // ── 6. isSuggestedChannel ───────────────────────────────────────────────────

  describe('isSuggestedChannel', () => {
    it('deve retornar true quando canal é o bestChannel e shouldChange=true', () => {
      component.result = makeResult();
      expect(component.isSuggestedChannel(11, '2.4GHz')).toBeTrue();
    });

    it('deve retornar false quando canal é o bestChannel mas shouldChange=false', () => {
      component.result = makeResult({
        channelSaturation: {
          isRealData: true,
          bands: {
            '2.4GHz': {
              band: '2.4GHz',
              channels: {},
              suggestion: makeSuggestion({
                bestChannel: 11,
                shouldChange: false,
              }),
            },
            '5GHz': { band: '5GHz', channels: {} },
          },
        },
      });
      expect(component.isSuggestedChannel(11, '2.4GHz')).toBeFalse();
    });

    it('deve retornar false para canal que não é o bestChannel', () => {
      component.result = makeResult();
      expect(component.isSuggestedChannel(6, '2.4GHz')).toBeFalse();
    });

    it('deve retornar false quando não há sugestão', () => {
      component.result = null;
      expect(component.isSuggestedChannel(11, '2.4GHz')).toBeFalse();
    });
  });

  // ── 7. isNonOverlappingChannel ──────────────────────────────────────────────

  describe('isNonOverlappingChannel', () => {
    it('deve retornar true para canal 1 em 2.4GHz (não-sobreposto)', () => {
      expect(component.isNonOverlappingChannel(1, '2.4GHz')).toBeTrue();
    });

    it('deve retornar true para canal 6 em 2.4GHz (não-sobreposto)', () => {
      expect(component.isNonOverlappingChannel(6, '2.4GHz')).toBeTrue();
    });

    it('deve retornar true para canal 11 em 2.4GHz (não-sobreposto)', () => {
      expect(component.isNonOverlappingChannel(11, '2.4GHz')).toBeTrue();
    });

    it('deve retornar false para canal 3 em 2.4GHz (sobreposto)', () => {
      expect(component.isNonOverlappingChannel(3, '2.4GHz')).toBeFalse();
    });

    it('deve retornar true para canal 36 em 5GHz (UNII-1 não-sobreposto)', () => {
      expect(component.isNonOverlappingChannel(36, '5GHz')).toBeTrue();
    });

    it('deve retornar true para canal 149 em 5GHz (UNII-3 não-sobreposto)', () => {
      expect(component.isNonOverlappingChannel(149, '5GHz')).toBeTrue();
    });

    it('deve retornar false para canal 52 em 5GHz (DFS)', () => {
      expect(component.isNonOverlappingChannel(52, '5GHz')).toBeFalse();
    });

    it('deve retornar array vazio para banda inválida', () => {
      expect(component.getNonOverlappingChannels('6GHz')).toEqual([]);
    });
  });

  // ── 8. Filtro de insights host-specific (allInsights) ───────────────────────

  describe('allInsights (filtro host-specific)', () => {
    it('deve filtrar insights com categoria "sinal" (host-specific)', () => {
      component.insights = [
        makeInsight({ id: '1', category: 'canal', severity: 'warning' }),
        makeInsight({ id: '2', category: 'sinal', severity: 'critical' }),
        makeInsight({ id: '3', category: 'saturacao', severity: 'info' }),
      ];
      const all = component.allInsights;
      expect(all.length).toBe(2);
      expect(all.find((i) => i.category === 'sinal')).toBeUndefined();
    });

    it('deve filtrar insights com categoria "qoe" (host-specific)', () => {
      component.insights = [
        makeInsight({ id: '1', category: 'canal' }),
        makeInsight({ id: '2', category: 'qoe' }),
      ];
      const all = component.allInsights;
      expect(all.length).toBe(1);
      expect(all.find((i) => i.category === 'qoe')).toBeUndefined();
    });

    it('deve manter insights com categorias canal, saturacao, congestionamento, configuracao', () => {
      component.insights = [
        makeInsight({ id: '1', category: 'canal' }),
        makeInsight({ id: '2', category: 'saturacao' }),
        makeInsight({ id: '3', category: 'congestionamento' }),
        makeInsight({ id: '4', category: 'configuracao' }),
      ];
      expect(component.allInsights.length).toBe(4);
    });

    it('deve ordenar critical primeiro, depois warning, depois info', () => {
      component.insights = [
        makeInsight({ id: '1', severity: 'info' }),
        makeInsight({ id: '2', severity: 'critical' }),
        makeInsight({ id: '3', severity: 'warning' }),
      ];
      const all = component.allInsights;
      expect(all[0].severity).toBe('critical');
      expect(all[1].severity).toBe('warning');
      expect(all[2].severity).toBe('info');
    });

    it('deve ordenar actionable primeiro dentro da mesma severidade', () => {
      component.insights = [
        makeInsight({ id: '1', severity: 'warning', actionable: false }),
        makeInsight({ id: '2', severity: 'warning', actionable: true }),
      ];
      const all = component.allInsights;
      expect(all[0].id).toBe('2');
      expect(all[1].id).toBe('1');
    });
  });

  // ── 9. Insights getters derivados ───────────────────────────────────────────

  describe('Insights derivados', () => {
    beforeEach(() => {
      component.insights = [
        makeInsight({ id: '1', severity: 'critical', actionable: true }),
        makeInsight({ id: '2', severity: 'warning', actionable: true }),
        makeInsight({ id: '3', severity: 'info', actionable: false }),
      ];
    });

    it('actionableInsights deve retornar apenas insights com actionable=true e action', () => {
      const actionable = component.actionableInsights;
      expect(actionable.length).toBe(2);
      expect(
        actionable.every((i) => i.actionable === true && i.action),
      ).toBeTrue();
    });

    it('criticalInsights deve retornar apenas severity=critical', () => {
      expect(component.criticalInsights.length).toBe(1);
      expect(component.criticalInsights[0].severity).toBe('critical');
    });

    it('hasInsights deve ser true quando há insights', () => {
      expect(component.hasInsights).toBeTrue();
    });

    it('hasActionableInsights deve ser true quando há insights actionable', () => {
      expect(component.hasActionableInsights).toBeTrue();
    });

    it('hasCriticalInsights deve ser true quando há insights críticos', () => {
      expect(component.hasCriticalInsights).toBeTrue();
    });

    it('insightsCount deve retornar contagem total', () => {
      expect(component.insightsCount).toBe(3);
    });
  });

  // ── 10. statusTitle / statusClass / statusIcon ──────────────────────────────

  describe('Status dinâmico', () => {
    it('statusTitle deve ser "Atenção Necessária" quando há críticos', () => {
      component.insights = [makeInsight({ severity: 'critical' })];
      expect(component.statusTitle).toBe('Atenção Necessária');
    });

    it('statusTitle deve ser "Otimizações Disponíveis" quando há actionable sem críticos', () => {
      component.insights = [
        makeInsight({ severity: 'warning', actionable: true }),
      ];
      expect(component.statusTitle).toBe('Otimizações Disponíveis');
    });

    it('statusTitle deve ser "Diagnósticos Wi-Fi" quando há apenas insights não-actionable', () => {
      component.insights = [
        makeInsight({ severity: 'info', actionable: false }),
      ];
      expect(component.statusTitle).toBe('Diagnósticos Wi-Fi');
    });

    it('statusTitle deve ser "Congestionamento Detectado" sem insights mas com congestionamento', () => {
      component.insights = [];
      component.result = makeResult({ summary: { hasCongestion: true } });
      expect(component.statusTitle).toBe('Congestionamento Detectado');
    });

    it('statusTitle deve ser "Rede Otimizada" sem insights e sem congestionamento', () => {
      component.insights = [];
      component.result = makeResult({ summary: { hasCongestion: false } });
      expect(component.statusTitle).toBe('Rede Otimizada');
    });

    it('statusClass deve refletir estado crítico', () => {
      component.insights = [makeInsight({ severity: 'critical' })];
      expect(component.statusClass).toBe('status-critical');
    });

    it('statusClass deve refletir estado ok', () => {
      component.insights = [];
      component.result = makeResult({ summary: { hasCongestion: false } });
      expect(component.statusClass).toBe('status-ok');
    });
  });

  // ── 11. Eventos (runScan, applyRecommendation) ──────────────────────────────

  describe('Eventos', () => {
    it('onRunScan deve emitir runScan quando readOnly=false', () => {
      let emitted = false;
      component.runScan.subscribe(() => (emitted = true));
      component.readOnly = false;
      component.onRunScan();
      expect(emitted).toBeTrue();
    });

    it('onRunScan NÃO deve emitir runScan quando readOnly=true', () => {
      let emitted = false;
      component.runScan.subscribe(() => (emitted = true));
      component.readOnly = true;
      component.onRunScan();
      expect(emitted).toBeFalse();
    });

    it('onApplyRecommendation deve emitir insight quando applyInProgress=false', () => {
      const insight = makeInsight({ id: 'test-apply' });
      let emittedInsight: WifiInsight | null = null;
      component.applyRecommendation.subscribe((i) => (emittedInsight = i));
      component.applyInProgress = false;

      const event = new Event('click');
      spyOn(event, 'preventDefault');
      spyOn(event, 'stopPropagation');

      component.onApplyRecommendation(insight, event);
      expect(emittedInsight).not.toBeNull();
      expect((emittedInsight as unknown as WifiInsight).id).toBe('test-apply');
      expect(event.preventDefault).toHaveBeenCalled();
      expect(event.stopPropagation).toHaveBeenCalled();
    });

    it('onApplyRecommendation NÃO deve emitir quando applyInProgress=true', () => {
      const insight = makeInsight();
      let emitted = false;
      component.applyRecommendation.subscribe(() => (emitted = true));
      component.applyInProgress = true;

      const event = new Event('click');
      component.onApplyRecommendation(insight, event);
      expect(emitted).toBeFalse();
    });
  });

  // ── 12. Helpers de qualidade (SNR, utilização, congestionamento) ────────────

  describe('Helpers de qualidade', () => {
    it('getSnrQuality deve classificar SNR corretamente', () => {
      expect(component.getSnrQuality(null)).toBe('unknown');
      expect(component.getSnrQuality(30)).toBe('excellent');
      expect(component.getSnrQuality(20)).toBe('good');
      expect(component.getSnrQuality(12)).toBe('fair');
      expect(component.getSnrQuality(5)).toBe('poor');
    });

    it('getSnrLabel deve retornar label em PT-BR', () => {
      expect(component.getSnrLabel(30)).toBe('Excelente');
      expect(component.getSnrLabel(20)).toBe('Bom');
      expect(component.getSnrLabel(12)).toBe('Regular');
      expect(component.getSnrLabel(5)).toBe('Ruim');
      expect(component.getSnrLabel(null)).toBe('N/D');
    });

    it('getUtilizationQuality deve classificar utilização corretamente', () => {
      expect(component.getUtilizationQuality(null)).toBe('unknown');
      expect(component.getUtilizationQuality(90)).toBe('poor');
      expect(component.getUtilizationQuality(60)).toBe('fair');
      expect(component.getUtilizationQuality(30)).toBe('good');
    });

    it('getCongestionLevel deve classificar score corretamente', () => {
      expect(component.getCongestionLevel(0)).toBe('empty');
      expect(component.getCongestionLevel(0.5)).toBe('low');
      expect(component.getCongestionLevel(2.0)).toBe('medium');
      expect(component.getCongestionLevel(5.0)).toBe('high');
    });

    it('getCongestionLabel deve retornar label em PT-BR', () => {
      expect(component.getCongestionLabel(0)).toBe('Livre');
      expect(component.getCongestionLabel(0.5)).toBe('Baixa');
      expect(component.getCongestionLabel(2.0)).toBe('Média');
      expect(component.getCongestionLabel(5.0)).toBe('Alta');
    });

    it('getCongestionColor deve retornar cor hex válida', () => {
      expect(component.getCongestionColor('empty')).toBe('#e2e8f0');
      expect(component.getCongestionColor('low')).toBe('#22c55e');
      expect(component.getCongestionColor('medium')).toBe('#f59e0b');
      expect(component.getCongestionColor('high')).toBe('#ef4444');
      expect(component.getCongestionColor('invalid')).toBe('#64748b');
    });

    it('getCongestionWidth deve calcular porcentagem proporcional', () => {
      expect(component.getCongestionWidth(2.5, 5)).toBe(50);
      expect(component.getCongestionWidth(5, 5)).toBe(100);
      expect(component.getCongestionWidth(10, 5)).toBe(100); // cap em 100
      expect(component.getCongestionWidth(0, 5)).toBe(0);
    });
  });

  // ── 13. getChannelRecommendation ────────────────────────────────────────────

  describe('getChannelRecommendation', () => {
    it('deve retornar mensagem de canal já otimizado quando shouldChange=false', () => {
      component.result = makeResult({
        channelSaturation: {
          isRealData: true,
          bands: {
            '2.4GHz': {
              band: '2.4GHz',
              channels: {},
              suggestion: makeSuggestion({
                bestChannel: 6,
                currentChannel: 6,
                currentScore: 0.5,
                shouldChange: false,
              }),
            },
            '5GHz': { band: '5GHz', channels: {} },
          },
        },
      });
      const rec = component.getChannelRecommendation('2.4GHz');
      expect(rec).toContain('já é o melhor');
      expect(rec).toContain('Canal 6');
    });

    it('deve retornar reason do backend quando shouldChange=true', () => {
      component.result = makeResult();
      const rec = component.getChannelRecommendation('2.4GHz');
      expect(rec).toBe('Canal 6 saturado, canal 11 livre');
    });

    it('deve retornar mensagem de sem dados quando não há sugestão', () => {
      component.result = null;
      const rec = component.getChannelRecommendation('2.4GHz');
      expect(rec).toContain('Sem dados');
    });

    it('deve rejeitar banda inválida', () => {
      const rec = component.getChannelRecommendation('6GHz');
      expect(rec).toContain('inválido');
    });
  });

  // ── 14. formatTimestamp ─────────────────────────────────────────────────────

  describe('formatTimestamp', () => {
    it('deve formatar timestamp ISO válido', () => {
      const result = component.formatTimestamp('2026-01-15T10:00:00.000Z');
      expect(result).toBeTruthy();
      expect(result.length).toBeGreaterThan(0);
    });

    it('deve retornar string vazia para timestamp inválido', () => {
      expect(component.formatTimestamp('')).toBe('');
      expect(component.formatTimestamp(null as any)).toBe('');
      expect(component.formatTimestamp('invalid-date')).toBe('');
    });
  });

  // ── 15. insightActionLabel ──────────────────────────────────────────────────

  describe('insightActionLabel', () => {
    it('deve formatar ação set_channel', () => {
      const insight = makeInsight({
        action: {
          type: 'set_channel',
          band: '2.4GHz',
          parameter: 'p',
          value: '11',
        },
      });
      expect(component.insightActionLabel(insight)).toBe('Canal 2.4GHz → 11');
    });

    it('deve formatar ação set_power', () => {
      const insight = makeInsight({
        action: {
          type: 'set_power',
          band: '5GHz',
          parameter: 'p',
          value: '50',
        },
      });
      expect(component.insightActionLabel(insight)).toBe('Potência 5GHz → 50%');
    });

    it('deve formatar ação set_bandwidth', () => {
      const insight = makeInsight({
        action: {
          type: 'set_bandwidth',
          band: '2.4GHz',
          parameter: 'p',
          value: '40MHz',
        },
      });
      expect(component.insightActionLabel(insight)).toBe(
        'Largura 2.4GHz → 40MHz',
      );
    });

    it('deve retornar string vazia quando insight não tem action', () => {
      const insight = makeInsight({ action: undefined });
      expect(component.insightActionLabel(insight)).toBe('');
    });
  });

  // ── 16. RadioQuality memoizado ──────────────────────────────────────────────

  describe('RadioQuality', () => {
    it('radioQuality2g deve extrair dados do rádio 2.4GHz', () => {
      component.result = makeResult();
      expect(component.radioQuality2g.bandwidth).toBe('20MHz');
      expect(component.radioQuality2g.snr).toBe(30);
    });

    it('radioQuality5g deve extrair dados do rádio 5GHz', () => {
      component.result = makeResult();
      expect(component.radioQuality5g.bandwidth).toBe('80MHz');
      expect(component.radioQuality5g.snr).toBe(35);
    });

    it('hasRadioQualityData deve ser true quando ao menos uma banda tem rádio', () => {
      component.result = makeResult();
      expect(component.hasRadioQualityData).toBeTrue();
    });

    it('hasRadioQualityData deve ser false sem dados de rádio', () => {
      component.result = makeResult({ bands: {} });
      expect(component.hasRadioQualityData).toBeFalse();
    });

    it('SNR 0 deve ser descartado (null) — TP-Link retorna 0 quando não suportado', () => {
      component.result = makeResult({
        bands: {
          '2.4GHz': { radio: { snr: 0, channel: 6 }, totalClients: 0 },
          '5GHz': { radio: { snr: 0, channel: 36 }, totalClients: 0 },
        },
      });
      expect(component.radioQuality2g.snr).toBeNull();
    });

    it('Noise 0 ou positivo deve ser descartado (null) — não suportado', () => {
      component.result = makeResult({
        bands: {
          '2.4GHz': { radio: { noise: 0, channel: 6 }, totalClients: 0 },
          '5GHz': { radio: { noise: 5, channel: 36 }, totalClients: 0 },
        },
      });
      expect(component.radioQuality2g.noise).toBeNull();
    });

    it('Canal 0 com AutoChannelEnable=true deve ser mantido (auto mode)', () => {
      component.result = makeResult({
        bands: {
          '2.4GHz': {
            radio: { channel: 0, autoChannelEnable: true },
            totalClients: 0,
          },
          '5GHz': { radio: {}, totalClients: 0 },
        },
      });
      expect(component.radioQuality2g.channel).toBe(0);
    });

    it('Canal 0 sem AutoChannelEnable deve ser null (parâmetro não preenchido)', () => {
      component.result = makeResult({
        bands: {
          '2.4GHz': {
            radio: { channel: 0, autoChannelEnable: false },
            totalClients: 0,
          },
          '5GHz': { radio: {}, totalClients: 0 },
        },
      });
      expect(component.radioQuality2g.channel).toBeNull();
    });
  });

  // ── 17. totalClients / hasCongestion / criticalClients ──────────────────────

  describe('Sumário', () => {
    it('totalClients2g deve sanitizar valor numérico', () => {
      component.result = makeResult();
      expect(component.totalClients2g).toBe(3);
    });

    it('totalClients5g deve sanitizar valor numérico', () => {
      component.result = makeResult();
      expect(component.totalClients5g).toBe(2);
    });

    it('totalClients2g deve retornar 0 para valor inválido', () => {
      component.result = makeResult({
        bands: { '2.4GHz': { totalClients: -5 }, '5GHz': { totalClients: 0 } },
      });
      expect(component.totalClients2g).toBe(0);
    });

    it('hasCongestion deve retornar true quando summary.hasCongestion=true', () => {
      component.result = makeResult({ summary: { hasCongestion: true } });
      expect(component.hasCongestion).toBeTrue();
    });

    it('hasCongestion deve retornar false quando summary.hasCongestion=false', () => {
      component.result = makeResult({ summary: { hasCongestion: false } });
      expect(component.hasCongestion).toBeFalse();
    });

    it('criticalClients deve sanitizar valor numérico', () => {
      component.result = makeResult({ summary: { criticalClients: 2 } });
      expect(component.criticalClients).toBe(2);
    });
  });
});
