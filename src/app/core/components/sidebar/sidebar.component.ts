import { Component, EventEmitter, Input, Output } from '@angular/core';
import { RouterModule } from '@angular/router';
import { CommonModule } from '@angular/common';

/**
 * Sidebar global do Design System.
 *
 * Comportamento:
 *  - Desktop (>= 1024px): fixa à esquerda, sempre visível.
 *  - Mobile (< 1024px): off-canvas overlay que desliza da esquerda.
 *    A abertura é controlada pelo AppComponent via [mobileOpen].
 */
@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [RouterModule, CommonModule],
  templateUrl: './sidebar.component.html',
  styleUrl: './sidebar.component.scss'
})
export class SidebarComponent {
  /** Estado de abertura em mobile (controlado pelo AppComponent) */
  @Input() mobileOpen = false;

  /** Emite quando o utilizador clica no botão de fechar (mobile) ou num link */
  @Output() closeSidebar = new EventEmitter<void>();

  onNavClick(): void {
    // Em mobile, fecha a sidebar ao navegar para não bloquear a tela
    this.closeSidebar.emit();
  }
}
