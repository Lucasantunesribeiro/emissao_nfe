#!/bin/sh
# Inicia os tres processos da demo; se qualquer um morrer, o container encerra
# (o host reinicia). Memoria limitada para caber em instancias free (512 MB).
set -eu

cd /opt/dynamodb-local
java -Xmx128m -XX:MaxMetaspaceSize=64m -Djava.library.path=./DynamoDBLocal_lib \
  -jar DynamoDBLocal.jar -inMemory -sharedDb -port 8000 &
DDB=$!

/usr/bin/dotnet /app/estoque/ServicoEstoque.dll &
ESTOQUE=$!

HTTP_ADDR=":${PORT}" /app/faturamento &
FATURAMENTO=$!

# Encerra tudo quando qualquer processo terminar.
while kill -0 "$DDB" 2>/dev/null && kill -0 "$ESTOQUE" 2>/dev/null && kill -0 "$FATURAMENTO" 2>/dev/null; do
  sleep 5
done
echo "Um dos processos da demo terminou; encerrando container" >&2
kill "$DDB" "$ESTOQUE" "$FATURAMENTO" 2>/dev/null || true
exit 1
