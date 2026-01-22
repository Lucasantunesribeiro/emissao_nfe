# Guia de Contribuição

Obrigado por considerar contribuir para o projeto Sistema de Emissão de NFE!

## Como Contribuir

### Reportando Bugs

Se você encontrar um bug, por favor:
1. Verifique se já não existe uma issue sobre ele
2. Crie uma nova issue com:
   - Título descritivo
   - Passos para reproduzir
   - Comportamento esperado vs atual
   - Screenshots se aplicável
   - Informações de ambiente (OS, versões, etc)

### Sugerindo Melhorias

Para sugerir novas funcionalidades:
1. Abra uma issue descrevendo a funcionalidade
2. Explique por que seria útil
3. Descreva como deveria funcionar

### Pull Requests

1. Fork o projeto
2. Crie uma branch para sua feature:
   ```bash
   git checkout -b feature/MinhaNovaFeature
   ```

3. Faça suas alterações seguindo os padrões:
   - **Go**: `gofmt` para formatação
   - **.NET**: seguir convenções do C#
   - **TypeScript/Angular**: seguir style guide do Angular

4. Commit suas mudanças:
   ```bash
   git commit -m "feat: adiciona nova funcionalidade X"
   ```

5. Push para sua branch:
   ```bash
   git push origin feature/MinhaNovaFeature
   ```

6. Abra um Pull Request

## Convenções de Commit

Seguimos [Conventional Commits](https://www.conventionalcommits.org/):

- `feat:` nova funcionalidade
- `fix:` correção de bug
- `docs:` mudanças na documentação
- `style:` formatação de código
- `refactor:` refatoração de código
- `test:` adição ou correção de testes
- `chore:` mudanças em build, CI, etc

## Testes

- Sempre adicione testes para novas funcionalidades
- Certifique-se de que todos os testes passam antes do PR

## Dúvidas?

Abra uma issue ou entre em contato!
