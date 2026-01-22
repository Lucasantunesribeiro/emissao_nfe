import { Injectable, signal } from '@angular/core';

/**
 * Serviço para controle global de loading state
 * Usa signals (Angular 17+) para reatividade
 */
@Injectable({
  providedIn: 'root'
})
export class LoadingService {
  private activeRequests = signal(0);

  // Signal público readonly
  readonly isLoading = signal(false);

  show(): void {
    this.activeRequests.update(count => count + 1);
    this.isLoading.set(true);
  }

  hide(): void {
    this.activeRequests.update(count => Math.max(0, count - 1));

    // Só remove loading quando não há requisições ativas
    if (this.activeRequests() === 0) {
      this.isLoading.set(false);
    }
  }

  // Força reset (útil em caso de erro fatal)
  reset(): void {
    this.activeRequests.set(0);
    this.isLoading.set(false);
  }
}
