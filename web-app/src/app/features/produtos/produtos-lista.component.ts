import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { finalize } from 'rxjs/operators';
import { ProdutoService } from '../../core/services/produto.service';
import { Produto } from '../../core/models/produto.model';
import { ProdutoFormComponent } from './produto-form.component';

@Component({
  selector: 'app-produtos-lista',
  standalone: true,
  imports: [CommonModule, RouterLink, ProdutoFormComponent],
  template: `
    <div class="container mx-auto px-4 py-8 max-w-6xl">
      <div class="flex flex-col gap-4 md:flex-row md:items-center md:justify-between mb-6">
        <div>
          <h1 class="text-3xl font-bold text-gray-800">Produtos</h1>
          <p class="text-sm text-gray-600">Controle total de saldo para a demo – crie e visualize rapidamente.</p>
        </div>
        <button
          (click)="toggleFormulario()"
          class="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition disabled:opacity-60">
          {{ mostrarFormulario() ? 'Cancelar' : '+ Novo Produto' }}
        </button>
      </div>

      @if (mostrarFormulario()) {
        <app-produto-form
          (produtoCriado)="onProdutoCriado()"
          (cancelar)="mostrarFormulario.set(false)"
          class="block mb-6">
        </app-produto-form>
      }

      @if (carregando()) {
        <div class="grid gap-4">
          @for (s of placeholders; track s) {
            <div class="bg-white border rounded-lg p-4 shadow-sm animate-pulse">
              <div class="h-5 bg-slate-200 rounded w-1/3 mb-3"></div>
              <div class="h-4 bg-slate-100 rounded w-2/3 mb-2"></div>
              <div class="h-3 bg-slate-100 rounded w-1/2"></div>
            </div>
          }
        </div>
      }

      @if (!carregando() && produtos().length === 0) {
        <div class="text-center py-12 bg-gray-50 rounded-lg border border-dashed">
          <p class="text-gray-500">Nenhum produto cadastrado ainda. Clique em “+ Novo Produto” para começar.</p>
        </div>
      }

      @if (!carregando() && produtos().length > 0) {
        <div class="grid gap-4">
          @for (produto of produtos(); track produto.id) {
            <div class="bg-white border rounded-lg p-4 shadow-sm hover:shadow-md transition-transform duration-200">
              <div class="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
                <div class="flex-1">
                  <div class="flex items-center gap-3">
                    <h3 class="text-lg font-semibold text-gray-800">{{ produto.nome }}</h3>
                    <span class="px-2 py-1 text-xs rounded-full"
                          [ngClass]="{
                            'bg-green-100 text-green-800': produto.ativo,
                            'bg-gray-200 text-gray-700': !produto.ativo
                          }">
                      {{ produto.ativo ? 'Ativo' : 'Inativo' }}
                    </span>
                  </div>
                  <p class="text-sm text-gray-600 mt-1">SKU: {{ produto.sku }}</p>
                  <p class="text-xs text-gray-500">Criado em {{ produto.dataCriacao | date:'dd/MM/yyyy HH:mm' }}</p>
                </div>
                <div class="text-sm text-right md:text-left">
                  <span class="font-semibold">Saldo:</span>
                  <span class="ml-2 text-lg font-bold"
                        [ngClass]="{
                          'text-red-600': produto.saldo < 10,
                          'text-yellow-600': produto.saldo >= 10 && produto.saldo < 50,
                          'text-green-600': produto.saldo >= 50
                        }">
                    {{ produto.saldo }}
                  </span>
                </div>
              </div>
            </div>
          }
        </div>
      }
    </div>
  `
})
export class ProdutosListaComponent implements OnInit {
  private readonly produtoService = inject(ProdutoService);

  produtos = signal<Produto[]>([]);
  carregando = signal(false);
  mostrarFormulario = signal(false);
  readonly placeholders = Array.from({ length: 3 }, (_, i) => i);

  ngOnInit(): void {
    this.carregarProdutos();
  }

  toggleFormulario(): void {
    this.mostrarFormulario.set(!this.mostrarFormulario());
  }

  carregarProdutos(): void {
    this.carregando.set(true);
    this.produtoService.listarProdutos()
      .pipe(finalize(() => this.carregando.set(false)))
      .subscribe({
        next: (produtos) => this.produtos.set(produtos),
        error: (err) => console.error('Erro ao carregar produtos:', err)
      });
  }

  onProdutoCriado(): void {
    this.mostrarFormulario.set(false);
    this.carregarProdutos();
  }
}
