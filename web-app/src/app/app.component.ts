import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { LoadingComponent } from './shared/components/loading/loading.component';
import { environment } from '../environments/environment';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, RouterLink, RouterLinkActive, RouterOutlet, LoadingComponent],
  template: `
    <div class="app-shell">
      <div class="absolute inset-0 overflow-hidden">
        <div class="app-orb h-72 w-72 bg-orange-200 -top-24 -left-10 animate-float"></div>
        <div class="app-orb h-80 w-80 bg-sky-200 top-10 -right-24 animate-float" style="animation-delay: 1.5s;"></div>
        <div class="app-orb h-56 w-56 bg-emerald-100 bottom-0 left-1/3 animate-float" style="animation-delay: 0.8s;"></div>
      </div>

      <div class="relative z-10">
        <header class="pt-6">
          <div class="container mx-auto px-4">
            <div class="glass-nav rounded-3xl px-6 py-4 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div class="flex items-center gap-4">
                <div class="h-12 w-12 rounded-2xl bg-gradient-to-br from-orange-400 via-orange-500 to-amber-400 text-white flex items-center justify-center font-semibold text-xs tracking-tight uppercase">
                  SENF
                </div>
                <div>
                  <p class="text-xs uppercase tracking-[0.2em] text-gray-500">Sistema de Emissão de NFe</p>
                  <h1 class="text-2xl font-display text-gray-900">Estúdio Fiscal</h1>
                </div>
              </div>
              <nav class="flex flex-wrap gap-2">
                <a routerLink="/produtos"
                   routerLinkActive="nav-link-active"
                   [routerLinkActiveOptions]="{exact: false}"
                   class="nav-link">
                  Produtos
                </a>
                <a routerLink="/notas"
                   routerLinkActive="nav-link-active"
                   [routerLinkActiveOptions]="{exact: false}"
                   class="nav-link">
                  Notas Fiscais
                </a>
              </nav>
              <div class="hidden lg:flex items-center gap-2">
                <span class="tag bg-orange-100 text-orange-800">Ambiente {{ environmentName }}</span>
                <span class="tag bg-emerald-100 text-emerald-800">EventBridge ativo</span>
              </div>
            </div>
          </div>
        </header>

        <section class="container mx-auto px-4 mt-6">
          <div class="hero-card p-6 md:p-10 animate-fade-up">
            <div class="grid gap-6 lg:grid-cols-[1.2fr_0.8fr] lg:items-center">
              <div class="space-y-4">
                <span class="tag bg-sky-100 text-sky-800">Operacao serverless</span>
                <h2 class="text-4xl md:text-5xl font-display text-gray-900">
                  Sistema de Emissão de Notas Fiscais com estoque orquestrado e visao em tempo real.
                </h2>
                <p class="text-base text-gray-600 max-w-xl">
                  Gerencie produtos, acompanhe o ciclo completo da nota e monitore o processamento de impressao
                  com respostas claras e confiaveis.
                </p>
                <div class="flex flex-wrap gap-3">
                  <a routerLink="/notas" class="btn-primary">Criar nota fiscal</a>
                  <a routerLink="/produtos" class="btn-secondary">Ver estoque</a>
                </div>
              </div>
              <div class="grid gap-4">
                <div class="panel-soft p-4">
                  <p class="text-sm text-gray-500">Pipeline</p>
                  <h3 class="text-xl font-display text-gray-900">Reserva, fechamento e impressao</h3>
                  <p class="text-sm text-gray-600 mt-2">Eventos sincronizados via outbox e EventBridge.</p>
                </div>
                <div class="panel-soft p-4">
                  <p class="text-sm text-gray-500">Observabilidade</p>
                  <h3 class="text-xl font-display text-gray-900">Logs estruturados prontos para CloudWatch</h3>
                  <p class="text-sm text-gray-600 mt-2">Saidas JSON padronizadas para auditoria.</p>
                </div>
              </div>
            </div>
          </div>
        </section>

        <main class="container mx-auto px-4 py-10">
          <router-outlet></router-outlet>
        </main>

        <footer class="container mx-auto px-4 pb-10 text-sm text-gray-500 flex flex-wrap items-center justify-between gap-2">
          <span>Sistema de Emissão de Notas Fiscais - Operacao segura e resiliente.</span>
          <span>API Gateway + Lambda + Postgres</span>
        </footer>
      </div>

      <!-- Loading overlay global -->
      <app-loading />
    </div>
  `
})
export class AppComponent {
  readonly environmentName = environment.production ? 'Prod' : 'Dev';
}
