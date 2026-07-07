import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ScrollingModule } from '@angular/cdk/scrolling';
import { CpeService } from '../../core/services/cpe.service';

@Component({
  selector: 'app-cpe-list',
  standalone: true,
  imports: [CommonModule, ScrollingModule],
  template: `
    <div class="cpe-list-container">
      <h2>Lista de CPEs (5.000+)</h2>
      <cdk-virtual-scroll-viewport itemSize="50" class="viewport">
        <div *cdkVirtualFor="let cpe of cpes" class="cpe-item">
          <span>{{ cpe.serialNumber }}</span>
          <span>{{ cpe.status }}</span>
          <span>{{ cpe.lastInform | date:'short' }}</span>
        </div>
      </cdk-virtual-scroll-viewport>
    </div>
  `,
  styles: [`
    .cpe-list-container { height: 100vh; padding: 20px; }
    .viewport { height: calc(100vh - 100px); overflow: auto; }
    .cpe-item { display: flex; justify-content: space-between; padding: 10px; border-bottom: 1px solid #ccc; height: 50px; }
  `]
})
export class CpeListComponent implements OnInit {
  cpes: any[] = [];

  constructor(private cpeService: CpeService) {}

  ngOnInit() {
    this.cpeService.getAllCpes().subscribe(response => {
      this.cpes = response.data;
    });
  }
}
