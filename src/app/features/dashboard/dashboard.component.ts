// Caminho do arquivo: frontend/src/app/features/dashboard/dashboard.component.ts

import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { debounceTime } from 'rxjs/operators';
import { CpeService } from '../../core/services/cpe.service';
import { WebSocketService } from '../../core/services/websocket.service';
import { LoadingService } from '../../core/services/loading.service';
import { ToastService } from '../../core/services/toast.service';
import { ButtonComponent } from '../../core/components/button/button.component';
import { SkeletonComponent } from '../../core/components/skeleton/skeleton.component';
import { CpeDevice, PaginatedResponse } from '../../core/models';
import { Router } from '@angular/router';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule, ButtonComponent, SkeletonComponent],
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.scss'],
})
export class DashboardComponent implements OnInit, OnDestroy {
  // Lista de equipamentos e contadores
  cpes: CpeDevice[] = [];
  cpesOnlineCount: number = 0;
  criticalGponCount: number = 0;
  pendingTasksCount: number = 0;

  // Paginação
  currentPage: number = 1;
  itemsPerPage: number = 50;
  totalItems: number = 0;
  totalPages: number = 0;

  // Filtros da tabela
  searchQuery: string = '';
  filterStatus: 'all' | 'online' | 'offline' = 'all';
  private searchDebounce: any;

  // Modais
  isConfigModalOpen: boolean = false;
  selectedCpeForConfig: any = null;

  // Estado de carregamento
  loading: boolean = true;

  // CPEs que já receberam alerta de offline nesta sessão (evita spam)
  private alertedOfflineCpes = new Set<string>();
  private alertedGponCpes = new Set<string>();

  private wsSubscriptions = new Subscription();

  constructor(
    private cpeService: CpeService,
    private wsService: WebSocketService,
    private loadingService: LoadingService,
    private toastService: ToastService,
    private router: Router,
  ) {}

  ngOnInit(): void {
    this.loadInitialData();
    this.setupRealTimeUpdates();
    // Entra na sala global para receber eventos de qualquer CPE no dashboard
    this.wsService.subscribeToAllCpes();
  }

  ngOnDestroy(): void {
    this.wsSubscriptions.unsubscribe();
    this.wsService.unsubscribeFromAllCpes();
    if (this.searchDebounce) clearTimeout(this.searchDebounce);
  }

  /**
   * Busca a lista inicial de CPEs via API REST COM PAGINAÇÃO.
   * IMPLEMENTAÇÃO DE PAGINAÇÃO PARA SUPORTAR 6.000+ CPEs.
   * 
   * Carrega apenas a página atual de itens (padrão: 50 itens)
   * em vez de carregar todas as 6.000 CPEs de uma vez.
   */
  loadInitialData(): void {
    this.loading = true;

    // Constrói filtros com base nos controles da UI
    const filters: Record<string, any> = {};
    if (this.filterStatus === 'online')  filters['isOnline'] = true;
    if (this.filterStatus === 'offline') filters['isOnline'] = false;
    if (this.searchQuery.trim())         filters['search'] = this.searchQuery.trim();

    this.cpeService.getAllCpes(this.currentPage, this.itemsPerPage, filters).subscribe({
      next: (response) => {
        this.cpes = response.data;
        this.totalItems = response.pagination.total;
        this.totalPages = response.pagination.totalPages;
        this.calculateMetrics();
        this.loading = false;
      },
      error: (err) => {
        console.error('Erro ao buscar CPEs', err);
        this.toastService.error('Falha ao carregar lista de CPEs.');
        this.loading = false;
      },
    });
  }

  /**
   * Aplica filtros e volta para a primeira página.
   * Usa debounce para a busca por texto (evita requisição a cada tecla).
   */
  onFilterChange(): void {
    if (this.searchDebounce) clearTimeout(this.searchDebounce);
    this.searchDebounce = setTimeout(() => {
      this.currentPage = 1;
      this.loadInitialData();
    }, 400);
  }

  onStatusFilterChange(status: 'all' | 'online' | 'offline'): void {
    this.filterStatus = status;
    this.currentPage = 1;
    this.loadInitialData();
  }

  /**
   * Método chamado quando o usuário navega para outra página.
   * Atualiza a página atual e recarrega os dados.
   * 
   * @param page - Número da página para navegar
   */
  onPageChange(page: number): void {
    // Atualiza a página atual
    this.currentPage = page;
    
    // Recarrega os dados da nova página
    this.loadInitialData();
  }

