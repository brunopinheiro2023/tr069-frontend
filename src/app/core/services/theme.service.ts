import { Injectable, Renderer2, RendererFactory2 } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';

export type AppTheme = 'light' | 'dark';

/**
 * Serviço centralizado de gestão de temas (Light / Dark).
 *
 * Arquitetura:
 *  - Utiliza BehaviorSubject para reatividade reativa (Observable) em toda a app.
 *  - Persiste a preferência no localStorage.
 *  - Aplica/remove a classe CSS `.dark` em <html> para compatibilidade com
 *    TailwindCSS `darkMode: 'class'` e com as Custom Properties do Design System.
 *  - Suporta preferência do sistema operacional (`prefers-color-scheme`) como fallback.
 */
@Injectable({
  providedIn: 'root'
})
export class ThemeService {
  private readonly THEME_KEY = 'vmoas-theme';
  private readonly renderer: Renderer2;

  // BehaviorSubject emite o tema atual; subscrições reagem em tempo real.
  private _theme$ = new BehaviorSubject<AppTheme>(this.detectInitialTheme());

  /** Observable público para que qualquer componente reaja à troca de tema */
  public readonly theme$: Observable<AppTheme> = this._theme$.asObservable();

  constructor(rendererFactory: RendererFactory2) {
    this.renderer = rendererFactory.createRenderer(null, null);
    this.applyTheme(this._theme$.value); // Aplica imediatamente no bootstrap
  }

  /**
   * Alterna entre Light e Dark, persistindo e notificando subscritores.
   */
  toggleTheme(): void {
    const next: AppTheme = this._theme$.value === 'light' ? 'dark' : 'light';
    this.setTheme(next);
  }

  /**
   * Define o tema programaticamente (ex.: ao carregar preferência do perfil do técnico).
   */
  setTheme(theme: AppTheme): void {
    this._theme$.next(theme);
    this.applyTheme(theme);
    localStorage.setItem(this.THEME_KEY, theme);
  }

  /**
   * Retorna o tema atual de forma síncrona (útil em templates com `| async` ou getters).
   */
  getCurrentTheme(): AppTheme {
    return this._theme$.value;
  }

  /**
   * Verifica se o tema ativo é escuro (conveniência para ícones/imagens condicionais).
   */
  isDarkMode(): boolean {
    return this._theme$.value === 'dark';
  }

  // -------------------------------------------------------------------------
  // Métodos privados
  // -------------------------------------------------------------------------

  /** Aplica a classe `.dark` no <html> quando necessário. */
  private applyTheme(theme: AppTheme): void {
    const html = document.documentElement;
    if (theme === 'dark') {
      this.renderer.addClass(html, 'dark');
    } else {
      this.renderer.removeClass(html, 'dark');
    }
  }

  /** Detecta o tema inicial: localStorage → prefers-color-scheme → light. */
  private detectInitialTheme(): AppTheme {
    const saved = localStorage.getItem(this.THEME_KEY) as AppTheme | null;
    if (saved === 'light' || saved === 'dark') {
      return saved;
    }
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      return 'dark';
    }
    return 'light';
  }
}
