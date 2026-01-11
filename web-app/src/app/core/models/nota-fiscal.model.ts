export interface NotaFiscal {
  id: string;
  numero: string;
  status: 'ABERTA' | 'FECHADA';
  dataCriacao: string;
  dataFechada?: string;
  itens?: ItemNota[];
}

export interface ItemNota {
  id: string;
  notaId: string;
  produtoId: string;
  quantidade: number;
  precoUnitario: number;
}

export interface CriarNotaRequest {
  numero: string;
}

export interface AdicionarItemRequest {
  produtoId: string;
  quantidade: number;
  precoUnitario: number;
}
