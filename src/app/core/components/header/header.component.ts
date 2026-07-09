import { Component, EventEmitter, Input, Output, OnInit, OnDestroy } from '@angular/core';
import { Router } from '@angular/router';
import { ThemeService } from '../../services/theme.service';
import { AuthService } from '../../services/auth.service';
import { WebSocketService, WsConnectionStatus } from '../../services/websocket.service';
import { CommonModule } from '@angular/common';
import { Subscription } from 'rxjs';

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
export class HeaderComponent implements OnInit, OnDestroy {
  /** Estado da sidebar (vindo do AppComponent) */
  @Input() sidebarOpen = false;

  /** Emite quando o técnico clica no botão hamburger */
  @Output() toggleSidebar = new EventEmitter<void>();

  // P4: Status de conexão WebSocket para feedback visual no header.
  wsStatus: WsConnectionStatus = 'disconnected';
  private wsSub?: Subscription;

  constructor(
    private themeService: ThemeService,
    private authService: AuthService,
    private router: Router,
    private wsService: WebSocketService
  ) {}

  ngOnInit(): void {
    this.wsSub = this.wsService.connectionStatus.subscribe(status => {
      this.wsStatus = status;
    });
  }

  ngOnDestroy(): void {
    this.wsSub?.unsubscribe();
  }

  /** Label amigável para o indicador de status WebSocket. */
  get wsStatusLabel(): string {
    switch (this.wsStatus) {
      case 'connected':    return 'Tempo real ativo';
      case 'reconnecting': return 'Reconectando...';
      case 'disconnected': return 'Tempo real indisponível';
    }
  }

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
