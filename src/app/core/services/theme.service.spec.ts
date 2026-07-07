// Importa as dependências de teste do Angular.
import { TestBed } from '@angular/core/testing';

// Importa o serviço que será testado.
import { ThemeService } from './theme.service';

/**
 * Descreve a suíte de testes para o ThemeService.
 * Suítes de teste agrupam testes relacionados.
 */
describe('ThemeService', () => {
  // Declara variáveis para o serviço e um mock do localStorage.
  let service: ThemeService;
  let store: { [key: string]: string };

  /**
   * Executado antes de cada teste (`it`).
   * Configura o ambiente de teste.
   */
  beforeEach(() => {
    // Inicializa o mock do localStorage.
    store = {};

    // Cria um spy no localStorage para interceptar chamadas a `getItem` e `setItem`.
    // Isso nos permite simular o comportamento do localStorage sem depender do navegador.
    spyOn(localStorage, 'getItem').and.callFake((key: string) => store[key] || null);
    spyOn(localStorage, 'setItem').and.callFake((key: string, value: string) => (store[key] = value));

    // Configura o módulo de teste do Angular.
    TestBed.configureTestingModule({
      // Fornece o ThemeService para que ele possa ser injetado.
      providers: [ThemeService],
    });

    // Injeta a instância do serviço.
    service = TestBed.inject(ThemeService);
  });

  /**
   * Testa se o serviço é criado corretamente.
   */
  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  /**
   * Testa se o tema padrão é 'light' quando não há nada no localStorage.
   */
  it('should default to "light" theme if no preference is stored', () => {
    // Reinjeta o serviço para ler o localStorage vazio.
    service = TestBed.inject(ThemeService);
    expect(service.getCurrentTheme()).toBe('light');
  });

  /**
   * Testa a funcionalidade de alternar o tema.
   */
  it('should toggle theme from light to dark', () => {
    // Garante que o estado inicial é 'light'.
    service.setTheme('light');
    // Executa a ação de alternar.
    service.toggleTheme();
    // Verifica se o tema atual é 'dark'.
    expect(service.getCurrentTheme()).toBe('dark');
    // Verifica se a preferência foi salva no mock do localStorage.
    expect(localStorage.getItem('theme')).toBe('dark');
  });

  /**
   * Testa a funcionalidade de definir um tema específico.
   */
  it('should set theme to dark and persist it', () => {
    service.setTheme('dark');
    expect(service.getCurrentTheme()).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBeTrue();
    expect(localStorage.getItem('theme')).toBe('dark');
  });
});
