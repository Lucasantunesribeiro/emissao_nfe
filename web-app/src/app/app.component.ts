import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { LoadingComponent } from './shared/components/loading/loading.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, RouterLink, RouterLinkActive, RouterOutlet, LoadingComponent],
  template: `
    <div class="min-h-screen bg-gray-50">
      <nav class="bg-white shadow-md">
        <div class="container mx-auto px-4">
          <div class="flex items-center justify-between h-16">
            <div class="flex items-center gap-8">
              <h1 class="text-xl font-bold text-gray-800">Sistema NFe - Viasoft Korp</h1>
              <div class="flex gap-4">
                <a routerLink="/produtos"
                   routerLinkActive="text-blue-600 border-b-2 border-blue-600"
                   [routerLinkActiveOptions]="{exact: false}"
                   class="px-3 py-2 text-gray-700 hover:text-blue-600 transition">
                  Produtos
                </a>
                <a routerLink="/notas"
                   routerLinkActive="text-blue-600 border-b-2 border-blue-600"
                   [routerLinkActiveOptions]="{exact: false}"
                   class="px-3 py-2 text-gray-700 hover:text-blue-600 transition">
                  Notas Fiscais
                </a>
              </div>
            </div>
          </div>
        </div>
      </nav>

      <main>
        <router-outlet></router-outlet>
      </main>

      <!-- Loading overlay global -->
      <app-loading />
    </div>
  `
})
export class AppComponent {}
