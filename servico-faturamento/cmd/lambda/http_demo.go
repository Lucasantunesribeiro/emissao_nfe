package main

// Modo HTTP para demo gratuita e desenvolvimento local.
//
// Em producao esta Lambda recebe eventos do API Gateway/SQS. Fora da AWS
// (Render, docker compose) nao existe API Gateway, EventBridge, SQS nem S3; este
// arquivo adapta HTTP comum para o mesmo HandleRequest e, opcionalmente,
// executa de forma SINCRONA os passos que na AWS sao assincronos:
//
//   - DEMO_SAGA_SINCRONA=true: apos PUT /api/v1/notas/{id}/fechar com sucesso,
//     faz a reserva de estoque (mesma transacao atomica do EstoqueConsumer) e
//     move a nota para RESERVADA ou CANCELADA.
//   - DEMO_PDF_SINCRONO=true: apos POST /api/v1/notas/{id}/imprimir, gera o PDF
//     em memoria e o serve em /demo/pdfs/<solicitacao>.pdf.
//   - ESTOQUE_INTERNAL_URL: rotas /api/v1/produtos e /api/v1/reservas sao
//     repassadas para a API .NET (mesmo host publico para o frontend).
//   - DEMO_CRIAR_TABELAS=true: cria as tabelas no DynamoDB Local ao iniciar.
//
// Ativado somente quando HTTP_ADDR esta definido; sem ele a Lambda se comporta
// exatamente como antes. O ambiente fiscal continua vindo de
// fiscal.CarregarAmbiente (homologacao por padrao).

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-sdk-go-v2/aws"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
	"github.com/google/uuid"

	"servico-faturamento/internal/dominio"
	"servico-faturamento/internal/pdf"
	"servico-faturamento/internal/repositorio"
)

const maxPDFsEmMemoria = 50

var (
	rotaFechar   = regexp.MustCompile(`^/api/v1/notas/([0-9a-fA-F-]{36})/fechar/?$`)
	rotaImprimir = regexp.MustCompile(`^/api/v1/notas/([0-9a-fA-F-]{36})/imprimir/?$`)
)

type servidorDemo struct {
	h            *LambdaHandler
	estoque      http.Handler
	sagaSincrona bool
	pdfSincrono  bool
	gerador      *pdf.GeradorPDF
	mu           sync.Mutex
	pdfs         map[string][]byte
	ordemPDFs    []string
}

func envVerdadeiro(nome string) bool {
	return strings.EqualFold(strings.TrimSpace(os.Getenv(nome)), "true")
}

func novoServidorDemo(h *LambdaHandler) (*servidorDemo, error) {
	s := &servidorDemo{
		h:            h,
		sagaSincrona: envVerdadeiro("DEMO_SAGA_SINCRONA"),
		pdfSincrono:  envVerdadeiro("DEMO_PDF_SINCRONO"),
		gerador:      pdf.NewGeradorPDF(h.ambiente),
		pdfs:         map[string][]byte{},
	}
	if alvo := strings.TrimSpace(os.Getenv("ESTOQUE_INTERNAL_URL")); alvo != "" {
		u, err := url.Parse(alvo)
		if err != nil {
			return nil, fmt.Errorf("ESTOQUE_INTERNAL_URL invalida: %w", err)
		}
		s.estoque = httputil.NewSingleHostReverseProxy(u)
	}
	return s, nil
}

func ehRotaEstoque(path string) bool {
	return strings.HasPrefix(path, "/api/v1/produtos") || strings.HasPrefix(path, "/api/v1/reservas")
}

func (s *servidorDemo) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if s.estoque != nil && ehRotaEstoque(r.URL.Path) {
		s.estoque.ServeHTTP(w, r)
		return
	}
	if strings.HasPrefix(r.URL.Path, "/demo/pdfs/") && r.Method == http.MethodGet {
		s.servirPDF(w, r)
		return
	}

	body, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	if err != nil {
		http.Error(w, "corpo invalido", http.StatusBadRequest)
		return
	}
	req := ParaRequisicaoAPIGateway(r, body)

	resp, err := s.h.HandleRequest(r.Context(), req)
	if err != nil {
		slog.Error("Erro no handler HTTP", "error", err)
		http.Error(w, `{"erro":"erro interno"}`, http.StatusInternalServerError)
		return
	}

	sucesso := resp.StatusCode >= 200 && resp.StatusCode < 300
	if sucesso && s.sagaSincrona && r.Method == http.MethodPut {
		if m := rotaFechar.FindStringSubmatch(r.URL.Path); m != nil {
			s.reservarSincrono(r.Context(), uuid.MustParse(m[1]))
		}
	}
	if sucesso && s.pdfSincrono && r.Method == http.MethodPost && rotaImprimir.MatchString(r.URL.Path) {
		resp.Body = s.gerarPDFSincrono(r, resp.Body)
	}

	for k, v := range resp.Headers {
		w.Header().Set(k, v)
	}
	w.WriteHeader(resp.StatusCode)
	_, _ = io.WriteString(w, resp.Body)
}

