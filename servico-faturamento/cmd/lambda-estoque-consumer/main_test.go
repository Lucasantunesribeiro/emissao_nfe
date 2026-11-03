package main

import (
	"context"
	"encoding/json"
	"errors"
	"sync"
	"testing"

	"github.com/aws/aws-lambda-go/events"
	"github.com/google/uuid"

	"servico-faturamento/internal/dominio"
	"servico-faturamento/internal/repositorio"
)

// repoFake simula o DynamoDB: saldo por produto e um registro de reserva por
// nota, com a mesma semantica atomica (tudo ou nada) da transacao real.
type repoFake struct {
	mu        sync.Mutex
	saldos    map[uuid.UUID]int
	notas     map[uuid.UUID]*dominio.NotaFiscal
	registros map[uuid.UUID]*repositorio.RegistroReserva
	debitos   int
}

func novoRepoFake() *repoFake {
	return &repoFake{
		saldos:    map[uuid.UUID]int{},
		notas:     map[uuid.UUID]*dominio.NotaFiscal{},
		registros: map[uuid.UUID]*repositorio.RegistroReserva{},
	}
}

func (r *repoFake) BuscarNotaPorID(_ context.Context, id uuid.UUID) (*dominio.NotaFiscal, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.notas[id], nil
}

func (r *repoFake) BuscarRegistroReserva(_ context.Context, id uuid.UUID) (*repositorio.RegistroReserva, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if reg, ok := r.registros[id]; ok {
		cp := *reg
		return &cp, nil
	}
	return nil, nil
}

func (r *repoFake) ReservarEstoqueNota(_ context.Context, notaID uuid.UUID, qtds map[uuid.UUID]int) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, ok := r.registros[notaID]; ok {
		return repositorio.ErrReservaJaRegistrada
	}
	for id, q := range qtds {
		if r.saldos[id] < q {
			return &repositorio.ErroSaldoInsuficiente{ProdutoID: id}
		}
	}
	for id, q := range qtds {
		r.saldos[id] -= q
	}
	r.debitos++
	r.registros[notaID] = &repositorio.RegistroReserva{Resultado: repositorio.ResultadoReservaConfirmada}
	return nil
}

func (r *repoFake) RegistrarFalhaReserva(_ context.Context, notaID uuid.UUID, motivo string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, ok := r.registros[notaID]; ok {
		return repositorio.ErrReservaJaRegistrada
	}
	r.registros[notaID] = &repositorio.RegistroReserva{Resultado: repositorio.ResultadoReservaFalhou, Motivo: motivo}
	return nil
}

type evento struct{ tipo, notaID, motivo string }

type publicadorFake struct {
	mu       sync.Mutex
	eventos  []evento
	falharN  int // falha as N primeiras publicacoes
	chamadas int
}

func (p *publicadorFake) publicar(_ context.Context, tipo, notaID, motivo, _ string) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.chamadas++
	if p.chamadas <= p.falharN {
		return errors.New("eventbridge indisponivel")
	}
	p.eventos = append(p.eventos, evento{tipo, notaID, motivo})
	return nil
}

func mensagem(t *testing.T, messageID string, notaID uuid.UUID) events.SQSMessage {
	t.Helper()
	body, err := json.Marshal(map[string]any{
		"detail-type": "Faturamento.NotaFechada",
		"detail":      map[string]string{"notaId": notaID.String(), "correlationId": "corr-1"},
	})
	if err != nil {
		t.Fatal(err)
	}
	return events.SQSMessage{MessageId: messageID, Body: string(body)}
}

func cenario(saldo int, itens ...dominio.ItemNota) (*repoFake, *publicadorFake, *EstoqueConsumer, uuid.UUID) {
	repo := novoRepoFake()
	notaID := uuid.New()
	for _, it := range itens {
		if _, ok := repo.saldos[it.ProdutoID]; !ok {
			repo.saldos[it.ProdutoID] = saldo
		}
	}
	repo.notas[notaID] = &dominio.NotaFiscal{ID: notaID, Status: dominio.StatusNotaFechada, Itens: itens}
	pub := &publicadorFake{}
	return repo, pub, &EstoqueConsumer{repo: repo, publicar: pub.publicar}, notaID
}

func TestProcessRecord_EventoDuplicadoComMessageIdsDiferentes_DebitaUmaVez(t *testing.T) {
	produto := uuid.New()
	repo, pub, c, notaID := cenario(10, dominio.ItemNota{ProdutoID: produto, Quantidade: 4})

	// EventBridge e at-least-once: o mesmo evento pode chegar com outro MessageId.
	for _, id := range []string{"msg-1", "msg-2", "msg-1"} {
		if err := c.processRecord(context.Background(), mensagem(t, id, notaID)); err != nil {
			t.Fatalf("erro inesperado: %v", err)
		}
	}

	if repo.saldos[produto] != 6 || repo.debitos != 1 {
		t.Fatalf("estoque deve ser debitado uma unica vez: saldo=%d debitos=%d", repo.saldos[produto], repo.debitos)
	}
	if len(pub.eventos) != 3 {
		t.Fatalf("cada entrega deve (re)publicar o resultado, obteve %d eventos", len(pub.eventos))
	}
	for _, e := range pub.eventos {
		if e.tipo != "ReservaConfirmada" {
			t.Errorf("evento inesperado: %+v", e)
		}
	}
}

