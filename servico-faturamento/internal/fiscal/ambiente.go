// Package fiscal concentra configuracoes de emissao fiscal.
//
// O sistema ainda NAO integra com a SEFAZ. Mesmo assim, o ambiente fiscal e
// resolvido aqui de forma fail-safe para que qualquer integracao futura (e o
// PDF gerado hoje) herde o comportamento correto: sem configuracao explicita,
// o ambiente e SEMPRE homologacao (tpAmb=2).
package fiscal

import (
	"errors"
	"fmt"
	"strings"
)

// Ambiente segue o campo tpAmb do leiaute da NF-e: 1=Producao, 2=Homologacao.
type Ambiente int

const (
	AmbienteProducao    Ambiente = 1
	AmbienteHomologacao Ambiente = 2
)

const (
	// EnvAmbiente seleciona o ambiente: "homologacao" (padrao) ou "producao".
	EnvAmbiente = "NFE_AMBIENTE"
	// EnvConfirmacaoProducao e a guarda extra: producao so e aceita quando
	// esta variavel contem exatamente ConfirmacaoProducao.
	EnvConfirmacaoProducao = "NFE_CONFIRMAR_PRODUCAO"
	// ConfirmacaoProducao e o valor exigido em EnvConfirmacaoProducao.
	ConfirmacaoProducao = "EMITIR-NFE-COM-VALOR-FISCAL"
)

var (
	// ErrAmbienteInvalido indica valor desconhecido em NFE_AMBIENTE.
	ErrAmbienteInvalido = errors.New("NFE_AMBIENTE invalido")
	// ErrProducaoNaoConfirmada indica NFE_AMBIENTE=producao sem a guarda extra.
	ErrProducaoNaoConfirmada = errors.New("NFE_AMBIENTE=producao exige NFE_CONFIRMAR_PRODUCAO=" + ConfirmacaoProducao)
)

// TpAmb retorna o codigo tpAmb do leiaute NF-e.
func (a Ambiente) TpAmb() int { return int(a) }

// EhProducao indica se o ambiente emite documentos com valor fiscal.
func (a Ambiente) EhProducao() bool { return a == AmbienteProducao }

func (a Ambiente) String() string {
	if a == AmbienteProducao {
		return "producao"
	}
	return "homologacao"
}

// CarregarAmbiente resolve o ambiente fiscal a partir das variaveis de
// ambiente (getenv normalmente e os.Getenv).
//
// Regras:
//   - NFE_AMBIENTE vazio/ausente, "homologacao" ou "2" -> homologacao.
//   - NFE_AMBIENTE "producao" ou "1" -> producao SOMENTE se
//     NFE_CONFIRMAR_PRODUCAO=EMITIR-NFE-COM-VALOR-FISCAL; caso contrario erro.
//   - Qualquer outro valor -> erro (nunca cai silenciosamente em producao).
//
// Em caso de erro o ambiente retornado e homologacao, para que um chamador
// que ignore o erro continue no lado seguro.
func CarregarAmbiente(getenv func(string) string) (Ambiente, error) {
	valor := strings.ToLower(strings.TrimSpace(getenv(EnvAmbiente)))
	switch valor {
	case "", "homologacao", "homologação", "2":
		return AmbienteHomologacao, nil
	case "producao", "produção", "1":
		if strings.TrimSpace(getenv(EnvConfirmacaoProducao)) != ConfirmacaoProducao {
			return AmbienteHomologacao, ErrProducaoNaoConfirmada
		}
		return AmbienteProducao, nil
	default:
		return AmbienteHomologacao, fmt.Errorf("%w: %q (use homologacao ou producao)", ErrAmbienteInvalido, valor)
	}
}
