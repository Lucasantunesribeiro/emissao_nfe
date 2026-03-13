import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { RuntimeConfigService } from '../config/runtime-config.service';
import { NotaFiscalService } from './nota-fiscal.service';

const runtimeConfigMock = {
  value: {
    api: {
      faturamentoUrl: 'https://api-faturamento.test/api/v1',
      estoqueUrl: 'https://api-estoque.test/api/v1',
    },
  },
};

describe('NotaFiscalService', () => {
  let service: NotaFiscalService;
  let http: HttpTestingController;
  const baseUrl = `${runtimeConfigMock.value.api.faturamentoUrl}/notas`;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        NotaFiscalService,
        { provide: RuntimeConfigService, useValue: runtimeConfigMock },
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });

    service = TestBed.inject(NotaFiscalService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('deve ser criado', () => {
    expect(service).toBeTruthy();
  });

  it('listarNotas deve fazer GET em /notas', () => {
    const mockNotas = [{ id: '1', numero: 'NF-001', status: 'ABERTA' }];

    service.listarNotas().subscribe((notas) => {
      expect(notas).toEqual(mockNotas);
    });

    const req = http.expectOne(baseUrl);
    expect(req.request.method).toBe('GET');
    req.flush(mockNotas);
  });

  it('listarNotas deve incluir param status quando fornecido', () => {
    service.listarNotas('FECHADA').subscribe();

    const req = http.expectOne(`${baseUrl}?status=FECHADA`);
    expect(req.request.method).toBe('GET');
    req.flush([]);
  });

  it('criarNota deve fazer POST com body correto', () => {
    const request = { numero: 'NF-002', descricao: 'Teste' };
    const mockNota = { id: '2', numero: 'NF-002', status: 'ABERTA' };

    service.criarNota(request as any).subscribe((nota) => {
      expect(nota).toEqual(mockNota);
    });

    const req = http.expectOne(baseUrl);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual(request);
    req.flush(mockNota);
  });

  it('fecharNota deve fazer PUT em /notas/{id}/fechar', () => {
    const notaId = 'nota-123';

    service.fecharNota(notaId).subscribe((res) => {
      expect(res.mensagem).toBe('Nota fechada com sucesso');
    });

    const req = http.expectOne(`${baseUrl}/${notaId}/fechar`);
    expect(req.request.method).toBe('PUT');
    req.flush({ mensagem: 'Nota fechada com sucesso' });
  });

  it('imprimirNota deve enviar header Idempotency-Key', () => {
    const notaId = 'nota-123';
    const chave = 'chave-idem-abc';

    service.imprimirNota(notaId, chave).subscribe();

    const req = http.expectOne(`${baseUrl}/${notaId}/imprimir`);
    expect(req.request.method).toBe('POST');
    expect(req.request.headers.get('Idempotency-Key')).toBe(chave);
    req.flush({ solicitacaoId: 'sol-001', status: 'PENDENTE' });
  });

  it('consultarStatusImpressao deve fazer GET na URL de solicitações', () => {
    const solicitacaoId = 'sol-001';
    const solUrl = `${runtimeConfigMock.value.api.faturamentoUrl}/solicitacoes-impressao/${solicitacaoId}`;

    service.consultarStatusImpressao(solicitacaoId).subscribe();

    const req = http.expectOne(solUrl);
    expect(req.request.method).toBe('GET');
    req.flush({ id: solicitacaoId, status: 'PENDENTE' });
  });
});
