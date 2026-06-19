import { Component, Input, OnInit, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormGroup, AbstractControl, ValidationErrors } from '@angular/forms';
import { CpeService } from '../../../../../../core/services/cpe.service';
import { ToastService } from '../../../../../../core/services/toast.service';
import { ButtonComponent } from '../../../../../../core/components/button/button.component';
import { SkeletonComponent } from '../../../../../../core/components/skeleton/skeleton.component';
import { CpeDevice } from '../../../../../../core/models';

@Component({
  selector: 'app-cpe-radio-tab',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, ButtonComponent, SkeletonComponent],
  templateUrl: './cpe-radio-tab.component.html',
  styleUrls: ['./cpe-radio-tab.component.scss']
})
export class CpeRadioTabComponent implements OnInit, OnChanges {
  @Input() cpe: CpeDevice | null = null;
  @Input() serialNumber: string = '';

  isSaving = false;
  feedbackMessage = '';

  channelOptions2g = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];
  channelOptions5g = [36, 40, 44, 48, 149, 153, 157, 161, 165];
  bandwidthOptions2g = ['20', '40'];
  bandwidthOptions5g = ['20', '40', '80', '160'];
  powerOptions = ['5', '10', '15', '20', '23', '26', '30'];

  radioForm!: FormGroup;

  constructor(
    private fb: FormBuilder,
    private cpeService: CpeService,
    private toastService: ToastService,
  ) {
    this.initForm();
  }

  private initForm(): void {
    this.radioForm = this.fb.group({
      enable2g: [false],
      channel2g: ['', [this.channelValidator(1, 13)]],
      bandwidth2g: [''],
      power2g: [''],
      enable5g: [false],
      channel5g: ['', [this.channelValidator(36, 165)]],
      bandwidth5g: [''],
      power5g: ['']
    });
  }

  private channelValidator(min: number, max: number) {
    return (control: AbstractControl): ValidationErrors | null => {
      const val = control.value;
      if (!val || val === 'Auto') return null; // Permite a string 'Auto' e vazios
      const num = Number(val);
      if (isNaN(num) || num < min || num > max) {
        return { invalidChannel: true };
      }
      return null;
    };
  }

  ngOnInit(): void {
    this.populateRadioForm();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['cpe'] && !changes['cpe'].firstChange) {
      this.populateRadioForm();
    }
  }

  private getParamValue(path: string): string {
    if (!this.cpe || !Array.isArray(this.cpe.parameters)) {
      return '';
    }
    const param = this.cpe.parameters.find((p: any) => p.name === path || p.name.endsWith(path));
    return param ? String(param.value) : '';
  }

  private parseBoolean(value: any): boolean {
    if (value === undefined || value === null || value === '') return false;
    const str = String(value).trim().toLowerCase();
    return str === '1' || str === 'true' || str === 'enabled';
  }

  populateRadioForm(): void {
    if (!this.cpe) return;

    // Injeta os dados da API de forma segura e limpa dentro do formulário
    this.radioForm.patchValue({
      enable2g: this.parseBoolean(this.getParamValue('Device.WiFi.Radio.1.Enable')) ||
        this.parseBoolean(this.getParamValue('InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.Enable')),
      channel2g: this.getParamValue('Device.WiFi.Radio.1.Channel') ||
        this.getParamValue('InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.Channel'),
      bandwidth2g: this.getParamValue('Device.WiFi.Radio.1.OperatingChannelBandwidth') ||
        this.getParamValue('InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.OperatingChannelBandwidth'),
      power2g: this.getParamValue('Device.WiFi.Radio.1.TransmitPower') ||
        this.getParamValue('InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.X_TP_RadioPower'),
      enable5g: this.parseBoolean(this.getParamValue('Device.WiFi.Radio.2.Enable')) ||
        this.parseBoolean(this.getParamValue('InternetGatewayDevice.LANDevice.1.WLANConfiguration.5.Enable')),
      channel5g: this.getParamValue('Device.WiFi.Radio.2.Channel') ||
        this.getParamValue('InternetGatewayDevice.LANDevice.1.WLANConfiguration.5.Channel'),
      bandwidth5g: this.getParamValue('Device.WiFi.Radio.2.OperatingChannelBandwidth') ||
        this.getParamValue('InternetGatewayDevice.LANDevice.1.WLANConfiguration.5.OperatingChannelBandwidth'),
      power5g: this.getParamValue('Device.WiFi.Radio.2.TransmitPower') ||
        this.getParamValue('InternetGatewayDevice.LANDevice.1.WLANConfiguration.5.X_TP_RadioPower')
    });
  }

  saveRadioConfig(): void {
    if (!this.serialNumber) {
      this.toastService.error('Serial da CPE ausente.');
      return;
    }

    // O Angular valida tudo automaticamente, inclusive desativando o botão "Salvar" no HTML se configurado.
    if (this.radioForm.invalid) {
      this.toastService.error('Verifique os canais selecionados. 2.4GHz (1-13) e 5GHz (36-165).');
      return;
    }

    const vals = this.radioForm.value; // Extrai o objeto limpo

    const payload: any[] = [];
    const addParam = (name: string, value: string, type: string) => {
      if (value !== undefined && value !== null && value !== '') {
        payload.push({ name, value, type });
      }
    };

    addParam('Device.WiFi.Radio.1.Enable', String(vals.enable2g), 'xsd:boolean');
    addParam('Device.WiFi.Radio.1.Channel', String(vals.channel2g), 'xsd:unsignedInt');
    addParam('Device.WiFi.Radio.1.OperatingChannelBandwidth', String(vals.bandwidth2g), 'xsd:string');
    addParam('Device.WiFi.Radio.1.TransmitPower', String(vals.power2g), 'xsd:unsignedInt');
    addParam('Device.WiFi.Radio.2.Enable', String(vals.enable5g), 'xsd:boolean');
    addParam('Device.WiFi.Radio.2.Channel', String(vals.channel5g), 'xsd:unsignedInt');
    addParam('Device.WiFi.Radio.2.OperatingChannelBandwidth', String(vals.bandwidth5g), 'xsd:string');
    addParam('Device.WiFi.Radio.2.TransmitPower', String(vals.power5g), 'xsd:unsignedInt');

    if (payload.length === 0) {
      this.toastService.warning('Nenhum ajuste de rádio foi definido para enviar.');
      return;
    }

    this.isSaving = true;
    this.feedbackMessage = '';

    this.cpeService.updateRadioConfig(this.serialNumber, payload).subscribe({
      next: () => {
        this.toastService.success('Configurações de rádio enviadas com sucesso.');
        this.isSaving = false;
      },
      error: () => {
        this.toastService.error('Falha ao enviar configurações de rádio. Tente novamente.');
        this.isSaving = false;
      }
    });
  }
}
