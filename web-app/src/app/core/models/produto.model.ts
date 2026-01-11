export interface Produto {
  id: string;
  sku: string;
  nome: string;
  saldo: number;
  ativo: boolean;
  dataCriacao: string;
  versao: number;
}

export interface CriarProdutoRequest {
  sku: string;
  nome: string;
  saldo: number;
}

export interface AtualizarProdutoRequest {
  nome: string;
  saldo: number;
  ativo: boolean;
}
