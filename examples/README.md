# Ejemplos de request

Payloads válidos para `POST /cards/issue`.

- `request.json` — happy path: `forceError: false`. `card-processor` simula la
  aprobación externa (200–500ms) con éxito/fallo **aleatorio**.
- `request-force-error.json` — `forceError: true`. Se fuerza el fallo del simulador de aprobación en
  `card-processor`, agotando los 3 reintentos (backoff 1s/2s/4s) y
  terminando siempre en `io.card.requested.v1.dlq` → `card-issuer` sincroniza
  el `status` de la solicitud a `failed`. 

Ambos usan `documentNumber` de 8 dígitos (formato DNI peruano) y `email` con
formato válido, distintos entre sí para no chocar con la restricción `UNIQUE`
sobre `documentNumber`.

## Cómo probarlos (stack local vía `docker compose up -d --build`)

```bash
# Happy path
curl -k -X POST https://localhost/cards/issue \
  -H "Content-Type: application/json" \
  -d @examples/request.json

# Camino a DLQ (forceError determinístico)
curl -k -X POST https://localhost/cards/issue \
  -H "Content-Type: application/json" \
  -d @examples/request-force-error.json
```

El `-k` es necesario porque, sin la variable `DOMAIN` configurada, Caddy sirve
HTTPS con su CA interna autofirmada (ver README, sección "Despliegue").

Ambas peticiones responden `201 {"requestId":"...","status":"pending"}` de
inmediato; el resultado final (`issued`/`failed`) se confirma unos segundos
después en los logs estructurados:

```bash
docker compose logs -f card-issuer
docker compose logs -f card-processor
```

Repetir cualquiera de los dos `curl` con el mismo `documentNumber` de una
solicitud ya `pending`/`issued` responde `409` (regla de negocio: un cliente,
una única tarjeta). Repetirlo después de que esa misma solicitud terminó en
`failed` (vía DLQ) sí es aceptado de nuevo — ver README, sección "Resumen del
flujo".
