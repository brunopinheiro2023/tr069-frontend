import { Component, EventEmitter, Input, Output } from '@angular/core';
import { Router } from '@angular/router';
import { ThemeService } from '../../services/theme.service';
import { AuthService } from '../../services/auth.service';
import { CommonModule } from '@angular/common';

/**
 * Header global do Design System.
 *
 * Responsabilidades:
 *  - Exibir título da página / breadcrumbs (placeholder para expansão futura)
 *  - Botão de toggle da sidebar em mobile (hamburger)
 *  - Botão de troca de tema (light/dark)
 *  - Perfil do técnico (avatar + nome)
 */
@Component({
  selector: 'app-header',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './header.component.html',
  styleUrls: ['./header.component.scss']
})
export class HeaderComponent {
  /** Estado da sidebar (vindo do AppComponent) */
  @Input() sidebarOpen = false;

  /** Emite quando o técnico clica no botão hamburger */
  @Output() toggleSidebar = new EventEmitter<void>();

  constructor(
    private themeService: ThemeService,
    private authService: AuthService,
    private router: Router
  ) {}

  onToggleSidebar(): void {
    this.toggleSidebar.emit();
  }

  toggleTheme(): void {
    this.themeService.toggleTheme();
  }

  get isDarkMode(): boolean {
    return this.themeService.isDarkMode();
  }

  /**
   * Realiza o logout do usuário e redireciona para a tela de login.
   */
  logout(): void {
    this.authService.logout();
    this.router.navigate(['/login']);
  }

  /**
   * Getter para obter dinamicamente o nome do usuário logado.
   */
  get username(): string {
    return this.authService.getUsername() || 'Técnico';
  }

  /**
   * Getter para gerar as iniciais do usuário para o avatar.
   */
  get userInitials(): string {
    const name = this.username;
    if (!name || name === 'Técnico') {
      return 'T';
    }
    const parts = name.trim().split(' ');
    const initials = parts.length > 1 ? `${parts[0][0]}${parts[parts.length - 1][0]}` : name.substring(0, 2);
    return initials.toUpperCase();
  }
}
