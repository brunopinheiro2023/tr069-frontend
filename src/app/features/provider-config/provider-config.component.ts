import {
  Component,
  OnInit,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  DestroyRef,
  inject,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  ReactiveFormsModule,
  FormBuilder,
  FormGroup,
  Validators,
} from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { catchError, finalize, of } from 'rxjs';
import { ProviderConfigService } from '../../core/services/provider-config.service';
import { ToastService } from '../../core/services/toast.service';
import { AuthService } from '../../core/services/auth.service';
import { ProviderConfig, ProviderConfigUpdate } from '../../core/models';
import {
  zodValidator,
  validateForm,
} from '../../core/validators/zod-validators';
import { providerConfigSchema } from '../../core/validators/schemas';

@Component({
  selector: 'app-provider-config',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './provider-config.component.html',
  styleUrls: ['./provider-config.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProviderConfigComponent implements OnInit {
  private destroyRef = inject(DestroyRef);
  config: ProviderConfig | null = null;
  loading = true;
  saving = false;
  form!: FormGroup;
  showAdminPw = false;
  showSuperAdminPw = false;
  showPppoePw = false;
  get isAdmin(): boolean {
    return this.authService.isAdmin();
  }

  constructor(
    private fb: FormBuilder,
    private service: ProviderConfigService,
    private toast: ToastService,
    private authService: AuthService,
    private cdr: ChangeDetectorRef,
  ) {}

  ngOnInit(): void {
    this.form = this.fb.group({
      adminUserIndex: [
        1,
        [
          Validators.required,
          zodValidator(providerConfigSchema.shape.adminUserIndex),
        ],
      ],
      superAdminUserIndex: [
        2,
        [
          Validators.required,
          zodValidator(providerConfigSchema.shape.superAdminUserIndex),
        ],
      ],
      adminPassword: [
        null,
        zodValidator(providerConfigSchema.shape.adminPassword),
      ],
      superAdminPassword: [
        null,
        zodValidator(providerConfigSchema.shape.superAdminPassword),
      ],
      pppoePassword: [
        null,
        zodValidator(providerConfigSchema.shape.pppoePassword),
      ],
      autoWifiOptimizationEnabled: [false],
      periodicDiagnosticsEnabled: [false],
    });
    this.load();
  }

  private load(): void {
    this.loading = true;
    this.service
      .get()
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        catchError(() => {
          this.toast.error('Erro ao carregar configurações do provedor.');
          return of(null);
        }),
        finalize(() => {
          this.loading = false;
          this.cdr.markForCheck();
        }),
      )
      .subscribe((cfg) => {
        this.config = cfg;
        if (cfg)
          this.form.patchValue({
            adminUserIndex: cfg.adminUserIndex,
            superAdminUserIndex: cfg.superAdminUserIndex,
            autoWifiOptimizationEnabled: cfg.autoWifiOptimizationEnabled,
            periodicDiagnosticsEnabled: cfg.periodicDiagnosticsEnabled,
          });
        this.cdr.markForCheck();
      });
  }

  save(): void {
    if (this.form.invalid || this.saving || !this.isAdmin) return;
    this.saving = true;
    const v = this.form.value;
    const payload: ProviderConfigUpdate = {
      adminUserIndex: v.adminUserIndex,
      superAdminUserIndex: v.superAdminUserIndex,
      autoWifiOptimizationEnabled: v.autoWifiOptimizationEnabled,
      periodicDiagnosticsEnabled: v.periodicDiagnosticsEnabled,
    };
    if (v.adminPassword) payload.adminPassword = v.adminPassword;
    if (v.superAdminPassword) payload.superAdminPassword = v.superAdminPassword;
    if (v.pppoePassword) payload.pppoePassword = v.pppoePassword;

    const req$ = this.config?._id
      ? this.service.update(this.config._id, payload)
      : this.service.save(payload);
    req$
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        catchError((err) => {
          this.toast.error(
            err?.error?.message || 'Erro ao salvar configurações.',
          );
          return of(null);
        }),
        finalize(() => {
          this.saving = false;
          this.cdr.markForCheck();
        }),
      )
      .subscribe((result) => {
        if (result) {
          this.config = result;
          this.toast.success('Configurações salvas com sucesso.');
          this.form.patchValue({
            adminPassword: null,
            superAdminPassword: null,
            pppoePassword: null,
          });
        }
        this.cdr.markForCheck();
      });
  }
}
