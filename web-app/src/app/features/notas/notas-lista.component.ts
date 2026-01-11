import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { NotaFiscalService } from '../../core/services/nota-fiscal.service';
import { NotaFiscal } from '../../core/models/nota-fiscal.model';
import { NotaFormComponent } from './nota-form.component';

@Component({
  selector: 'app-notas-lista',
  standalone: true,
  imports: [CommonModule, RouterLink, NotaFormComponent],
  template: `
    <div class="container mx-auto px-4 py-8">
      <div class="flex justify-between items-center mb-6">
        <h1 class="text-3xl font-bold text-gray-800">Notas Fiscais</h1>
        <button
          (click)="mostrarFormulario.set(!mostrarFormulario())"
          class="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition">
          {{ mostrarFormulario() ? 'Cancelar' : '+ Nova Nota' }}
        </button>
      </div>

      @if (mostrarFormulario()) {
        <app-nota-form
          (notaCriada)="onNotaCriada()"
          (cancelar)="mostrarFormulario.set(false)"
          class="block mb-6">
        </app-nota-form>
      }

      <div class="flex gap-2 mb-4">
        <button
          (click)="filtrarPorStatus(null)"
          [class.bg-blue-600]="filtroStatus() === null"
          [class.text-white]="filtroStatus() === null"
          [class.bg-gray-200]="filtroStatus() !== null"
          class="px-3 py-1 rounded-lg text-sm transition">
          Todas
        </button>
        <button
          (click)="filtrarPorStatus('ABERTA')"
          [class.bg-blue-600]="filtroStatus() === 'ABERTA'"
          [class.text-white]="filtroStatus() === 'ABERTA'"
          [class.bg-gray-200]="filtroStatus() !== 'ABERTA'"
          class="px-3 py-1 rounded-lg text-sm transition">
          Abertas
        </button>
        <button
          (click)="filtrarPorStatus('FECHADA')"
          [class.bg-blue-600]="filtroStatus() === 'FECHADA'"
          [class.text-white]="filtroStatus() === 'FECHADA'"
          [class.bg-gray-200]="filtroStatus() !== 'FECHADA'"
          class="px-3 py-1 rounded-lg text-sm transition">
          Fechadas
        </button>
      </div>

      @if (carregando()) {
        <div class="text-center py-8">
          <div class="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          <p class="mt-2 text-gray-600">Carregando notas...</p>
        </div>
      }

      @if (!carregando() && notas().length === 0) {
        <div class="text-center py-12 bg-gray-50 rounded-lg">
          <p class="text-gray-500">Nenhuma nota encontrada</p>
        </div>
      }

      @if (!carregando() && notas().length > 0) {
        <div class="grid gap-4">
          @for (nota of notas(); track nota.id) {
            <a [routerLink]="['/notas', nota.id]"
               class="block bg-white border rounded-lg p-4 shadow-sm hover:shadow-md transition">
              <div class="flex justify-between items-start">
                <div class="flex-1">
                  <div class="flex items-center gap-3">
                    <h3 class="text-lg font-semibold text-gray-800">{{ nota.numero }}</h3>
                    <span class="px-2 py-1 text-xs rounded-full"
                          [class.bg-yellow-100]="nota.status === 'ABERTA'"
                          [class.text-yellow-800]="nota.status === 'ABERTA'"
                          [class.bg-green-100]="nota.status === 'FECHADA'"
                          [class.text-green-800]="nota.status === 'FECHADA'">
                      {{ nota.status }}
                    </span>
                  </div>
                  <div class="flex items-center gap-4 mt-2 text-sm text-gray-600">
                    <span>Criada em: {{ nota.dataCriacao | date:'dd/MM/yyyy HH:mm' }}</span>
                    @if (nota.dataFechada) {
                      <span>Fechada em: {{ nota.dataFechada | date:'dd/MM/yyyy HH:mm' }}</span>
                    }
                  </div>
                </div>
                <svg class="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/>
                </svg>
              </div>
            </a>
          }
        </div>
      }
    </div>
  `
})
export class NotasListaComponent implements OnInit {
  private readonly notaService = inject(NotaFiscalService);

  notas = signal<NotaFiscal[]>([]);
  carregando = signal(false);
  mostrarFormulario = signal(false);
  filtroStatus = signal<string | null>(null);

  ngOnInit(): void {
    this.carregarNotas();
  }

  carregarNotas(): void {
    this.carregando.set(true);
    const status = this.filtroStatus();
    
    this.notaService.listarNotas(status || undefined).subscribe({
      next: (notas) => {
        this.notas.set(notas);
        this.carregando.set(false);
      },
      error: (err) => {
        console.error('Erro ao carregar notas:', err);
        this.carregando.set(false);
      }
    });
  }

  filtrarPorStatus(status: string | null): void {
    this.filtroStatus.set(status);
    this.carregarNotas();
  }

  onNotaCriada(): void {
    this.mostrarFormulario.set(false);
    this.carregarNotas();
  }
}
