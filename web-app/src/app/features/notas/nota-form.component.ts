import { Component, Output, EventEmitter, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NotaFiscalService } from '../../core/services/nota-fiscal.service';
import { CriarNotaRequest } from '../../core/models/nota-fiscal.model';

@Component({
  selector: 'app-nota-form',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="bg-white border rounded-lg p-6 shadow-sm">
      <h2 class="text-xl font-semibold mb-4">Nova Nota Fiscal</h2>
      
      <form (ngSubmit)="onSubmit()" #form="ngForm">
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Número da Nota</label>
          <input
            type="text"
            [(ngModel)]="formulario.numero"
            name="numero"
            required
            maxlength="50"
            class="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            placeholder="NFE-001"
          />
        </div>

        @if (erro()) {
          <div class="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg">
            <p class="text-sm text-red-800">{{ erro() }}</p>
          </div>
        }

        <div class="flex gap-3 mt-6">
          <button
            type="submit"
            [disabled]="!form.valid || salvando()"
            class="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition">
            {{ salvando() ? 'Salvando...' : 'Salvar' }}
          </button>
          <button
            type="button"
            (click)="cancelar.emit()"
            [disabled]="salvando()"
            class="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 disabled:cursor-not-allowed transition">
            Cancelar
          </button>
        </div>
      </form>
    </div>
  `
})
export class NotaFormComponent {
  private readonly notaService = inject(NotaFiscalService);

  @Output() notaCriada = new EventEmitter<void>();
  @Output() cancelar = new EventEmitter<void>();

  formulario: CriarNotaRequest = { numero: '' };
  salvando = signal(false);
  erro = signal<string | null>(null);

  onSubmit(): void {
    this.erro.set(null);
    this.salvando.set(true);

    this.notaService.criarNota(this.formulario).subscribe({
      next: () => {
        this.salvando.set(false);
        this.notaCriada.emit();
        this.formulario.numero = '';
      },
      error: (err) => {
        this.salvando.set(false);
        this.erro.set(err.error?.erro || 'Erro ao criar nota');
      }
    });
  }
}
