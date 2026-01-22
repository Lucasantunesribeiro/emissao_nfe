export interface SolicitacaoImpressao {
  id: string;
  notaId: string;
  status: 'PENDENTE' | 'CONCLUIDA' | 'FALHOU';
  chaveIdempotencia: string;
  dataCriacao: string;
  dataConclusao?: string;
  mensagemErro?: string;
  pdfUrl?: string;
}

export interface ImprimirNotaResponse {
  id: string;
  notaId: string;
  status: string;
  chaveIdempotencia: string;
  pdfUrl?: string;
}
