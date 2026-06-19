import { Injectable, Inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { TelemetryData, TelemetrySnapshot } from '../models';

/** Interface para dados de telemetria cacheados. */
interface CachedTelemetry {
  data: TelemetryData;
  lastUpdated: string; // Data em formato ISO string para serialização JSON
}

/** Interface para histórico de telemetria cacheado. */
interface CachedHistory {
  history: TelemetrySnapshot[];
  timestamp: number; // Timestamp de quando o cache foi salvo
}

/**
 * Serviço para gerenciar um cache híbrido (localStorage) para dados de telemetria.
 * Persiste os dados mais recentes e o histórico entre sessões do navegador,
 * permitindo uma renderização inicial instantânea (Estresse Zero UX).
 */
@Injectable({
  providedIn: 'root'
})
export class TelemetryCacheService {
  private isBrowser: boolean;
  private readonly LATEST_TELEMETRY_PREFIX = 'telemetry_latest_';
  private readonly HISTORY_CACHE_TTL_MS = 15 * 60 * 1000; // Histórico expira em 15 minutos

  // Propriedades do IndexedDB
  private readonly DB_NAME = 'tr069-telemetry-cache';
  private readonly HISTORY_STORE_NAME = 'telemetry-history';
  private dbPromise: Promise<IDBDatabase> | null = null;

  constructor(@Inject(PLATFORM_ID) private platformId: Object) {
    this.isBrowser = isPlatformBrowser(this.platformId);
  }

  // Limite máximo de entradas no IndexedDB para evitar estouro de cota do navegador.
  // Contexto: cada entrada de histórico pode ter 100 snapshots × ~300 bytes = ~30 KB.
  // Com 200 entradas (100 CPEs × 2 períodos) = ~6 MB, bem abaixo do limite de 50 MB+.
  private readonly MAX_HISTORY_ENTRIES = 200;

  private getDb(): Promise<IDBDatabase> {
    if (!this.isBrowser) {
      return Promise.reject(new Error('IndexedDB is not available in this environment.'));
    }
    if (!this.dbPromise) {
      this.dbPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(this.DB_NAME, 1);
        request.onerror = () => {
          console.error('Erro ao abrir IndexedDB:', request.error);
          reject(request.error);
        };
        request.onsuccess = () => {
          resolve(request.result);
        };
        request.onupgradeneeded = (event) => {
          const db = (event.target as IDBOpenDBRequest).result;
          if (!db.objectStoreNames.contains(this.HISTORY_STORE_NAME)) {
            db.createObjectStore(this.HISTORY_STORE_NAME);
          }
        };
      });
    }
    return this.dbPromise;
  }

  /**
   * Limpa entradas antigas do IndexedDB quando o número total de registros
   * ultrapassa MAX_HISTORY_ENTRIES. Remove as entradas mais antigas (FIFO).
   *
   * Estratégia: lê todas as chaves, ordena por timestamp do payload e deleta
   * as mais antigas até que o total fique abaixo do limite.
   * Executado de forma assíncrona em background — não bloqueia o salvamento.
   * @private
   */
  private async pruneHistoryIfNeeded(): Promise<void> {
    try {
      const db = await this.getDb();

      // 1. Conta total de entradas
      const countTx    = db.transaction(this.HISTORY_STORE_NAME, 'readonly');
      const countStore = countTx.objectStore(this.HISTORY_STORE_NAME);
      const count: number = await new Promise((resolve, reject) => {
        const req = countStore.count();
        req.onsuccess = () => resolve(req.result);
        req.onerror   = () => reject(req.error);
      });

      if (count <= this.MAX_HISTORY_ENTRIES) return; // dentro do limite, nada a fazer

      // 2. Lê todos os pares [key, payload.timestamp] para ordenar por idade
      const readTx    = db.transaction(this.HISTORY_STORE_NAME, 'readonly');
      const readStore = readTx.objectStore(this.HISTORY_STORE_NAME);
      const entries: Array<{ key: IDBValidKey; timestamp: number }> = await new Promise((resolve, reject) => {
        const result: Array<{ key: IDBValidKey; timestamp: number }> = [];
        const cursor = readStore.openCursor();
        cursor.onsuccess = (event) => {
          const cur = (event.target as IDBRequest<IDBCursorWithValue>).result;
          if (cur) {
            const payload = cur.value as { timestamp?: number };
            result.push({ key: cur.key, timestamp: payload?.timestamp ?? 0 });
            cur.continue();
          } else {
            resolve(result);
          }
        };
        cursor.onerror = () => reject(cursor.error);
      });

      // 3. Ordena ASC por timestamp (mais antigo primeiro) e calcula quantos deletar
      entries.sort((a, b) => a.timestamp - b.timestamp);
      const toDelete = entries.slice(0, count - this.MAX_HISTORY_ENTRIES);

      if (toDelete.length === 0) return;

      // 4. Deleta as entradas mais antigas em uma única transação
      const delTx    = db.transaction(this.HISTORY_STORE_NAME, 'readwrite');
      const delStore = delTx.objectStore(this.HISTORY_STORE_NAME);
      for (const entry of toDelete) {
        delStore.delete(entry.key);
      }
      await new Promise<void>((resolve, reject) => {
        delTx.oncomplete = () => resolve();
        delTx.onerror    = () => reject(delTx.error);
      });
    } catch (e) {
      // Prunning é best-effort — falhas não devem impactar o fluxo principal
      console.warn('IndexedDB pruning falhou (ignorado):', e);
    }
  }

  /**
   * Remove todos os registros de histórico de uma CPE específica do IndexedDB.
   * Útil ao desmontar o componente de detalhe da CPE para liberar espaço.
   * @param serialNumber - O serial da CPE.
   */
  async clearSerialHistory(serialNumber: string): Promise<void> {
    if (!this.isBrowser) return;
    try {
      const db    = await this.getDb();
      const tx    = db.transaction(this.HISTORY_STORE_NAME, 'readwrite');
      const store = tx.objectStore(this.HISTORY_STORE_NAME);
      // Remove todas as entradas cujas chaves começam com history_{serialNumber}_
      const prefixToDelete = `history_${serialNumber}_`;
      const cursor = store.openCursor();
      cursor.onsuccess = (event) => {
        const cur = (event.target as IDBRequest<IDBCursorWithValue>).result;
        if (cur) {
          if (String(cur.key).startsWith(prefixToDelete)) {
            cur.delete();
          }
          cur.continue();
        }
      };
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror    = () => reject(tx.error);
      });
    } catch (e) {
      console.error(`Erro ao limpar histórico de ${serialNumber} do IndexedDB:`, e);
    }
  }

  /**
   * Salva os dados de telemetria mais recentes no localStorage.
   * @param serialNumber - O serial da CPE.
   * @param data - O objeto TelemetryData.
   * @param lastUpdated - A data da última atualização.
   */
  saveLatestTelemetry(serialNumber: string, data: TelemetryData, lastUpdated: Date): void {
    if (!this.isBrowser || !data) return;
    try {
      const key = `${this.LATEST_TELEMETRY_PREFIX}${serialNumber}`;
      const payload: CachedTelemetry = {
        data,
        lastUpdated: lastUpdated.toISOString()
      };
      localStorage.setItem(key, JSON.stringify(payload));
    } catch (e) {
      console.error('Erro ao salvar telemetria no localStorage:', e);
      // Em caso de erro (ex: QuotaExceededError), uma estratégia de limpeza de
      // caches antigos poderia ser implementada aqui.
    }
  }

  /**
   * Carrega os dados de telemetria mais recentes do localStorage.
   * @param serialNumber - O serial da CPE.
   * @returns Os dados cacheados ou null.
   */
  loadLatestTelemetry(serialNumber: string): CachedTelemetry | null {
    if (!this.isBrowser) return null;
    try {
      const key = `${this.LATEST_TELEMETRY_PREFIX}${serialNumber}`;
      const rawData = localStorage.getItem(key);
      return rawData ? JSON.parse(rawData) : null;
    } catch (e) {
      console.error('Erro ao carregar telemetria do localStorage:', e);
      return null;
    }
  }

  /**
   * Salva o histórico de telemetria para um período específico no localStorage.
   * @param serialNumber - O serial da CPE.
   * @param periodHours - O período do histórico (ex: 6, 24).
   * @param history - O array de snapshots de telemetria.
   */
  async saveHistory(serialNumber: string, periodHours: number, history: TelemetrySnapshot[]): Promise<void> {
    if (!this.isBrowser || !history || history.length === 0) return;
    try {
      const db = await this.getDb();
      const key = `history_${serialNumber}_${periodHours}h`;
      const payload: CachedHistory = {
        history,
        timestamp: Date.now()
      };
      const tx = db.transaction(this.HISTORY_STORE_NAME, 'readwrite');
      const store = tx.objectStore(this.HISTORY_STORE_NAME);
      store.put(payload, key);
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });

      // Limpeza FIFO em background: garante que o IndexedDB não cresça indefinidamente.
      // Não aguardamos a conclusão (fire-and-forget) para não bloquear o caller.
      this.pruneHistoryIfNeeded().catch(e => console.warn('IndexedDB prune failed:', e));
    } catch (e) {
      console.error(`Erro ao salvar histórico de ${periodHours}h no IndexedDB:`, e);
    }
  }

  /**
   * Carrega o histórico de telemetria do cache se não estiver expirado.
   * @param serialNumber - O serial da CPE.
   * @param periodHours - O período do histórico a ser carregado.
   * @returns O histórico cacheado ou null.
   */
  async loadHistory(serialNumber: string, periodHours: number): Promise<TelemetrySnapshot[] | null> {
    if (!this.isBrowser) return null;
    try {
      const db = await this.getDb();
      const key = `history_${serialNumber}_${periodHours}h`;
      const tx = db.transaction(this.HISTORY_STORE_NAME, 'readonly');
      const store = tx.objectStore(this.HISTORY_STORE_NAME);
      const request = store.get(key);

      const payload: CachedHistory | undefined = await new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });

      if (!payload) return null;

      // Valida se o cache de histórico expirou
      if (Date.now() - payload.timestamp > this.HISTORY_CACHE_TTL_MS) {
        // Limpa cache expirado em uma transação separada para não bloquear a leitura
        this.getDb().then(db => {
          const writeTx = db.transaction(this.HISTORY_STORE_NAME, 'readwrite');
          writeTx.objectStore(this.HISTORY_STORE_NAME).delete(key);
        }).catch(err => console.error('Falha ao deletar histórico expirado do IndexedDB', err));
        return null;
      }
      return payload.history;
    } catch (e) {
      console.error(`Erro ao carregar histórico de ${periodHours}h do IndexedDB:`, e);
      return null;
    }
  }
}
