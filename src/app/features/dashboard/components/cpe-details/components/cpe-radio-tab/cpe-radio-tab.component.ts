import { Component, Input, OnInit, OnChanges, SimpleChanges, ChangeDetectionStrategy, ChangeDetectorRef, DestroyRef, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormGroup } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CpeService } from '../../../../../../core/services/cpe.service';
import { ToastService } from '../../../../../../core/services/toast.service';
import { ButtonComponent } from '../../../../../../core/components/button/button.component';
import { SkeletonComponent } from '../../../../../../core/components/skeleton/skeleton.component';
import { TabLoaderComponent } from '../../../../../../core/components/tab-loader/tab-loader.component';
import { CpeDevice } from '../../../../../../core/models';
import { RadioBandCardComponent } from './radio-band-card/radio-band-card.component';
import { RadioParameterBuilderService } from './radio-parameter-builder.service';
import { mapCpeToRadioConfigs } from './radio-tr069-mapper';
import { channelValidator, powerValidator, bandwidthValidator } from './radio-validators';
import { RadioBandConfig, WifiBand } from './radio-constants';

/**
 * Aba de configuração de Rádio Wi-Fi (2.4GHz e 5GHz).
 *
 * Arquitetura modular (segue padrão cpe-wifi-tab):
 *   - radio-constants.ts         → valores centralizados
 *   - radio-path-builder.ts      → paths TR-181/TR-098
 *   - radio-field-registry.ts    → registry tabular de campos
 *   - radio-validators.ts        → validators de canal/potência/bandwidth
 *   - radio-tr069-mapper.ts      → CPE data → RadioBandConfig
 *   - radio-parameter-builder    → RadioBandConfig → payload SPV
 *   - radio-band-card/           → subcomponente dumb por banda
 *
 * Fonte de dados: cpe.wifi2g / cpe.wifi5g (banco) + parametersCache (fallback).
 * Detecção TR-181/TR-098 automática via mapper.
 */
@Component({
  selector: 'app-cpe-radio-tab',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, ReactiveFormsModule, ButtonComponent, SkeletonComponent, TabLoaderComponent, RadioBandCardComponent],
  templateUrl: './cpe-radio-tab.component.html',
  styleUrls: ['./cpe-radio-tab.component.scss'],
})
export class CpeRadioTabComponent implements OnInit, OnChanges {
  @Input() cpe: CpeDevice | null = null;
  @Input() serialNumber: string = '';

  // Estado de UI
  isSaving = false;
  isSavingBand: WifiBand | null = null; // null = salvando tudo | '2.4GHz' | '5GHz' = salvando banda específica
  saveError = false;
  hasRadioData = false;
  isTR181 = true;

  // Formulários por banda (separados para salvar independentemente)
  radio2gForm!: FormGroup;
  radio5gForm!: FormGroup;

  // Valores suportados de potência por banda — expostos ao template para bind no band-card
  txPowerSupported2g: string | undefined = undefined;
  txPowerSupported5g: string | undefined = undefined;

  // Configurações mapeadas da CPE
  private config2g: RadioBandConfig | null = null;
  private config5g: RadioBandConfig | null = null;

  private readonly destroyRef = inject(DestroyRef);

  constructor(
    private fb: FormBuilder,
    private cpeService: CpeService,
    private toastService: ToastService,
    private cdr: ChangeDetectorRef,
    private paramBuilder: RadioParameterBuilderService,
  ) {
    this.initForms();
  }

  /** Inicializa os FormGroups de ambas as bandas com validators. */
  private initForms(): void {
    // TR-181 (TP-Link) é o default mais comum; Intelbras é detectado no populate.
    this.radio2gForm = this.fb.group({
      enable:      [false],
      channel:     ['Auto', [channelValidator('2.4GHz')]],
      bandwidth:   ['', [bandwidthValidator('2.4GHz')]],
      power:       ['', [powerValidator()]],
      // Campos de path (preenchidos pelo mapper)
      enablePath:      [''],
      channelPath:     [''],
      bandwidthPath:   [''],
      powerPath:       [''],
      autoChannelPath: [''],
      // Metadados
      isTR181: [true],
      status:  ['Unknown'],
    });

    this.radio5gForm = this.fb.group({
      enable:      [false],
      channel:     ['Auto', [channelValidator('5GHz')]],
      bandwidth:   ['', [bandwidthValidator('5GHz')]],
      power:       ['', [powerValidator()]],
      enablePath:      [''],
      channelPath:     [''],
      bandwidthPath:   [''],
      powerPath:       [''],
      autoChannelPath: [''],
      isTR181: [true],
      status:  ['Unknown'],
    });
  }

