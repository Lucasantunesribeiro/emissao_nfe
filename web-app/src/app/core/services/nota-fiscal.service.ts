import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';
import { NotaFiscal, CriarNotaRequest, AdicionarItemRequest, ItemNota } from '../models/nota-fiscal.model';
import { SolicitacaoImpressao, ImprimirNotaResponse } from '../models/solicitacao-impressao.model';
import { RuntimeConfigService } from '../config/runtime-config.service';

@Injectable({
  providedIn: 'root'
})
export class NotaFiscalService {
  private readonly http = inject(HttpClient);
  private readonly runtimeConfig = inject(RuntimeConfigService);

  private get baseUrl(): string {
    return `${this.runtimeConfig.value.api.faturamentoUrl}/notas`;
  }

  private get solicitacoesUrl(): string {
    return `${this.runtimeConfig.value.api.faturamentoUrl}/solicitacoes-impressao`;
  }

  listarNotas(status?: string): Observable<NotaFiscal[]> {
    const params: Record<string, string> = {};
    if (status) {
      params['status'] = status;
    }
    return this.http.get<NotaFiscal[]>(this.baseUrl, { params });
  }

  buscarNota(id: string): Observable<NotaFiscal> {
    return this.http.get<NotaFiscal>(`${this.baseUrl}/${id}`);
  }

  criarNota(request: CriarNotaRequest): Observable<NotaFiscal> {
    return this.http.post<NotaFiscal>(this.baseUrl, request);
  }

  adicionarItem(notaId: string, request: AdicionarItemRequest): Observable<ItemNota> {
    return this.http.post<ItemNota>(`${this.baseUrl}/${notaId}/itens`, request);
  }

  imprimirNota(notaId: string, chaveIdempotencia: string): Observable<ImprimirNotaResponse> {
    const headers = new HttpHeaders({ 'Idempotency-Key': chaveIdempotencia });
    return this.http.post<ImprimirNotaResponse>(
      `${this.baseUrl}/${notaId}/imprimir`,
      {},
      { headers }
    );
  }

  consultarStatusImpressao(solicitacaoId: string): Observable<SolicitacaoImpressao> {
    return this.http.get<SolicitacaoImpressao>(`${this.solicitacoesUrl}/${solicitacaoId}`);
  }

  fecharNota(notaId: string): Observable<{mensagem: string}> {
    return this.http.put<{mensagem: string}>(`${this.baseUrl}/${notaId}/fechar`, {});
  }
}
