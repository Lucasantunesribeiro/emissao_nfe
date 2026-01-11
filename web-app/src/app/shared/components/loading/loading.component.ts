import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LoadingService } from '../../../core/services/loading.service';

@Component({
  selector: 'app-loading',
  standalone: true,
  imports: [CommonModule],
  template: `
    @if (loadingService.isLoading()) {
      <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
        <div class="flex flex-col items-center gap-4 rounded-lg bg-white p-8 shadow-2xl">
          <div class="h-12 w-12 animate-spin rounded-full border-4 border-gray-200 border-t-blue-600"></div>
          <p class="text-sm font-medium text-gray-700">Processando...</p>
        </div>
      </div>
    }
  `,
  styles: [`
    :host {
      display: contents;
    }
  `]
})
export class LoadingComponent {
  readonly loadingService = inject(LoadingService);
}
