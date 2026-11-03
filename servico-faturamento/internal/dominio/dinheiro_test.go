package dominio_test

import (
	"encoding/json"
	"errors"
	"testing"

	"servico-faturamento/internal/dominio"
)

func TestParseDinheiro(t *testing.T) {
	casos := []struct {
		entrada  string
		centavos int64
	}{
		{"0", 0},
		{"10", 1000},
		{"10.5", 1050},
		{"10.50", 1050},
		{"10.500", 1050},
		{"0.01", 1},
		{"007.10", 710},
		{"-3.20", -320},
		{"+1.99", 199},
		{"1234567.89", 123456789},
	}
	for _, c := range casos {
		got, err := dominio.ParseDinheiro(c.entrada)
		if err != nil {
			t.Errorf("ParseDinheiro(%q) erro inesperado: %v", c.entrada, err)
			continue
		}
		if got.Centavos() != c.centavos {
			t.Errorf("ParseDinheiro(%q) = %d centavos, esperado %d", c.entrada, got.Centavos(), c.centavos)
		}
	}
}

func TestParseDinheiro_Invalidos(t *testing.T) {
	casos := map[string]error{
		"":                    dominio.ErrValorMonetarioInvalido,
		"abc":                 dominio.ErrValorMonetarioInvalido,
		"1e3":                 dominio.ErrValorMonetarioInvalido,
		"1,50":                dominio.ErrValorMonetarioInvalido,
		".5":                  dominio.ErrValorMonetarioInvalido,
		"5.":                  dominio.ErrValorMonetarioInvalido,
		"1.234":               dominio.ErrPrecisaoMonetaria,
		"0.001":               dominio.ErrPrecisaoMonetaria,
		"99999999999999999.0": dominio.ErrValorMonetarioForaDoLimite,
	}
	for entrada, esperado := range casos {
		_, err := dominio.ParseDinheiro(entrada)
		if !errors.Is(err, esperado) {
			t.Errorf("ParseDinheiro(%q) erro = %v, esperado %v", entrada, err, esperado)
		}
	}
}

func TestDinheiro_Formatacao(t *testing.T) {
	casos := []struct {
		centavos int64
		str, brl string
	}{
		{0, "0.00", "R$ 0,00"},
		{5, "0.05", "R$ 0,05"},
		{1050, "10.50", "R$ 10,50"},
		{123456789, "1234567.89", "R$ 1.234.567,89"},
		{-5, "-0.05", "-R$ 0,05"},
	}
	for _, c := range casos {
		d := dominio.Centavos(c.centavos)
		if d.String() != c.str {
			t.Errorf("String(%d) = %q, esperado %q", c.centavos, d.String(), c.str)
		}
		if d.FormatarBRL() != c.brl {
			t.Errorf("FormatarBRL(%d) = %q, esperado %q", c.centavos, d.FormatarBRL(), c.brl)
		}
	}
}

func TestDinheiro_JSON_RoundTripSemFloat(t *testing.T) {
	var payload struct {
		Preco dominio.Dinheiro `json:"preco"`
	}
	// 0.29 em float64 e 0.28999999999999998; via json.Number fica exato.
	if err := json.Unmarshal([]byte(`{"preco":0.29}`), &payload); err != nil {
		t.Fatalf("erro: %v", err)
	}
	if payload.Preco.Centavos() != 29 {
		t.Fatalf("esperava 29 centavos, obteve %d", payload.Preco.Centavos())
	}
	out, _ := json.Marshal(payload)
	if string(out) != `{"preco":0.29}` {
		t.Errorf("JSON inesperado: %s", out)
	}

	if err := json.Unmarshal([]byte(`{"preco":"12.30"}`), &payload); err != nil || payload.Preco.Centavos() != 1230 {
		t.Errorf("string decimal nao aceita: %v / %d", err, payload.Preco.Centavos())
	}
	if err := json.Unmarshal([]byte(`{"preco":1.239}`), &payload); !errors.Is(err, dominio.ErrPrecisaoMonetaria) {
		t.Errorf("esperava ErrPrecisaoMonetaria, obteve %v", err)
	}
}

func TestDinheiro_MultiplicarESomar_Overflow(t *testing.T) {
	grande := dominio.Centavos(1 << 62)
	if _, err := grande.Multiplicar(4); !errors.Is(err, dominio.ErrValorMonetarioForaDoLimite) {
		t.Errorf("esperava overflow em Multiplicar, obteve %v", err)
	}
	if _, err := grande.Somar(grande); !errors.Is(err, dominio.ErrValorMonetarioForaDoLimite) {
		t.Errorf("esperava overflow em Somar, obteve %v", err)
	}
	v, err := dominio.Centavos(333).Multiplicar(3)
	if err != nil || v.Centavos() != 999 {
		t.Errorf("Multiplicar incorreto: %v %v", v, err)
	}
}
