import { Component, Output, EventEmitter, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ProdutoService } from '../../core/services/produto.service';
import { CriarProdutoRequest } from '../../core/models/produto.model';

@Component({
  selector: 'app-produto-form',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="panel p-6">
      <h2 class="text-xl font-display mb-4">Novo Produto</h2>
      
      <form (ngSubmit)="onSubmit()" #form="ngForm">
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">SKU</label>
            <input
              type="text"
              [(ngModel)]="formulario.sku"
              name="sku"
              required
              maxlength="50"
              class="input-field"
              placeholder="PROD-001"
            />
          </div>

          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Nome</label>
            <input
              type="text"
              [(ngModel)]="formulario.nome"
              name="nome"
              required
              maxlength="200"
              class="input-field"
              placeholder="Produto Demo"
            />
          </div>

          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Saldo Inicial</label>
            <input
              type="number"
              [(ngModel)]="formulario.saldo"
              name="saldo"
              required
              min="0"
              class="input-field"
              placeholder="100"
            />
          </div>
        </div>

        @if (erro()) {
          <div class="mt-4 p-4 bg-red-50 border-l-4 border-red-500 rounded-lg flex items-start gap-3 animate-fade-in">
            <svg class="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
              <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clip-rule="evenodd"/>
            </svg>
            <div>
              <p class="text-sm font-medium text-red-800">Erro ao criar produto</p>
              <p class="text-sm text-red-700 mt-1">{{ erro() }}</p>
            </div>
          </div>
        }

        @if (sucesso()) {
          <div class="mt-4 p-4 bg-green-50 border-l-4 border-green-500 rounded-lg flex items-start gap-3 animate-fade-in">
            <svg class="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
              <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"/>
            </svg>
            <div>
              <p class="text-sm font-medium text-green-800">Produto criado com sucesso!</p>
            </div>
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
export class ProdutoFormComponent {
  private readonly produtoService = inject(ProdutoService);

  @Output() produtoCriado = new EventEmitter<void>();
  @Output() cancelar = new EventEmitter<void>();

  formulario: CriarProdutoRequest = {
    sku: '',
    nome: '',
    saldo: 0
  };

  salvando = signal(false);
  erro = signal<string | null>(null);
  sucesso = signal(false);

  onSubmit(): void {
    this.erro.set(null);
    this.sucesso.set(false);
    this.salvando.set(true);

    this.produtoService.criarProduto(this.formulario).subscribe({
      next: () => {
        this.salvando.set(false);
        this.sucesso.set(true);
        this.limparFormulario();

        // Ocultar mensagem de sucesso após 3 segundos e emitir evento
        setTimeout(() => {
          this.sucesso.set(false);
          this.produtoCriado.emit();
        }, 2000);
      },
      error: (err) => {
        this.salvando.set(false);
        console.error('Erro completo:', err);

        // Extrair mensagem do erro
        let message = 'Erro ao criar produto';

        if (err instanceof Error) {
          message = err.message;
        } else if (err.error) {
          // Tentar extrair mensagem do backend
          message = err.error.erro || err.error.mensagem || err.error.message || message;
        }

        this.erro.set(message);
      }
    });
  }

  private limparFormulario(): void {
    this.formulario = { sku: '', nome: '', saldo: 0 };
  }
}
