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
    <div class="space-y-6 max-w-5xl mx-auto">
      <div>
        <a routerLink="/notas" class="btn-ghost inline-flex items-center gap-2 text-sm">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
          </svg>
          Voltar para lista
        </a>
      </div>

      @if (carregando()) {
        <div class="panel p-6">
          <div class="animate-pulse space-y-4">
            <div class="h-6 bg-slate-200 rounded"></div>
            <div class="h-4 bg-slate-200 rounded w-1/2"></div>
            <div class="h-4 bg-slate-100 rounded"></div>
            <div class="h-48 bg-slate-100 rounded"></div>
          </div>
        </div>
      }

      @if (nota()) {
        <div class="panel p-6 animate-fade-up">
          <div class="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
            <div>
              <h1 class="text-3xl font-bold text-gray-800">{{ nota()!.numero }}</h1>
              <p class="text-sm text-gray-600 mt-1">ID: {{ nota()!.id }}</p>
              <p class="text-sm text-gray-600">Criada em {{ nota()!.dataCriacao | date:'dd/MM/yyyy HH:mm' }}</p>
            </div>
            <span class="tag self-start"
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
          <div class="panel p-4 border border-sky-200 bg-sky-50 text-sky-700 flex items-center gap-3">
            <div class="h-5 w-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
            <span>Enviando solicitação de impressão...</span>
          </div>
        }

        @if (statusImpressao() === 'sucesso') {
          <div class="panel p-4 border border-emerald-200 bg-emerald-50">
            <div class="flex items-center gap-3 text-emerald-800 mb-3">
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
              </svg>
              <span class="font-semibold">Nota impressa com sucesso!</span>
            </div>
            <p class="text-sm text-emerald-700 mb-3">PDF gerado e pronto para download. Estoque atualizado.</p>
            @if (pdfUrl()) {
              <a [href]="pdfUrl()!"
                 target="_blank"
                 class="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition font-medium">
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                Baixar PDF
              </a>
            }
          </div>
        }

        @if (statusImpressao() === 'falha') {
          <div class="panel p-4 border border-red-200 bg-red-50 text-red-800">
            <div class="font-semibold mb-1">Falha ao processar a impressão</div>
            <p>{{ mensagemErro() }}</p>
          </div>
        }

        <!-- Itens da Nota -->
        <div class="panel p-6">
          <h2 class="text-xl font-display mb-4">Itens da Nota</h2>

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
                    <td class="p-3 text-right font-display text-lg">R$ {{ calcularTotal() | number:'1.2-2' }}</td>
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
          <div class="panel p-6">
            <h2 class="text-xl font-display mb-4">Adicionar Item</h2>

            <form (ngSubmit)="adicionarItem()" #form="ngForm" class="space-y-4">
              <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label class="block text-sm font-medium text-gray-700 mb-1">Produto</label>
                  <select class="select-field"
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
                  <input type="number" min="1" class="input-field"
                         name="quantidade"
                         required
                         [(ngModel)]="novoItem.quantidade" />
                </div>
                <div>
                  <label class="block text-sm font-medium text-gray-700 mb-1">Preço Unitário</label>
                  <input type="number" min="0" step="0.01" class="input-field"
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
                      class="btn-primary disabled:opacity-60"
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

        <!-- Ações da Nota -->
        <div class="panel p-6">
          <h2 class="text-xl font-display mb-4">Ações</h2>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <!-- Solicitar Impressão -->
            @if (nota()!.status === 'ABERTA') {
              <div class="border border-gray-200 rounded-lg p-4">
                <h3 class="font-semibold mb-2">Solicitar Impressão</h3>
                <p class="text-sm text-gray-600 mb-3">Gera evento de reserva de estoque e processa a nota.</p>
                <button class="btn-success w-full disabled:opacity-60"
                        (click)="solicitarImpressao()"
                        [disabled]="statusImpressao() === 'aguardando'">
                  @if (statusImpressao() === 'aguardando') {
                    <span class="inline-flex items-center gap-2">
                      <span class="h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                      Processando...
                    </span>
                  } @else {
                    <svg class="w-5 h-5 inline mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                    </svg>
                    Solicitar Impressão
                  }
                </button>
              </div>
            }

            <!-- Fechar Nota -->
            @if (nota()!.status === 'ABERTA') {
              <div class="border border-gray-200 rounded-lg p-4">
                <h3 class="font-semibold mb-2">Fechar Nota</h3>
                <p class="text-sm text-gray-600 mb-3">Finaliza a nota e impede novas alterações.</p>
                <button class="btn-primary w-full disabled:opacity-60"
                        (click)="fecharNota()"
                        [disabled]="fechandoNota()">
                  @if (fechandoNota()) {
                    <span class="inline-flex items-center gap-2">
                      <span class="h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                      Fechando...
                    </span>
                  } @else {
                    <svg class="w-5 h-5 inline mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    Fechar Nota
                  }
                </button>
                @if (erroFechar()) {
                  <div class="mt-2 bg-red-50 text-red-700 border border-red-200 rounded px-3 py-2 text-sm">
                    {{ erroFechar() }}
                  </div>
                }
              </div>
            }

            @if (nota()!.status === 'FECHADA') {
              <div class="border border-green-200 bg-green-50 rounded-lg p-4">
                <h3 class="font-semibold text-green-800 mb-2">Nota Finalizada</h3>
                <p class="text-sm text-green-700">Esta nota foi fechada e não pode mais ser alterada.</p>
              </div>
            }
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
  pdfUrl = signal<string | null>(null);
  fechandoNota = signal(false);
  erroFechar = signal<string | null>(null);

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
          const message = err instanceof Error
            ? err.message
            : err.error?.erro || err.error?.mensagem || 'Erro ao adicionar item';
          this.erroItem.set(message);
        }
      });
  }

  solicitarImpressao(): void {
    const notaId = this.nota()?.id;
    if (!notaId) return;

    const chave = this.idempotenciaService.gerarChave();
    this.statusImpressao.set('aguardando');
    this.mensagemErro.set(null);
    this.pdfUrl.set(null);

    this.notaService.imprimirNota(notaId, chave).subscribe({
      next: (resposta) => {
        // Iniciar polling para obter PDF URL
        this.iniciarPolling(resposta.id);
      },
      error: (err) => {
        this.statusImpressao.set('falha');
        const message = err instanceof Error
          ? err.message
          : err.error?.erro || err.error?.mensagem || 'Erro ao solicitar impressão';
        this.mensagemErro.set(message);
      }
    });
  }

  fecharNota(): void {
    const notaId = this.nota()?.id;
    if (!notaId) return;

    this.erroFechar.set(null);
    this.fechandoNota.set(true);

    this.notaService.fecharNota(notaId)
      .pipe(finalize(() => this.fechandoNota.set(false)))
      .subscribe({
        next: (resposta) => {
          // Recarregar nota para atualizar status
          this.carregarNota(notaId);
          this.erroFechar.set(null);
        },
        error: (err) => {
          const message = err instanceof Error
            ? err.message
            : err.error?.erro || err.error?.mensagem || 'Erro ao fechar nota';
          this.erroFechar.set(message);
        }
      });
  }

  iniciarPolling(solicitacaoId: string): void {
    this.stopPolling();

    this.pollingSub = timer(0, 2000).pipe(
      switchMap(() => this.notaService.consultarStatusImpressao(solicitacaoId)),
      timeout(60000), // Aumentado para 60s
      takeWhile((sol) => sol.status === 'PENDENTE', true),
      catchError((err) => {
        this.statusImpressao.set('aguardando');
        this.mensagemErro.set('Gerando PDF em background... Aguarde até 10 segundos.');
        return of(null);
      }),
      finalize(() => this.pollingSub = undefined)
    ).subscribe({
      next: (sol) => {
        if (!sol) return;

        if (sol.status === 'CONCLUIDA') {
          this.statusImpressao.set('sucesso');
          this.mensagemErro.set(null);
          this.pdfUrl.set(sol.pdfUrl || null);
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
