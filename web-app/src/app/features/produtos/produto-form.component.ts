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
    <div class="bg-white border rounded-lg p-6 shadow-sm">
      <h2 class="text-xl font-semibold mb-4">Novo Produto</h2>
      
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
              class="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
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
              class="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
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
              class="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="100"
            />
          </div>
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

  onSubmit(): void {
    this.erro.set(null);
    this.salvando.set(true);

    this.produtoService.criarProduto(this.formulario).subscribe({
      next: () => {
        this.salvando.set(false);
        this.produtoCriado.emit();
        this.limparFormulario();
      },
      error: (err) => {
        this.salvando.set(false);
        this.erro.set(err.error?.erro || 'Erro ao criar produto');
      }
    });
  }

  private limparFormulario(): void {
    this.formulario = { sku: '', nome: '', saldo: 0 };
  }
}
