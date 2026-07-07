/**
 * Motor de Micro-Transações SPV (SetParameterValues) para Wi-Fi.
 * Centraliza o batching de parâmetros TR-069 com debounce automático.
 *
 * Reutilizável em qualquer componente que precise enviar SPV em lote:
 * - queueChange(param) adiciona parâmetro ao batch + dispara debounce
 * - flushBatch() envia imediatamente (para ações explícitas do usuário)
 * - pendingCount expõe o número de alterações pendentes (para UI)
 * - onFlush callback permite ao caller executar lógica customizada no flush
 *
 * Padrão: debounce de 2s agrupa toggles rápidos; flush manual para "Salvar".
 */
import { Injectable, OnDestroy } from '@angular/core';
import { Subject, Subscription } from 'rxjs';
import { debounceTime, filter } from 'rxjs/operators';
import { WIFI_CONSTANTS } from './wifi-constants';

export interface WifiParam {
  name: string;
  value: string;
  type?: 'xsd:string' | 'xsd:boolean' | 'xsd:int' | 'xsd:unsignedInt';
}

export type FlushCallback = (payload: WifiParam[]) => void;
export type QueueCallback = (param: WifiParam) => void;

/**
 * Configuração do motor de batch.
 * Permite customizar debounce e comportamento sem alterar a lógica central.
 */
export interface BatchQueueConfig {
  /** Debounce em ms antes de enviar o batch (default: 2000) */
  debounceMs?: number;
  /** Callback executado quando o batch é enviado (recebe o payload) */
  onFlush?: FlushCallback;
  /** Callback executado quando um parâmetro é enfileirado (para optimistic update) */
  onQueue?: QueueCallback;
  /** Função que retorna true se o batch deve ser bloqueado (ex: provisionamento ativo) */
  isBlocked?: () => boolean;
}

@Injectable()
export class WifiBatchQueueService implements OnDestroy {
  private pendingChangesMap = new Map<string, WifiParam>();
  private batchSubject = new Subject<void>();
  private batchSub?: Subscription;
  private config: Required<BatchQueueConfig> = {
    debounceMs: 2000,
    onFlush: () => {},
    onQueue: () => {},
    isBlocked: () => false,
  };

  /** Número de alterações pendentes (para exibição na UI) */
  pendingCount = 0;

  /**
   * Inicializa o motor de batch com configuração customizada.
   * Deve ser chamado no ngOnInit do componente consumidor.
   */
  init(config: BatchQueueConfig = {}): void {
    this.config = { ...this.config, ...config } as Required<BatchQueueConfig>;
    this.batchSub = this.batchSubject.pipe(
      debounceTime(this.config.debounceMs),
      filter(() => this.pendingChangesMap.size > 0 && !this.config.isBlocked()),
    ).subscribe(() => {
      this.flushBatch();
    });
  }

  /**
   * Adiciona um parâmetro ao batch e dispara o debounce.
   * Se o parâmetro já existe no batch (mesmo name), substitui o valor.
   * Executa onQueue callback para optimistic update no caller.
   */
  queueChange(param: WifiParam): void {
    this.pendingChangesMap.set(param.name, param);
    this.pendingCount = this.pendingChangesMap.size;
    this.config.onQueue(param);
    this.batchSubject.next();
  }

  /**
   * Drena o batch: retorna o payload e limpa a fila.
   * Diferente de flushBatch (que chama onFlush), drain apenas retorna os dados.
   * Usado quando o caller precisa processar o payload custommente.
   */
  drain(): WifiParam[] {
    const payload = Array.from(this.pendingChangesMap.values());
    this.pendingChangesMap.clear();
    this.pendingCount = 0;
    return payload;
  }

  /**
   * Envia o batch imediatamente sem aguardar o debounce.
   * Usado para ações explícitas do usuário (ex: "Salvar Rede").
   * Limpa o batch após enviar.
   */
  flushBatch(): void {
    const payload = Array.from(this.pendingChangesMap.values());
    this.pendingChangesMap.clear();
    this.pendingCount = 0;
    if (payload.length > 0) {
      this.config.onFlush(payload);
    }
  }

  /**
   * Verifica se há alterações pendentes no batch.
   */
  hasPending(): boolean {
    return this.pendingChangesMap.size > 0;
  }

  /**
   * Dispara o batch se houver alterações pendentes.
   * Usado após desbloquear a tela (unlockScreenAndFinish).
   */
  triggerIfPending(): void {
    if (this.pendingChangesMap.size > 0) {
      this.batchSubject.next();
    }
  }

  /**
   * Limpa o batch sem enviar (usado em rollback).
   */
  clear(): void {
    this.pendingChangesMap.clear();
    this.pendingCount = 0;
  }

  ngOnDestroy(): void {
    this.batchSub?.unsubscribe();
    this.batchSubject.complete();
  }
}
