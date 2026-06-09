import { Component, Input, OnInit, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CpeService } from '../../../../../../core/services/cpe.service';
import { ToastService } from '../../../../../../core/services/toast.service';
import { ButtonComponent } from '../../../../../../core/components/button/button.component';
import { SkeletonComponent } from '../../../../../../core/components/skeleton/skeleton.component';
import { CpeDevice } from '../../../../../../core/models';

@Component({
  selector: 'app-cpe-radio-tab',
  standalone: true,
  imports: [CommonModule, FormsModule, ButtonComponent, SkeletonComponent],
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

  radioForm = {
    enable2g: false,
    channel2g: '',
    bandwidth2g: '',
    power2g: '',
    enable5g: false,
    channel5g: '',
    bandwidth5g: '',
    power5g: ''
  };

  constructor(
    private cpeService: CpeService,
    private toastService: ToastService,
  ) {}

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

    this.radioForm.enable2g = this.parseBoolean(this.getParamValue('Device.WiFi.Radio.1.Enable')) ||
      this.parseBoolean(this.getParamValue('InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.Enable'));
    this.radioForm.channel2g = this.getParamValue('Device.WiFi.Radio.1.Channel') ||
      this.getParamValue('InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.Channel');
    this.radioForm.bandwidth2g = this.getParamValue('Device.WiFi.Radio.1.OperatingChannelBandwidth') ||
      this.getParamValue('InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.OperatingChannelBandwidth');
    this.radioForm.power2g = this.getParamValue('Device.WiFi.Radio.1.TransmitPower') ||
      this.getParamValue('InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.X_TP_RadioPower');

    this.radioForm.enable5g = this.parseBoolean(this.getParamValue('Device.WiFi.Radio.2.Enable')) ||
      this.parseBoolean(this.getParamValue('InternetGatewayDevice.LANDevice.1.WLANConfiguration.5.Enable'));
    this.radioForm.channel5g = this.getParamValue('Device.WiFi.Radio.2.Channel') ||
      this.getParamValue('InternetGatewayDevice.LANDevice.1.WLANConfiguration.5.Channel');
    this.radioForm.bandwidth5g = this.getParamValue('Device.WiFi.Radio.2.OperatingChannelBandwidth') ||
      this.getParamValue('InternetGatewayDevice.LANDevice.1.WLANConfiguration.5.OperatingChannelBandwidth');
    this.radioForm.power5g = this.getParamValue('Device.WiFi.Radio.2.TransmitPower') ||
      this.getParamValue('InternetGatewayDevice.LANDevice.1.WLANConfiguration.5.X_TP_RadioPower');
  }

  saveRadioConfig(): void {
    if (!this.serialNumber) {
      this.toastService.error('Serial da CPE ausente.');
      return;
    }

    // Validação Zod: canal 2.4G deve estar no range 1-13 (ou Auto)
    const ch2g = this.radioForm.channel2g;
    if (ch2g && ch2g !== 'Auto' && (Number(ch2g) < 1 || Number(ch2g) > 13)) {
      this.toastService.error('Canal 2.4GHz deve estar entre 1 e 13.');
      return;
    }
    // Validação Zod: canal 5G deve estar no range 36-165 (ou Auto)
    const ch5g = this.radioForm.channel5g;
    if (ch5g && ch5g !== 'Auto' && (Number(ch5g) < 36 || Number(ch5g) > 165)) {
      this.toastService.error('Canal 5GHz deve estar entre 36 e 165.');
      return;
    }

    const payload: any[] = [];
    const addParam = (name: string, value: string, type: string) => {
      if (value !== undefined && value !== null && value !== '') {
        payload.push({ name, value, type });
      }
    };

    addParam('Device.WiFi.Radio.1.Enable', String(this.radioForm.enable2g), 'xsd:boolean');
    addParam('Device.WiFi.Radio.1.Channel', String(this.radioForm.channel2g), 'xsd:unsignedInt');
    addParam('Device.WiFi.Radio.1.OperatingChannelBandwidth', String(this.radioForm.bandwidth2g), 'xsd:string');
    addParam('Device.WiFi.Radio.1.TransmitPower', String(this.radioForm.power2g), 'xsd:unsignedInt');
    addParam('Device.WiFi.Radio.2.Enable', String(this.radioForm.enable5g), 'xsd:boolean');
    addParam('Device.WiFi.Radio.2.Channel', String(this.radioForm.channel5g), 'xsd:unsignedInt');
    addParam('Device.WiFi.Radio.2.OperatingChannelBandwidth', String(this.radioForm.bandwidth5g), 'xsd:string');
    addParam('Device.WiFi.Radio.2.TransmitPower', String(this.radioForm.power5g), 'xsd:unsignedInt');

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
