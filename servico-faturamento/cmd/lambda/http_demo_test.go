package main

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestParaRequisicaoAPIGateway_CabecalhosMinusculosEQuery(t *testing.T) {
	r := httptest.NewRequest(http.MethodPost, "/api/v1/notas/abc/imprimir?status=ABERTA", strings.NewReader(`{}`))
	r.Header.Set("Idempotency-Key", "chave-12345")
	r.Header.Set("Origin", "https://exemplo.github.io")

	req := ParaRequisicaoAPIGateway(r, []byte(`{"a":1}`))

	if req.HTTPMethod != http.MethodPost || req.Path != "/api/v1/notas/abc/imprimir" {
		t.Fatalf("metodo/path incorretos: %s %s", req.HTTPMethod, req.Path)
	}
	// getHeaderValue procura a forma minuscula; Origin/Idempotency-Key precisam chegar.
	if getHeaderValue(req.Headers, "Idempotency-Key") != "chave-12345" {
		t.Errorf("Idempotency-Key nao encontrado: %v", req.Headers)
	}
	if getHeaderValue(req.Headers, "origin") != "https://exemplo.github.io" {
		t.Errorf("Origin nao encontrado: %v", req.Headers)
	}
	if req.QueryStringParameters["status"] != "ABERTA" || req.Body != `{"a":1}` {
		t.Errorf("query/body incorretos: %v %q", req.QueryStringParameters, req.Body)
	}
}

func TestEhRotaEstoque(t *testing.T) {
	for path, esperado := range map[string]bool{
		"/api/v1/produtos":     true,
		"/api/v1/produtos/123": true,
		"/api/v1/reservas":     true,
		"/api/v1/notas":        false,
		"/health":              false,
	} {
		if ehRotaEstoque(path) != esperado {
			t.Errorf("%s: esperado %v", path, esperado)
		}
	}
}

func TestGuardarPDF_LimitaQuantidadeEmMemoria(t *testing.T) {
	s := &servidorDemo{pdfs: map[string][]byte{}}
	for i := 0; i < maxPDFsEmMemoria+5; i++ {
		s.guardarPDF(fmt.Sprintf("id-%d", i), []byte("%PDF"))
	}
	if len(s.pdfs) != maxPDFsEmMemoria || len(s.ordemPDFs) != maxPDFsEmMemoria {
		t.Fatalf("esperava %d PDFs, obteve %d/%d", maxPDFsEmMemoria, len(s.pdfs), len(s.ordemPDFs))
	}
	if _, ok := s.pdfs["id-0"]; ok {
		t.Error("o PDF mais antigo deveria ter sido descartado")
	}

	rec := httptest.NewRecorder()
	s.servirPDF(rec, httptest.NewRequest(http.MethodGet, fmt.Sprintf("/demo/pdfs/id-%d.pdf", maxPDFsEmMemoria+4), nil))
	if rec.Code != http.StatusOK || rec.Header().Get("Content-Type") != "application/pdf" {
		t.Errorf("esperava PDF 200, obteve %d %s", rec.Code, rec.Header().Get("Content-Type"))
	}
	rec = httptest.NewRecorder()
	s.servirPDF(rec, httptest.NewRequest(http.MethodGet, "/demo/pdfs/id-0.pdf", nil))
	if rec.Code != http.StatusNotFound {
		t.Errorf("PDF descartado deveria dar 404, obteve %d", rec.Code)
	}
}
