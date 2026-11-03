package dominio

import (
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strconv"
	"strings"
)

// Dinheiro representa um valor monetario em centavos (int64).
//
// Valores fiscais nunca devem ser calculados em float64: 0.1 + 0.2 != 0.3 em
// ponto flutuante binario, e o arredondamento acumulado em totais de nota gera
// divergencia de centavos. Dinheiro guarda o valor exato em centavos e so
// converte para texto decimal (ex.: "10.50") nas bordas (JSON e DynamoDB).
type Dinheiro int64

// valorMaximoCentavos limita o valor aceito na entrada (R$ 10 trilhoes) para
// que multiplicacoes por quantidade nao estourem int64.
const valorMaximoCentavos = int64(1_000_000_000_000_000)

var (
	// ErrValorMonetarioInvalido indica texto que nao e um decimal valido.
	ErrValorMonetarioInvalido = errors.New("valor monetario invalido")
	// ErrPrecisaoMonetaria indica mais de duas casas decimais.
	ErrPrecisaoMonetaria = errors.New("valor monetario aceita no maximo 2 casas decimais")
	// ErrValorMonetarioForaDoLimite indica valor acima do limite suportado.
	ErrValorMonetarioForaDoLimite = errors.New("valor monetario fora do limite suportado")
)

// Centavos cria um Dinheiro a partir de centavos.
func Centavos(c int64) Dinheiro { return Dinheiro(c) }

// ParseDinheiro converte um decimal textual ("10", "10.5", "10.50", "-3.20")
// em Dinheiro sem passar por float64. Rejeita mais de 2 casas decimais,
// notacao exponencial e valores acima do limite.
func ParseDinheiro(s string) (Dinheiro, error) {
	s = strings.TrimSpace(s)
	if s == "" {
		return 0, ErrValorMonetarioInvalido
	}

	negativo := false
	switch s[0] {
	case '-':
		negativo = true
		s = s[1:]
	case '+':
		s = s[1:]
	}

	inteira, fracao, temPonto := strings.Cut(s, ".")
	if inteira == "" || (temPonto && fracao == "") {
		return 0, fmt.Errorf("%w: %q", ErrValorMonetarioInvalido, s)
	}
	if !somenteDigitos(inteira) || !somenteDigitos(fracao) {
		return 0, fmt.Errorf("%w: %q", ErrValorMonetarioInvalido, s)
	}

	// Zeros a direita nao alteram o valor ("10.500" == "10.50").
	fracao = strings.TrimRight(fracao, "0")
	if len(fracao) > 2 {
		return 0, ErrPrecisaoMonetaria
	}
	for len(fracao) < 2 {
		fracao += "0"
	}

	inteira = strings.TrimLeft(inteira, "0")
	if inteira == "" {
		inteira = "0"
	}
	if len(inteira) > 16 {
		return 0, ErrValorMonetarioForaDoLimite
	}

	reais, err := strconv.ParseInt(inteira, 10, 64)
	if err != nil {
		return 0, fmt.Errorf("%w: %v", ErrValorMonetarioInvalido, err)
	}
	cent, _ := strconv.ParseInt(fracao, 10, 64)

	total := reais*100 + cent
	if total > valorMaximoCentavos {
		return 0, ErrValorMonetarioForaDoLimite
	}
	if negativo {
		total = -total
	}
	return Dinheiro(total), nil
}

func somenteDigitos(s string) bool {
	for _, r := range s {
		if r < '0' || r > '9' {
			return false
		}
	}
	return true
}

// Centavos retorna o valor em centavos.
func (d Dinheiro) Centavos() int64 { return int64(d) }

// Multiplicar retorna d * quantidade, com erro em caso de overflow.
func (d Dinheiro) Multiplicar(quantidade int) (Dinheiro, error) {
	q := int64(quantidade)
	if q == 0 || d == 0 {
		return 0, nil
	}
	r := int64(d) * q
	if r/q != int64(d) || (int64(d) == -1 && q == math.MinInt64) || (q == -1 && int64(d) == math.MinInt64) {
		return 0, ErrValorMonetarioForaDoLimite
	}
	return Dinheiro(r), nil
}

// Somar retorna d + outro, com erro em caso de overflow.
func (d Dinheiro) Somar(outro Dinheiro) (Dinheiro, error) {
	a, b := int64(d), int64(outro)
	if (b > 0 && a > math.MaxInt64-b) || (b < 0 && a < math.MinInt64-b) {
		return 0, ErrValorMonetarioForaDoLimite
	}
	return Dinheiro(a + b), nil
}

// String formata com ponto decimal e sempre 2 casas: "1234.50", "-0.05".
func (d Dinheiro) String() string {
	c := int64(d)
	sinal := ""
	if c < 0 {
		sinal = "-"
		if c == math.MinInt64 {
			// Nao ha valor positivo correspondente em int64; evita overflow.
			return "-92233720368547758.08"
		}
		c = -c
	}
	return fmt.Sprintf("%s%d.%02d", sinal, c/100, c%100)
}

// FormatarBRL formata no padrao brasileiro: "R$ 1.234,50".
func (d Dinheiro) FormatarBRL() string {
	s := d.String()
	sinal := ""
	if strings.HasPrefix(s, "-") {
		sinal = "-"
		s = s[1:]
	}
	inteira, fracao, _ := strings.Cut(s, ".")
	var b strings.Builder
	for i, r := range inteira {
		if i > 0 && (len(inteira)-i)%3 == 0 {
			b.WriteByte('.')
		}
		b.WriteRune(r)
	}
	return fmt.Sprintf("%sR$ %s,%s", sinal, b.String(), fracao)
}

// MarshalJSON emite o valor como numero JSON decimal exato (ex.: 10.50),
// mantendo o contrato da API (precoUnitario numerico).
func (d Dinheiro) MarshalJSON() ([]byte, error) {
	return []byte(d.String()), nil
}

// UnmarshalJSON aceita numero JSON (10.5) ou string ("10.50"), lendo o texto
// literal com json.Number para nunca passar por float64.
func (d *Dinheiro) UnmarshalJSON(b []byte) error {
	txt := strings.TrimSpace(string(b))
	if txt == "null" {
		return nil
	}
	if strings.HasPrefix(txt, `"`) {
		var s string
		if err := json.Unmarshal(b, &s); err != nil {
			return err
		}
		txt = s
	} else {
		var n json.Number
		if err := json.Unmarshal(b, &n); err != nil {
			return fmt.Errorf("%w: %v", ErrValorMonetarioInvalido, err)
		}
		txt = n.String()
	}
	v, err := ParseDinheiro(txt)
	if err != nil {
		return err
	}
	*d = v
	return nil
}