  ngOnInit(): void {
    this.populateForms();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['cpe'] && !changes['cpe'].firstChange) {
      this.populateForms();
    }
  }

  /** Se a CPE suporta banda 5GHz (tem dados de wifi5g). */
  get has5GHz(): boolean {
    return this.config5g !== null;
  }

  /** Se há mudanças não salvas em qualquer banda (botão "Salvar Tudo"). */
  get hasAnyChanges(): boolean {
    return this.radio2gForm.dirty || (this.has5GHz && this.radio5gForm.dirty);
  }

  /**
   * Popula os formulários a partir dos dados da CPE.
   * Usa o mapper para converter CPE data → RadioBandConfig → FormGroup values.
   */
  private populateForms(): void {
    if (!this.cpe) {
      this.hasRadioData = false;
      this.cdr.markForCheck();
      return;
    }

    const { configs, isTR181 } = mapCpeToRadioConfigs(this.cpe);
    this.isTR181 = isTR181;
    this.config2g = configs[0];
    this.config5g = configs[1];

    // Expõe txPowerSupported para bind no template — null quando ainda não coletado via GPN
    this.txPowerSupported2g = this.config2g?.txPowerSupported;
    this.txPowerSupported5g = this.config5g?.txPowerSupported;

    // Se não há config 2.4GHz, CPE não tem dados de rádio
    this.hasRadioData = this.config2g !== null;

    if (this.config2g) {
      this.patchForm(this.radio2gForm, this.config2g, isTR181);
    }

    if (this.config5g) {
      this.patchForm(this.radio5gForm, this.config5g, isTR181);
    }

    // Reset estado dirty — dados vieram do banco, não há mudanças não salvas
    this.radio2gForm.markAsPristine();
    if (this.has5GHz) this.radio5gForm.markAsPristine();

    this.cdr.markForCheck();
  }

  /** Descarta o estado de erro e volta ao formulário. */
  retrySave(): void {
    this.saveError = false;
    this.cdr.markForCheck();
  }

  /** Aplica os valores do RadioBandConfig no FormGroup. */
  private patchForm(form: FormGroup, config: RadioBandConfig, isTR181: boolean): void {
    const powerCtrl = form.get('power');
    if (powerCtrl) {
      powerCtrl.clearValidators();
      powerCtrl.setValidators([powerValidator()]);
      powerCtrl.updateValueAndValidity({ emitEvent: false });
    }

    form.patchValue({
      enable:      config.enable,
      channel:     config.channel || 'Auto',
      bandwidth:   config.bandwidth,
      power:       config.power,
      enablePath:      config.enablePath,
      channelPath:     config.channelPath,
      bandwidthPath:   config.bandwidthPath,
      powerPath:       config.powerPath,
      autoChannelPath: config.autoChannelPath,
      isTR181: isTR181,
      status: config.status,
    }, { emitEvent: false });
  }

  /**
   * Salva a configuração de uma banda específica.
   * @param band '2.4GHz' | '5GHz'
   */
  saveBandConfig(band: WifiBand): void {
    if (!this.serialNumber) {
      this.toastService.error('Serial da CPE ausente.');
      return;
    }

    const form = band === '2.4GHz' ? this.radio2gForm : this.radio5gForm;
    if (!form || form.invalid) {
      this.toastService.error(`Verifique os campos do rádio ${band}.`);
      return;
    }

    const result = this.paramBuilder.buildBandParams(form);
    if (!result.success || result.params.length === 0) {
      this.toastService.warning(result.error || `Nenhum parâmetro de rádio ${band} para enviar.`);
      return;
    }

    this.isSaving = true;
    this.isSavingBand = band;
    this.saveError = false;
    this.cdr.markForCheck();

    this.cpeService.updateRadioConfig(this.serialNumber, result.params)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toastService.success(`Configuração de rádio ${band} enviada com sucesso.`);
          form.markAsPristine(); // Reset estado dirty — botão "Salvar" desabilita novamente
          this.isSaving = false;
          this.isSavingBand = null;
          this.cdr.markForCheck();
        },
        error: (err) => {
          const msg = err?.message?.includes('timeout')
            ? 'A CPE não respondeu a tempo. Verifique se está online.'
            : `Falha ao enviar configuração de rádio ${band}.`;
          this.toastService.error(msg);
          this.isSaving = false;
          this.isSavingBand = null;
          this.saveError = true;
          this.cdr.markForCheck();
        },
      });
  }

  /**
   * Salva a configuração de ambas as bandas simultaneamente.
   * Mescla os parâmetros de 2.4GHz e 5GHz em um único payload SPV.
   */
  saveAllRadioConfig(): void {
    if (!this.serialNumber) {
      this.toastService.error('Serial da CPE ausente.');
      return;
    }

    if (this.radio2gForm.invalid || (this.has5GHz && this.radio5gForm.invalid)) {
      this.toastService.error('Verifique os campos de rádio antes de salvar.');
      return;
    }

    const result = this.paramBuilder.buildAllParams(
      this.radio2gForm,
      this.has5GHz ? this.radio5gForm : null,
    );

    if (!result.success || result.params.length === 0) {
      this.toastService.warning(result.error || 'Nenhum parâmetro de rádio para enviar.');
      return;
    }

    this.isSaving = true;
    this.isSavingBand = null;
    this.saveError = false;
    this.cdr.markForCheck();

    this.cpeService.updateRadioConfig(this.serialNumber, result.params)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toastService.success('Configurações de rádio enviadas com sucesso.');
          this.radio2gForm.markAsPristine();
          if (this.has5GHz) this.radio5gForm.markAsPristine();
          this.isSaving = false;
          this.isSavingBand = null;
          this.cdr.markForCheck();
        },
        error: (err) => {
          const msg = err?.message?.includes('timeout')
            ? 'A CPE não respondeu a tempo. Verifique se está online.'
            : 'Falha ao enviar configurações de rádio. Tente novamente.';
          this.toastService.error(msg);
          this.isSaving = false;
          this.isSavingBand = null;
          this.saveError = true;
          this.cdr.markForCheck();
        },
      });
  }
}