  /**
   * Configura os ouvintes do WebSocket e monitoriza alterações de IP
   * IMPLEMENTAÇÃO DE DEBOUNCE PARA SUPORTAR 6.000+ CPEs
   * 
   * Com debounceTime, múltiplas atualizações rápidas são agrupadas
   * em uma única atualização, evitando re-renderização excessiva da UI.
   */
  setupRealTimeUpdates(): void {
    // cpe_updated: atualiza dados da CPE na tabela e detecta mudança de IP
    this.wsSubscriptions.add(
      this.wsService.onCpeUpdated().pipe(debounceTime(500)).subscribe(updatedCpe => {
        const index = this.cpes.findIndex(c => c.serialNumber === updatedCpe.serialNumber);
        if (index !== -1) {
          const ipAntigo = this.cpes[index].wanIp;
          const ipNovo = updatedCpe.wanIp;
          if (ipNovo && ipAntigo && ipAntigo !== ipNovo) {
            this.toastService.info(`CPE ${updatedCpe.serialNumber}: IP mudou de ${ipAntigo} para ${ipNovo}`);
          }
          this.cpes = this.cpes.map((c, i) => i === index ? { ...c, ...updatedCpe } : c);
          this.checkAlerts(this.cpes[index]);
        } else {
          this.cpes.unshift(updatedCpe);
        }
        this.calculateMetrics();
      })
    );

    // cpe_online: marca CPE como online e remove do set de alertas de offline
    this.wsSubscriptions.add(
      this.wsService.onCpeOnline().subscribe(onlineCpe => {
        const index = this.cpes.findIndex(c => c.serialNumber === onlineCpe.serialNumber);
        if (index !== -1) {
          this.cpes[index].isOnline = true;
          this.cpes = [...this.cpes];
          // Remove do set de alertados para que, se ficar offline novamente, o alerta reapareça
          this.alertedOfflineCpes.delete(onlineCpe.serialNumber);
          this.toastService.success(`CPE ${onlineCpe.serialNumber} está online.`);
        }
        this.calculateMetrics();
      })
    );
  }

  /**
   * Verifica condições críticas de uma CPE e dispara alertas via ToastService.
   * Evita spam: cada alerta é emitido no máximo uma vez por sessão.
   */
  private checkAlerts(cpe: CpeDevice): void {
    // Alerta de sinal GPON crítico (< -27 dBm)
    if (cpe.opticalRx !== undefined && cpe.opticalRx < -27 && !this.alertedGponCpes.has(cpe.serialNumber)) {
      this.alertedGponCpes.add(cpe.serialNumber);
      this.toastService.warning(
        `CPE ${cpe.serialNumber}: Sinal GPON crítico (${cpe.opticalRx} dBm). Verifique a fibra.`,
        7000
      );
    }

    // Alerta de CPE offline (lastInform > 30 min sem contato)
    if (!cpe.isOnline && cpe.lastInform && !this.alertedOfflineCpes.has(cpe.serialNumber)) {
      const minutesSince = (Date.now() - new Date(cpe.lastInform).getTime()) / 60000;
      if (minutesSince > 30) {
        this.alertedOfflineCpes.add(cpe.serialNumber);
        this.toastService.error(
          `CPE ${cpe.serialNumber} offline há mais de ${Math.round(minutesSince)} minutos.`,
          8000
        );
      }
    }
  }

  wakeUpDevice(serialNumber: string): void {
    this.cpeService.wakeUpCpe(serialNumber).subscribe({
      next: () => this.toastService.success(`Connection Request enviado para ${serialNumber}!`),
      error: () => this.toastService.error(`Falha ao acordar a CPE ${serialNumber}.`),
    });
  }

  /**
   * Atualiza os cards superiores (Top Metrics).
   */
  calculateMetrics(): void {
    this.cpesOnlineCount = this.cpes.filter((c) => c.isOnline).length;

    // Consideramos crítico um sinal GPON pior que -27 dBm
    this.criticalGponCount = this.cpes.filter(
      (c) => c.opticalRx && c.opticalRx < -27,
    ).length;

    // Conta as tarefas pendentes na fila
    this.pendingTasksCount = this.cpes.reduce((acc, cpe) => {
      return acc + (cpe.pendingTasks ? cpe.pendingTasks.length : 0);
    }, 0);
  }


  // Adicione esta função
  goToDetails(serialNumber: string): void {
    this.router.navigate(['/dashboard/cpe', serialNumber]);
  }

  // 2. Funções de controle do Modal (Adicione estas duas funções)
  openConfigModal(cpe: any): void {
    this.selectedCpeForConfig = cpe;
    this.isConfigModalOpen = true;
  }

  closeConfigModal(): void {
    this.isConfigModalOpen = false;
    this.selectedCpeForConfig = null;
  }

  goToDiagnostics(serialNumber: string): void {
    this.router.navigate(['/dashboard/cpe', serialNumber, 'diagnostics']);
  }

  /** Retorna o array de números de página para o paginador. */
  get pageNumbers(): number[] {
    return Array.from({ length: this.totalPages }, (_, i) => i + 1);
  }

  /** Último item da página atual (para o texto "X–Y de N"). */
  get pageEnd(): number {
    return Math.min(this.currentPage * this.itemsPerPage, this.totalItems);
  }
}
