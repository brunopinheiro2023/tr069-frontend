import { Component, EventEmitter, Input, Output } from '@angular/core';
import { ThemeService } from '../../services/theme.service';

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
  imports: [],
  templateUrl: './header.component.html',
  styleUrls: ['./header.component.scss']
})
export class HeaderComponent {
  /** Estado da sidebar (vindo do AppComponent) */
  @Input() sidebarOpen = false;

  /** Emite quando o técnico clica no botão hamburger */
  @Output() toggleSidebar = new EventEmitter<void>();

  constructor(private themeService: ThemeService) {}

  onToggleSidebar(): void {
    this.toggleSidebar.emit();
  }

  toggleTheme(): void {
    this.themeService.toggleTheme();
  }

  get isDarkMode(): boolean {
    return this.themeService.isDarkMode();
  }
}
