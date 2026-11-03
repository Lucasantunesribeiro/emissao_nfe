package fiscal_test

import (
	"errors"
	"testing"

	"servico-faturamento/internal/fiscal"
)

func envDe(vars map[string]string) func(string) string {
	return func(k string) string { return vars[k] }
}

func TestCarregarAmbiente_SemConfiguracao_EhHomologacao(t *testing.T) {
	amb, err := fiscal.CarregarAmbiente(envDe(nil))
	if err != nil {
		t.Fatalf("erro inesperado: %v", err)
	}
	if amb != fiscal.AmbienteHomologacao || amb.TpAmb() != 2 || amb.EhProducao() {
		t.Fatalf("sem configuracao o ambiente deve ser homologacao (tpAmb=2), obteve %v (tpAmb=%d)", amb, amb.TpAmb())
	}
}

func TestCarregarAmbiente_Homologacao(t *testing.T) {
	for _, v := range []string{"homologacao", "HOMOLOGACAO", " homologação ", "2"} {
		amb, err := fiscal.CarregarAmbiente(envDe(map[string]string{fiscal.EnvAmbiente: v}))
		if err != nil || amb.TpAmb() != 2 {
			t.Errorf("NFE_AMBIENTE=%q: esperava homologacao, obteve %v (err=%v)", v, amb, err)
		}
	}
}

func TestCarregarAmbiente_ProducaoSemGuarda_Recusa(t *testing.T) {
	casos := []map[string]string{
		{fiscal.EnvAmbiente: "producao"},
		{fiscal.EnvAmbiente: "1"},
		{fiscal.EnvAmbiente: "producao", fiscal.EnvConfirmacaoProducao: "sim"},
		{fiscal.EnvAmbiente: "producao", fiscal.EnvConfirmacaoProducao: "true"},
	}
	for _, vars := range casos {
		amb, err := fiscal.CarregarAmbiente(envDe(vars))
		if !errors.Is(err, fiscal.ErrProducaoNaoConfirmada) {
			t.Errorf("%v: esperava ErrProducaoNaoConfirmada, obteve %v", vars, err)
		}
		if amb.EhProducao() {
			t.Errorf("%v: em erro o ambiente devolvido deve ser homologacao", vars)
		}
	}
}

func TestCarregarAmbiente_ProducaoComGuarda(t *testing.T) {
	amb, err := fiscal.CarregarAmbiente(envDe(map[string]string{
		fiscal.EnvAmbiente:            "producao",
		fiscal.EnvConfirmacaoProducao: fiscal.ConfirmacaoProducao,
	}))
	if err != nil {
		t.Fatalf("erro inesperado: %v", err)
	}
	if !amb.EhProducao() || amb.TpAmb() != 1 {
		t.Fatalf("esperava producao (tpAmb=1), obteve %v", amb)
	}
}

func TestCarregarAmbiente_ValorInvalido_NaoViraProducao(t *testing.T) {
	for _, v := range []string{"prod", "production", "dev", "3", "0"} {
		amb, err := fiscal.CarregarAmbiente(envDe(map[string]string{
			fiscal.EnvAmbiente:            v,
			fiscal.EnvConfirmacaoProducao: fiscal.ConfirmacaoProducao,
		}))
		if !errors.Is(err, fiscal.ErrAmbienteInvalido) {
			t.Errorf("NFE_AMBIENTE=%q: esperava ErrAmbienteInvalido, obteve %v", v, err)
		}
		if amb.EhProducao() {
			t.Errorf("NFE_AMBIENTE=%q: valor invalido nunca pode resultar em producao", v)
		}
	}
}
