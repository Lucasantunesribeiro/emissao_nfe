import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { Produto, CriarProdutoRequest, AtualizarProdutoRequest } from '../models/produto.model';
import { environment } from '../../../environments/environment';

@Injectable({
  providedIn: 'root'
})
export class ProdutoService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiEstoqueUrl}/produtos`;

  listarProdutos(): Observable<Produto[]> {
    return this.http.get<Produto[]>(this.baseUrl);
  }

  buscarProduto(id: string): Observable<Produto> {
    return this.http.get<Produto>(`${this.baseUrl}/${id}`);
  }

  criarProduto(request: CriarProdutoRequest): Observable<Produto> {
    return this.http.post<Produto>(this.baseUrl, request);
  }

  atualizarProduto(id: string, request: AtualizarProdutoRequest): Observable<Produto> {
    return this.http.put<Produto>(`${this.baseUrl}/${id}`, request);
  }
}