// ParaRequisicaoAPIGateway converte uma requisicao HTTP no evento que o API
// Gateway entregaria. Cabecalhos ficam em minusculas (getHeaderValue procura
// primeiro a forma minuscula).
func ParaRequisicaoAPIGateway(r *http.Request, body []byte) events.APIGatewayProxyRequest {
	headers := make(map[string]string, len(r.Header))
	for k := range r.Header {
		headers[strings.ToLower(k)] = r.Header.Get(k)
	}
	query := make(map[string]string)
	for k := range r.URL.Query() {
		query[k] = r.URL.Query().Get(k)
	}
	return events.APIGatewayProxyRequest{
		HTTPMethod:            r.Method,
		Path:                  r.URL.Path,
		Headers:               headers,
		QueryStringParameters: query,
		Body:                  string(body),
	}
}

// reservarSincrono replica, sem SQS, o que o EstoqueConsumer + o handler da
// saga fazem: baixa atomica e idempotente e transicao condicional da nota.
func (s *servidorDemo) reservarSincrono(ctx context.Context, notaID uuid.UUID) {
	repo := s.h.repo
	nota, err := repo.BuscarNotaPorID(ctx, notaID)
	if err != nil || nota == nil {
		slog.Error("Demo: nota nao encontrada para reserva", "notaId", notaID, "error", err)
		return
	}
	err = repo.ReservarEstoqueNota(ctx, notaID, nota.QuantidadesPorProduto())
	var semSaldo *repositorio.ErroSaldoInsuficiente
	switch {
	case err == nil:
		_, err = repo.TransicionarStatusNota(ctx, notaID, dominio.StatusNotaFechada, dominio.StatusNotaReservada)
	case errors.As(err, &semSaldo):
		motivo := fmt.Sprintf("saldo insuficiente para produto %s", semSaldo.ProdutoID)
		if errReg := repo.RegistrarFalhaReserva(ctx, notaID, motivo); errReg != nil && !errors.Is(errReg, repositorio.ErrReservaJaRegistrada) {
			err = errReg
			break
		}
		_, err = repo.TransicionarStatusNota(ctx, notaID, dominio.StatusNotaFechada, dominio.StatusNotaCancelada)
	case errors.Is(err, repositorio.ErrReservaJaRegistrada):
		err = nil
	}
	if err != nil {
		slog.Error("Demo: falha na reserva sincrona", "notaId", notaID, "error", err)
	}
}

func (s *servidorDemo) gerarPDFSincrono(r *http.Request, corpo string) string {
	var sol dominio.SolicitacaoImpressao
	if err := json.Unmarshal([]byte(corpo), &sol); err != nil || sol.ID == uuid.Nil {
		return corpo
	}
	if sol.Status == "CONCLUIDA" {
		return corpo // reenvio idempotente: PDF ja gerado
	}
	ctx := r.Context()
	falhar := func(msg string) string {
		_ = s.h.repo.AtualizarSolicitacaoImpressao(ctx, sol.ID, "FALHOU", "", &msg)
		return corpo
	}
	nota, err := s.h.repo.BuscarNotaPorID(ctx, sol.NotaID)
	if err != nil || nota == nil {
		return falhar("nota nao encontrada")
	}
	conteudo, err := s.gerador.GerarNotaFiscal(nota)
	if err != nil {
		return falhar("falha ao gerar PDF")
	}
	s.guardarPDF(sol.ID.String(), conteudo)

	pdfURL := baseURLPublica(r) + "/demo/pdfs/" + sol.ID.String() + ".pdf"
	if err := s.h.repo.AtualizarSolicitacaoImpressao(ctx, sol.ID, "CONCLUIDA", pdfURL, nil); err != nil {
		slog.Error("Demo: falha ao concluir solicitacao", "solicitacaoId", sol.ID, "error", err)
		return corpo
	}
	agora := time.Now().UTC()
	sol.Status, sol.PdfURL, sol.DataConclusao = "CONCLUIDA", &pdfURL, &agora
	if b, err := json.Marshal(sol); err == nil {
		return string(b)
	}
	return corpo
}

