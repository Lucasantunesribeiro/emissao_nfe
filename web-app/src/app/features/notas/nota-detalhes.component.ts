import { Component, OnInit, OnDestroy, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { timer, switchMap, takeWhile, timeout, catchError, of, Subscription } from 'rxjs';
import { finalize } from 'rxjs/operators';
import { NotaFiscalService } from '../../core/services/nota-fiscal.service';
import { ProdutoService } from '../../core/services/produto.service';
import { IdempotenciaService } from '../../core/services/idempotencia.service';
import { NotaFiscal, AdicionarItemRequest } from '../../core/models/nota-fiscal.model';
import { Produto } from '../../core/models/produto.model';

@Component({
  selector: 'app-nota-detalhes',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  template: `
    <div class="container mx-auto px-4 py-8 max-w-5xl">
      <div class="mb-6">
        <a routerLink="/notas" class="text-blue-600 hover:text-blue-800 flex items-center gap-2">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
          </svg>
          Voltar para lista
        </a>
      </div>

      @if (carregando()) {
        <div class="bg-white border rounded-lg shadow-sm p-6">
          <div class="animate-pulse space-y-4">
            <div class="h-6 bg-slate-200 rounded"></div>
            <div class="h-4 bg-slate-200 rounded w-1/2"></div>
            <div class="h-4 bg-slate-100 rounded"></div>
            <div class="h-48 bg-slate-100 rounded"></div>
          </div>
        </div>
      }

      @if (nota()) {
        <div class="bg-white border rounded-lg p-6 shadow-sm mb-6 transition-transform duration-300">
          <div class="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
            <div>
              <h1 class="text-3xl font-bold text-gray-800">{{ nota()!.numero }}</h1>
              <p class="text-sm text-gray-600 mt-1">ID: {{ nota()!.id }}</p>
              <p class="text-sm text-gray-600">Criada em {{ nota()!.dataCriacao | date:'dd/MM/yyyy HH:mm' }}</p>
            </div>
            <span class="px-3 py-1 rounded-full text-sm font-medium self-start"
                  [ngClass]="{
                    'bg-yellow-100 text-yellow-800': nota()!.status === 'ABERTA',
                    'bg-green-100 text-green-800': nota()!.status === 'FECHADA'
                  }">
              {{ nota()!.status }}
            </span>
          </div>

          @if (nota()!.dataFechada) {
            <div class="text-sm text-gray-600 mt-4">
              Fechada em {{ nota()!.dataFechada | date:'dd/MM/yyyy HH:mm' }}
            </div>
          }
        </div>

        @if (statusImpressao() === 'aguardando') {
          <div class="mb-4 bg-blue-50 border border-blue-200 text-blue-700 rounded-lg p-4 flex items-center gap-3">
            <div class="h-5 w-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
            <span>Processando impressão... assim que o estoque confirmar, a nota será fechada.</span>
          </div>
        }

        @if (statusImpressao() === 'sucesso') {
          <div class="mb-4 bg-green-50 border border-green-200 text-green-800 rounded-lg p-4 flex items-center gap-3">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
            </svg>
            <span>Nota impressa com sucesso! Estoque atualizado e solicitação concluída.</span>
          </div>
        }

        @if (statusImpressao() === 'falha') {
          <div class="mb-4 bg-red-50 border border-red-200 text-red-800 rounded-lg p-4">
            <div class="font-semibold mb-1">Falha ao processar a impressão</div>
            <p>{{ mensagemErro() }}</p>
          </div>
        }

        <!-- Itens da Nota -->
        <div class="bg-white border rounded-lg p-6 shadow-sm mb-6">
          <h2 class="text-xl font-semibold mb-4">Itens da Nota</h2>

          @if (nota()!.itens && nota()!.itens!.length > 0) {
            <div class="overflow-x-auto">
              <table class="w-full text-sm">
                <thead class="bg-gray-50 border-b">
                  <tr>
                    <th class="text-left p-3">Produto</th>
                    <th class="text-right p-3">Quantidade</th>
                    <th class="text-right p-3">Preço Unit.</th>
                    <th class="text-right p-3">Subtotal</th>
                  </tr>
                </thead>
                <tbody>
                  @for (item of nota()!.itens; track item.id) {
                    <tr class="border-b hover:bg-gray-50 transition">
                      <td class="p-3 font-mono text-xs">{{ item.produtoId }}</td>
                      <td class="p-3 text-right">{{ item.quantidade }}</td>
                      <td class="p-3 text-right">R$ {{ item.precoUnitario | number:'1.2-2' }}</td>
                      <td class="p-3 text-right font-medium">
                        R$ {{ (item.quantidade * item.precoUnitario) | number:'1.2-2' }}
                      </td>
                    </tr>
                  }
                </tbody>
                <tfoot class="bg-gray-50">
                  <tr>
                    <td colspan="3" class="p-3 text-right font-semibold">Total:</td>
                    <td class="p-3 text-right font-bold text-lg">R$ {{ calcularTotal() | number:'1.2-2' }}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          } @else {
            <p class="text-gray-500 text-center py-4">Nenhum item adicionado.</p>
          }
        </div>

        <!-- Adicionar Item -->
        @if (nota()!.status === 'ABERTA') {
          <div class="bg-white border rounded-lg p-6 shadow-sm mb-6">
            <h2 class="text-xl font-semibold mb-4">Adicionar Item</h2>

            <form (ngSubmit)="adicionarItem()" #form="ngForm" class="space-y-4">
              <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label class="block text-sm font-medium text-gray-700 mb-1">Produto</label>
                  <select class="w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring focus:ring-blue-200"
                          name="produto"
                          required
                          [(ngModel)]="novoItem.produtoId">
                    <option value="">Selecione...</option>
                    @for (produto of produtos(); track produto.id) {
                      <option [value]="produto.id">{{ produto.nome }} (Saldo {{ produto.saldo }})</option>
                    }
                  </select>
                </div>
                <div>
                  <label class="block text-sm font-medium text-gray-700 mb-1">Quantidade</label>
                  <input type="number" min="1" class="w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring focus:ring-blue-200"
                         name="quantidade"
                         required
                         [(ngModel)]="novoItem.quantidade" />
                </div>
                <div>
                  <label class="block text-sm font-medium text-gray-700 mb-1">Preço Unitário</label>
                  <input type="number" min="0" step="0.01" class="w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring focus:ring-blue-200"
                         name="preco"
                         required
                         [(ngModel)]="novoItem.precoUnitario" />
                </div>
              </div>

              @if (erroItem()) {
                <div class="bg-red-50 text-red-700 border border-red-200 rounded-lg px-3 py-2">
                  {{ erroItem() }}
                </div>
              }

              <button type="submit"
                      class="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition disabled:opacity-60"
                      [disabled]="adicionandoItem()">
                @if (adicionandoItem()) {
                  <span class="inline-flex items-center gap-2">
                    <span class="h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                    Salvando...
                  </span>
                } @else {
                  Adicionar Item
                }
              </button>
            </form>
          </div>
        }

        <!-- Solicitar Impressão -->
        <div class="bg-white border rounded-lg p-6 shadow-sm">
          <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <h2 class="text-xl font-semibold">Solicitar impressão</h2>
              <p class="text-sm text-gray-600">Será gerado um evento de reserva; acompanhe o status abaixo.</p>
            </div>
            <button class="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition disabled:opacity-60"
                    (click)="solicitarImpressao()"
                    [disabled]="statusImpressao() === 'aguardando'">
              @if (statusImpressao() === 'aguardando') {
                <span class="inline-flex items-center gap-2">
                  <span class="h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                  Processando...
                </span>
              } @else {
                Solicitar Impressão
              }
            </button>
          </div>
        </div>
      }
    </div>
  `
})
export class NotaDetalhesComponent implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly notaService = inject(NotaFiscalService);
  private readonly produtoService = inject(ProdutoService);
  private readonly idempotenciaService = inject(IdempotenciaService);

  nota = signal<NotaFiscal | null>(null);
  produtos = signal<Produto[]>([]);
  carregando = signal(false);
  adicionandoItem = signal(false);
  erroItem = signal<string | null>(null);
  statusImpressao = signal<'idle' | 'aguardando' | 'sucesso' | 'falha'>('idle');
  mensagemErro = signal<string | null>(null);

  novoItem: AdicionarItemRequest = {
    produtoId: '',
    quantidade: 1,
    precoUnitario: 0
  };

  private pollingSub?: Subscription;

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (id) {
      this.carregarNota(id);
      this.carregarProdutos();
    }
  }

  ngOnDestroy(): void {
    this.stopPolling();
  }

  private stopPolling(): void {
    this.pollingSub?.unsubscribe();
    this.pollingSub = undefined;
  }

  carregarNota(id: string): void {
    this.carregando.set(true);
    this.notaService.buscarNota(id)
      .pipe(finalize(() => this.carregando.set(false)))
      .subscribe({
        next: (nota) => this.nota.set(nota),
        error: (err) => {
          console.error('Erro ao carregar nota:', err);
          this.router.navigate(['/notas']);
        }
      });
  }

  carregarProdutos(): void {
    this.produtoService.listarProdutos()
      .pipe(finalize(() => this.carregando.set(false)))
      .subscribe({
        next: (produtos) => this.produtos.set(produtos),
        error: (err) => console.error('Erro ao carregar produtos:', err)
      });
  }

  adicionarItem(): void {
    const notaId = this.nota()?.id;
    if (!notaId) return;

    this.erroItem.set(null);
    this.adicionandoItem.set(true);

    this.notaService.adicionarItem(notaId, this.novoItem)
      .pipe(finalize(() => this.adicionandoItem.set(false)))
      .subscribe({
        next: () => {
          this.novoItem = { produtoId: '', quantidade: 1, precoUnitario: 0 };
          this.carregarNota(notaId);
        },
        error: (err) => {
          this.erroItem.set(err.error?.erro || 'Erro ao adicionar item');
        }
      });
  }

  solicitarImpressao(): void {
    const notaId = this.nota()?.id;
    if (!notaId) return;

    const chave = this.idempotenciaService.gerarChave();
    this.statusImpressao.set('aguardando');
    this.mensagemErro.set(null);

    this.notaService.imprimirNota(notaId, chave).subscribe({
      next: (resposta) => this.iniciarPolling(resposta.id),
      error: (err) => {
        this.statusImpressao.set('falha');
        this.mensagemErro.set(err.error?.erro || 'Erro ao solicitar impressão');
      }
    });
  }

  iniciarPolling(solicitacaoId: string): void {
    this.stopPolling();

    this.pollingSub = timer(0, 1000).pipe(
      switchMap(() => this.notaService.consultarStatusImpressao(solicitacaoId)),
      timeout(30000),
      takeWhile((sol) => sol.status === 'PENDENTE', true),
      catchError((err) => {
        this.statusImpressao.set('falha');
        this.mensagemErro.set('Timeout aguardando resposta');
        return of(null);
      }),
      finalize(() => this.pollingSub = undefined)
    ).subscribe({
      next: (sol) => {
        if (!sol) return;

        if (sol.status === 'CONCLUIDA') {
          this.statusImpressao.set('sucesso');
          this.mensagemErro.set(null);
          this.carregarNota(this.nota()!.id);
        } else if (sol.status === 'FALHOU') {
          this.statusImpressao.set('falha');
          this.mensagemErro.set(sol.mensagemErro || 'Erro desconhecido');
        }
      }
    });
  }

  calcularTotal(): number {
    const itens = this.nota()?.itens || [];
    return itens.reduce((total, item) => total + (item.quantidade * item.precoUnitario), 0);
  }
}
