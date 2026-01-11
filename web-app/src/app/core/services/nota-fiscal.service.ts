import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';
import { NotaFiscal, CriarNotaRequest, AdicionarItemRequest, ItemNota } from '../models/nota-fiscal.model';
import { SolicitacaoImpressao, ImprimirNotaResponse } from '../models/solicitacao-impressao.model';
import { environment } from '../../../environments/environment';

@Injectable({
  providedIn: 'root'
})
export class NotaFiscalService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiFaturamentoUrl}/notas`;
  private readonly solicitacoesUrl = `${environment.apiFaturamentoUrl}/solicitacoes-impressao`;

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
}
