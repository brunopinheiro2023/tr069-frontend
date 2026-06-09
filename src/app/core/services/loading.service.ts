import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { distinctUntilChanged, map } from 'rxjs/operators';

/**
 * Estado de loading granular para uma chave específica (ex.: 'wifi-refresh', 'optimize').
 */
export interface LoadingState {
  active: boolean;
  message?: string;
}

/**
 * Serviço centralizado de gestão de estados de carregamento.
 *
 * Arquitetura:
 *  - Utiliza um Map<string, BehaviorSubject> para permitir múltiplos estados
 *    independentes em paralelo (ex.: uma tabela pode carregar enquanto um botão
 *    de otimização aguarda resposta do WebSocket).
 *  - Oferece métodos globais (full-screen overlay) e locais (por chave).
 *  - Integra-se com o `app-button` (spinner integrado) e com skeleton loaders.
 *
 * Uso típico num componente:
 *   this.loading.start('optimize');
 *   ... após resposta do WS ...
 *   this.loading.stop('optimize');
 */
@Injectable({
  providedIn: 'root'
})
export class LoadingService {
  // Estado global de overlay (ex.: inicialização da app, troca de rota pesada)
  private _global$ = new BehaviorSubject<boolean>(false);
  public readonly global$: Observable<boolean> = this._global$.asObservable().pipe(
    distinctUntilChanged()
  );

  // Estados localizados por chave (ex.: 'wifi-refresh', 'neighbor-scan')
  private _states = new Map<string, BehaviorSubject<LoadingState>>();

  // Timer para debounce do loading global (evita flicker em requisições < 200ms)
  private _globalDebounceTimer: any = null;

  // Delay em ms antes de efetivamente mostrar o overlay global
  private readonly GLOBAL_DEBOUNCE_MS = 200;

  /**
   * Inicia o estado de carregamento global (overlay em tela cheia).
   * Com debounce: só ativa o overlay após 200ms. Se stopGlobal() for chamado
   * antes desse tempo, o overlay NUNCA aparece — evitando flicker irritante.
   */
  startGlobal(message?: string): void {
    // Limpa timer anterior se existir (evita múltiplos timers acumulados)
    if (this._globalDebounceTimer) {
      clearTimeout(this._globalDebounceTimer);
    }

    // Agenda a ativação do overlay após o debounce
    this._globalDebounceTimer = setTimeout(() => {
      this._global$.next(true);
      this._globalDebounceTimer = null;
    }, this.GLOBAL_DEBOUNCE_MS);
  }

  /**
   * Encerra o estado de carregamento global.
   * Se o debounce ainda não disparou, cancela-o — o overlay nem chega a aparecer.
   */
  stopGlobal(): void {
    // Cancela o debounce pendente (requisição terminou muito rápido)
    if (this._globalDebounceTimer) {
      clearTimeout(this._globalDebounceTimer);
      this._globalDebounceTimer = null;
    }
    // Desliga o overlay se já estiver ativo
    this._global$.next(false);
  }

  /**
   * Inicia o carregamento para uma chave específica.
   * @param key Identificador único do estado (ex.: componente + ação)
   * @param message Mensagem opcional descritiva
   */
  start(key: string, message?: string): void {
    this.getSubject(key).next({ active: true, message });
  }

  /**
   * Encerra o carregamento para uma chave específica.
   */
  stop(key: string): void {
    this.getSubject(key).next({ active: false });
  }

  /**
   * Observable de um estado específico. Ideal para usar no template com `| async`.
   */
  isLoading$(key: string): Observable<boolean> {
    return this.getSubject(key).asObservable().pipe(
      distinctUntilChanged((a, b) => a.active === b.active),
      map((state: LoadingState) => state.active)
    );
  }

  /**
   * Verificação síncrona se uma chave está carregando.
   */
  isLoading(key: string): boolean {
    return this.getSubject(key).value.active;
  }

  /**
   * Reseta TODOS os estados locais (útil em `ngOnDestroy` de páginas ou logout).
   * Também cancela qualquer debounce pendente do loading global.
   */
  resetAll(): void {
    if (this._globalDebounceTimer) {
      clearTimeout(this._globalDebounceTimer);
      this._globalDebounceTimer = null;
    }
    this._global$.next(false);
    this._states.forEach((sub) => sub.next({ active: false }));
  }

  // ---------------------------------------------------------------------------
  // Helpers privados
  // ---------------------------------------------------------------------------

  private getSubject(key: string): BehaviorSubject<LoadingState> {
    if (!this._states.has(key)) {
      this._states.set(key, new BehaviorSubject<LoadingState>({ active: false }));
    }
    return this._states.get(key)!;
  }
}

