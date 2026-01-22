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
    <div class="panel p-6">
      <h2 class="text-xl font-display mb-4">Nova Nota Fiscal</h2>
      
      <form (ngSubmit)="onSubmit()" #form="ngForm">
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Número da Nota</label>
          <input
            type="text"
            [(ngModel)]="formulario.numero"
            name="numero"
            required
            maxlength="50"
            class="input-field"
            placeholder="NFE-001"
          />
        </div>

        @if (erro()) {
          <div class="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg">
            <p class="text-sm text-red-800">{{ erro() }}</p>
          </div>
        }

        <div class="flex flex-wrap gap-3 mt-6">
          <button
            type="submit"
            [disabled]="!form.valid || salvando()"
            class="btn-primary disabled:opacity-60 disabled:cursor-not-allowed">
            {{ salvando() ? 'Salvando...' : 'Salvar' }}
          </button>
          <button
            type="button"
            (click)="cancelar.emit()"
            [disabled]="salvando()"
            class="btn-secondary disabled:cursor-not-allowed">
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
        const message = err instanceof Error
          ? err.message
          : err.error?.erro || err.error?.mensagem || 'Erro ao criar nota';
        this.erro.set(message);
      }
    });
  }
}
