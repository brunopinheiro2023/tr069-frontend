import { Component, Input, Output, EventEmitter, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormGroup } from '@angular/forms';
import { ButtonComponent } from '../../../../../../../core/components/button/button.component';
import { IconTooltipComponent } from '../../../../../../../core/components/icon-tooltip/icon-tooltip.component';
import { HelpToggleComponent } from '../../../../../../../core/components/help-toggle/help-toggle.component';

@Component({
  selector: 'app-wifi-ssid-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, ReactiveFormsModule, ButtonComponent, IconTooltipComponent, HelpToggleComponent],
  templateUrl: './wifi-ssid-card.component.html',
  styleUrls: ['./wifi-ssid-card.component.scss']
})
export class WifiSsidCardComponent {
  @Input() ssidForm!: FormGroup;
  @Input() index!: number;
  @Input() capabilities: Record<string, boolean> = {};
  @Input() smartConnect = false;
  @Input() isPrimary = true;
  @Input() isApplyingWifi = false;
  @Output() save = new EventEmitter<number>();
  @Output() disableGuest = new EventEmitter<string>();
  @Output() toggle = new EventEmitter<{ path: string; event: Event; type: string }>();

  // Toggle de visibilidade da senha (show/hide)
  showPassword = false;

  get band(): string {
    return this.ssidForm.get('band')?.value || '2.4GHz';
  }

  get isLocked(): boolean {
    return this.smartConnect && this.band === '5GHz';
  }

  get isDisabled(): boolean {
    return !this.ssidForm.get('enable')?.value || this.isLocked;
  }

  get isTR181(): boolean {
    return this.ssidForm.get('isTR181')?.value || false;
  }

  get status(): string {
    return this.ssidForm.get('status')?.value || 'Unknown';
  }

  get ssidIndex(): string {
    return String(this.ssidForm.get('index')?.value ?? '');
  }

  get isHardwareLocked(): boolean {
    return this.ssidForm.get('isLockedByHardware')?.value || false;
  }

  hasCapability(cap: string): boolean {
    // Fallback permissivo (?? true): assume suportado até o backend confirmar o contrário.
    // Consistente com o hasCapability do parent (cpe-wifi-tab.component.ts).
    return this.capabilities?.[cap] ?? true;
  }

  onSave(): void {
    this.save.emit(this.index);
  }

  onDisableGuest(): void {
    this.disableGuest.emit(this.ssidIndex);
  }

  onToggle(path: string, event: Event, type: string): void {
    // 5GHz locked por Smart Connect — ignora toggle para evitar mudanças que
    // seriam sobrescritas pelo bandSteering.sync no próximo saveCard 2.4GHz
    if (this.isLocked) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    this.toggle.emit({ path, event, type });
  }
}