func TestProcessRecord_EntregasConcorrentes_DebitaUmaVez(t *testing.T) {
	produto := uuid.New()
	repo, _, c, notaID := cenario(100, dominio.ItemNota{ProdutoID: produto, Quantidade: 7})

	var wg sync.WaitGroup
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			_ = c.processRecord(context.Background(), mensagem(t, uuid.NewString(), notaID))
		}(i)
	}
	wg.Wait()

	if repo.saldos[produto] != 93 || repo.debitos != 1 {
		t.Fatalf("entregas concorrentes devem debitar uma vez: saldo=%d debitos=%d", repo.saldos[produto], repo.debitos)
	}
}

func TestProcessRecord_SaldoInsuficiente_NadaDebitadoENuncaNegativo(t *testing.T) {
	p1, p2 := uuid.New(), uuid.New()
	repo, pub, c, notaID := cenario(5,
		dominio.ItemNota{ProdutoID: p1, Quantidade: 2},
		dominio.ItemNota{ProdutoID: p2, Quantidade: 6},
	)

	if err := c.processRecord(context.Background(), mensagem(t, "m1", notaID)); err != nil {
		t.Fatalf("erro inesperado: %v", err)
	}
	if repo.saldos[p1] != 5 || repo.saldos[p2] != 5 {
		t.Fatalf("reserva parcial nao pode ocorrer: p1=%d p2=%d", repo.saldos[p1], repo.saldos[p2])
	}
	if len(pub.eventos) != 1 || pub.eventos[0].tipo != "ReservaFalhou" {
		t.Fatalf("esperava ReservaFalhou, obteve %+v", pub.eventos)
	}

	// Estoque reposto depois da falha: reentrega NAO pode reservar uma nota
	// que ja foi cancelada; o resultado registrado (falha) e mantido.
	repo.saldos[p2] = 50
	if err := c.processRecord(context.Background(), mensagem(t, "m2", notaID)); err != nil {
		t.Fatalf("erro inesperado: %v", err)
	}
	if repo.saldos[p1] != 5 || repo.saldos[p2] != 50 || repo.debitos != 0 {
		t.Fatalf("reentrega apos falha nao deve debitar: p1=%d p2=%d", repo.saldos[p1], repo.saldos[p2])
	}
	if pub.eventos[1].tipo != "ReservaFalhou" || pub.eventos[1].motivo != pub.eventos[0].motivo {
		t.Errorf("reentrega deve republicar a mesma falha: %+v", pub.eventos)
	}
}

func TestProcessRecord_ItensRepetidosDoMesmoProduto_SaoAgregados(t *testing.T) {
	produto := uuid.New()
	repo, pub, c, notaID := cenario(5,
		dominio.ItemNota{ProdutoID: produto, Quantidade: 3},
		dominio.ItemNota{ProdutoID: produto, Quantidade: 3},
	)
	// 3 + 3 = 6 > 5: deve falhar (antes cada item era checado isoladamente).
	if err := c.processRecord(context.Background(), mensagem(t, "m1", notaID)); err != nil {
		t.Fatalf("erro inesperado: %v", err)
	}
	if repo.saldos[produto] != 5 || pub.eventos[0].tipo != "ReservaFalhou" {
		t.Fatalf("esperava falha sem debito: saldo=%d eventos=%+v", repo.saldos[produto], pub.eventos)
	}
}

func TestProcessRecord_FalhaAoPublicar_RetornaErroERetentativaNaoDebitaDeNovo(t *testing.T) {
	produto := uuid.New()
	repo, pub, c, notaID := cenario(10, dominio.ItemNota{ProdutoID: produto, Quantidade: 1})
	pub.falharN = 1

	if err := c.processRecord(context.Background(), mensagem(t, "m1", notaID)); err == nil {
		t.Fatal("falha ao publicar deve retornar erro para o SQS reentregar")
	}
	if err := c.processRecord(context.Background(), mensagem(t, "m1", notaID)); err != nil {
		t.Fatalf("retentativa deveria publicar: %v", err)
	}
	if repo.saldos[produto] != 9 || repo.debitos != 1 {
		t.Fatalf("retentativa nao pode debitar de novo: saldo=%d", repo.saldos[produto])
	}
	if len(pub.eventos) != 1 || pub.eventos[0].tipo != "ReservaConfirmada" {
		t.Fatalf("esperava 1 ReservaConfirmada publicada, obteve %+v", pub.eventos)
	}
}

func TestProcessRecord_NotaForaDeFechada_Ignora(t *testing.T) {
	produto := uuid.New()
	repo, pub, c, notaID := cenario(10, dominio.ItemNota{ProdutoID: produto, Quantidade: 1})
	repo.notas[notaID].Status = dominio.StatusNotaCancelada

	if err := c.processRecord(context.Background(), mensagem(t, "m1", notaID)); err != nil {
		t.Fatalf("erro inesperado: %v", err)
	}
	if repo.saldos[produto] != 10 || len(pub.eventos) != 0 {
		t.Fatalf("nota cancelada nao deve movimentar estoque")
	}
}

func TestHandleRequest_ReportaApenasFalhas(t *testing.T) {
	produto := uuid.New()
	_, _, c, notaID := cenario(10, dominio.ItemNota{ProdutoID: produto, Quantidade: 1})

	resp, err := c.HandleRequest(context.Background(), events.SQSEvent{Records: []events.SQSMessage{
		mensagem(t, "ok", notaID),
		{MessageId: "ruim", Body: "nao-json"},
		mensagem(t, "inexistente", uuid.New()),
	}})
	if err != nil {
		t.Fatal(err)
	}
	if len(resp.BatchItemFailures) != 2 {
		t.Fatalf("esperava 2 falhas, obteve %+v", resp.BatchItemFailures)
	}
}