func baseURLPublica(r *http.Request) string {
	if base := strings.TrimRight(os.Getenv("DEMO_PUBLIC_URL"), "/"); base != "" {
		return base
	}
	esquema := "http"
	if r.TLS != nil || strings.EqualFold(r.Header.Get("X-Forwarded-Proto"), "https") {
		esquema = "https"
	}
	return esquema + "://" + r.Host
}

func (s *servidorDemo) guardarPDF(id string, conteudo []byte) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, existe := s.pdfs[id]; !existe {
		s.ordemPDFs = append(s.ordemPDFs, id)
	}
	s.pdfs[id] = conteudo
	for len(s.ordemPDFs) > maxPDFsEmMemoria {
		delete(s.pdfs, s.ordemPDFs[0])
		s.ordemPDFs = s.ordemPDFs[1:]
	}
}

func (s *servidorDemo) servirPDF(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimSuffix(strings.TrimPrefix(r.URL.Path, "/demo/pdfs/"), ".pdf")
	s.mu.Lock()
	conteudo, ok := s.pdfs[id]
	s.mu.Unlock()
	if !ok {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", "application/pdf")
	_, _ = w.Write(conteudo)
}

// criarTabelasDemo cria main/events com o mesmo esquema do CDK
// (scripts/local/criar-tabelas.sh). Idempotente; espera o DynamoDB subir.
func criarTabelasDemo(ctx context.Context, mainTable, eventsTable string) error {
	cfg, err := awsconfig.LoadDefaultConfig(ctx)
	if err != nil {
		return err
	}
	client := dynamodb.NewFromConfig(cfg)
	s := func(n string) types.AttributeDefinition {
		return types.AttributeDefinition{AttributeName: aws.String(n), AttributeType: types.ScalarAttributeTypeS}
	}
	chave := func(n string, t types.KeyType) types.KeySchemaElement {
		return types.KeySchemaElement{AttributeName: aws.String(n), KeyType: t}
	}
	tabelas := []*dynamodb.CreateTableInput{
		{
			TableName:            aws.String(mainTable),
			BillingMode:          types.BillingModePayPerRequest,
			AttributeDefinitions: []types.AttributeDefinition{s("PK"), s("SK"), s("GSI1_PK"), s("GSI2_PK"), s("GSI2_SK")},
			KeySchema:            []types.KeySchemaElement{chave("PK", types.KeyTypeHash), chave("SK", types.KeyTypeRange)},
			GlobalSecondaryIndexes: []types.GlobalSecondaryIndex{
				{IndexName: aws.String("GSI1"), KeySchema: []types.KeySchemaElement{chave("GSI1_PK", types.KeyTypeHash)},
					Projection: &types.Projection{ProjectionType: types.ProjectionTypeAll}},
				{IndexName: aws.String("GSI2"), KeySchema: []types.KeySchemaElement{chave("GSI2_PK", types.KeyTypeHash), chave("GSI2_SK", types.KeyTypeRange)},
					Projection: &types.Projection{ProjectionType: types.ProjectionTypeAll}},
			},
		},
		{
			TableName:            aws.String(eventsTable),
			BillingMode:          types.BillingModePayPerRequest,
			AttributeDefinitions: []types.AttributeDefinition{s("PK"), s("SK")},
			KeySchema:            []types.KeySchemaElement{chave("PK", types.KeyTypeHash), chave("SK", types.KeyTypeRange)},
		},
	}
	for _, t := range tabelas {
		for tentativa := 0; ; tentativa++ {
			_, err = client.CreateTable(ctx, t)
			var emUso *types.ResourceInUseException
			if err == nil || errors.As(err, &emUso) {
				break
			}
			if tentativa >= 30 {
				return fmt.Errorf("criar tabela %s: %w", aws.ToString(t.TableName), err)
			}
			time.Sleep(time.Second)
		}
	}
	return nil
}

func servirHTTP(h *LambdaHandler, addr string) error {
	if envVerdadeiro("DEMO_CRIAR_TABELAS") {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
		defer cancel()
		if err := criarTabelasDemo(ctx, os.Getenv("DYNAMODB_TABLE_NAME"), os.Getenv("DYNAMODB_EVENTS_TABLE_NAME")); err != nil {
			return err
		}
	}
	s, err := novoServidorDemo(h)
	if err != nil {
		return err
	}
	slog.Info("Modo HTTP (demo/local) ativo", "addr", addr, "sagaSincrona", s.sagaSincrona,
		"pdfSincrono", s.pdfSincrono, "proxyEstoque", s.estoque != nil,
		"ambienteFiscal", h.ambiente.String(), "tpAmb", h.ambiente.TpAmb())
	srv := &http.Server{Addr: addr, Handler: s, ReadHeaderTimeout: 10 * time.Second}
	return srv.ListenAndServe()
}
