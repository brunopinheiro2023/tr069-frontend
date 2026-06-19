import { Injectable } from '@angular/core';
import { DiagnosticResult, PingResult, TraceRouteResult, SpeedTestResult, DNSLookupResult, UDPEchoResult, WifiNeighborResult } from '../models';

/**
 * Serviço para encapsular a lógica de parsing e formatação de dados brutos
 * vindos da CPE, como telemetria OMCI e resultados de diagnósticos.
 */
@Injectable({
  providedIn: 'root'
})
export class DiagnosticParserService {

  constructor() { }

  // --- PARSERS DE TELEMETRIA OMCI (ITU-T G.988) ---

  /**
   * Converte valor bruto de RX Power (em 0.1 µW) para dBm.
   * @param val - Valor string do parâmetro TR-069.
   * @returns Valor em dBm ou null se inválido.
   */
  parseOmciRx(val: string): number | null {
    const v = parseFloat(val);
    if (isNaN(v)) return null;
    // A norma especifica que o valor é em unidades de 0.1 microwatts.
    // A conversão para dBm é 10 * log10(potencia_mW).
    // 0.1 µW = 0.0001 mW.
    if (v > 0) return Number((10 * Math.log10(v * 0.0001)).toFixed(2));
    // Alguns firmwares já retornam o valor em dBm (negativo).
    return v;
  }

  /**
   * Converte valor bruto de TX Power (em 0.1 µW) para dBm.
   * @param val - Valor string do parâmetro TR-069.
   * @returns Valor em dBm ou null se inválido.
   */
  parseOmciTx(val: string): number | null {
    const v = parseFloat(val);
    if (isNaN(v)) return null;
    if (v > 0) return Number((10 * Math.log10(v * 0.0001)).toFixed(2));
    return v;
  }

  /**
   * Converte valor bruto de temperatura do transceptor para Celsius.
   * A norma especifica que o valor é um signed integer de 16 bits,
   * onde o valor real é o inteiro / 256.
   * @param val - Valor string do parâmetro TR-069.
   * @returns Valor em °C ou null se inválido.
   */
  parseOmciTemp(val: string): number | null {
    const v = parseFloat(val);
    if (isNaN(v)) return null;
    // Valores acima de 150 são provavelmente o valor bruto da norma.
    if (v > 150) return Number((v / 256).toFixed(1));
    return v;
  }

  /**
   * Converte valor bruto de tensão do transceptor para Volts.
   * A norma especifica que o valor é em unidades de 100 µV.
   * @param val - Valor string do parâmetro TR-069.
   * @returns Valor em Volts ou null se inválido.
   */
  parseOmciVoltage(val: string): number | null {
    const v = parseFloat(val);
    if (isNaN(v)) return null;
    // 100 µV = 0.0001 V. Alguns firmwares enviam em mV (divide por 1000).
    // Vamos usar a heurística de que se for > 100, está em mV.
    if (v > 100) return Number((v / 1000).toFixed(2));
    return v;
  }

  /**
   * Converte valor bruto de corrente de bias para miliampères (mA).
   * A norma especifica que o valor é em unidades de 2 µA.
   * @param val - Valor string do parâmetro TR-069.
   * @returns Valor em mA ou null se inválido.
   */
  parseOmciBias(val: string): number | null {
    const v = parseFloat(val);
    if (isNaN(v)) return null;
    // 2 µA = 0.002 mA.
    if (v > 100) return Number(((v * 2) / 1000).toFixed(2));
    return v;
  }

  // --- FORMATADORES DE RESULTADOS DE DIAGNÓSTICO ---

  /**
   * Calcula o throughput real de um Speed Test em Mbps.
   *
   * O protocolo TR-143 retorna:
   *   - BOMTime (Beginning Of Measurement): início da medição em ms epoch
   *   - EOMTime (End Of Measurement): fim da medição em ms epoch
   *   - TestBytesReceived (download) ou TestBytesSent (upload): bytes da janela de medição
   *
   * IMPORTANTE: Usa TestBytes* (janela limpa), não TotalBytes* (inclui overhead TCP handshake),
   * pois TotalBytes inflaciona o throughput medido.
   *
   * Retorna null quando não há dados suficientes para calcular (ex: EOMTime === BOMTime).
   *
   * @param result - Resultado do Speed Test retornado pela CPE.
   * @returns Throughput em Mbps ou null se não calculável.
   */
  calculateSpeedTestThroughput(result: SpeedTestResult): number | null {
    const durationMs = result.EOMTime - result.BOMTime;
    if (!durationMs || durationMs <= 0) return null;

    // Prioriza TestBytes (janela de medição limpa) sobre TotalBytes (com overhead)
    const bytes = result.testBytesReceived ?? result.testBytesSent ?? 0;
    if (!bytes || bytes <= 0) return null;

    const bitsPerSecond = (bytes * 8) / (durationMs / 1000);
    const mbps = bitsPerSecond / 1_000_000;

    // Clamp para intervalo razoável: 0.01 Mbps a 10 Gbps
    // Valores fora deste range indicam overflow de contador ou timestamp inválido
    if (mbps < 0.01 || mbps > 10_000) return null;

    return parseFloat(mbps.toFixed(2));
  }

  /**
   * Formata o resultado de um diagnóstico para uma string legível.
   * @param result - O objeto de resultado do diagnóstico.
   * @returns Uma string resumida do resultado.
   */
  formatDiagnosticResult(result: DiagnosticResult): string {
    if (this.isPingResult(result)) {
      return `Ping para ${result.host}: ${result.successCount} sucessos, ${result.failureCount} falhas, média ${result.averageResponseTime}ms.`;
    }
    if (this.isTraceRouteResult(result)) {
      return `TraceRoute para ${result.host}: ${result.hopCount} saltos, tempo total ${result.responseTime}ms.`;
    }
    if (this.isSpeedTestResult(result)) {
      const throughput = this.calculateSpeedTestThroughput(result);
      const speedLabel = throughput !== null ? `${throughput} Mbps` : 'Velocidade não calculada';
      return `Teste de Velocidade (${result.direction}): ${speedLabel}.`;
    }
    if (this.isWifiNeighborResult(result)) {
      return `Rede vizinha encontrada: ${result.ssid} (Canal ${result.channel}, Sinal ${result.signalStrength}dBm)`;
    }
    return `Diagnóstico concluído: ${result.diagnosticsState}`;
  }

  // Type Guards para identificar o tipo de resultado de diagnóstico
  isPingResult(result: DiagnosticResult): result is PingResult { return 'successCount' in result && 'averageResponseTime' in result; }
  isTraceRouteResult(result: DiagnosticResult): result is TraceRouteResult { return 'hopCount' in result && 'hops' in result; }
  isSpeedTestResult(result: DiagnosticResult): result is SpeedTestResult { return 'direction' in result && 'BOMTime' in result; }
  isDNSLookupResult(result: DiagnosticResult): result is DNSLookupResult { return 'dnsServer' in result && 'results' in result; }
  isUDPEchoResult(result: DiagnosticResult): result is UDPEchoResult { return 'packetsReceived' in result && 'packetsResponded' in result; }
  isWifiNeighborResult(result: DiagnosticResult): result is WifiNeighborResult { return 'bssid' in result && 'signalStrength' in result; }
}
