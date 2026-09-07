# Prueba Técnica — Emisión de Tarjetas

Sistema de emisión de tarjetas de crédito basado en arquitectura orientada a eventos (Kafka), compuesto por dos microservicios independientes: `card-issuer` (API REST) y `card-processor` (consumer).

# Desplegado en AWS

El proyecto esta deplegado, ingresando a https://tomishori.online/ ahi se puede probar las funcionalidades requeridas y algunos detalles extra que ayudan a la mejora de la revision del flujo pedido en la 
prueba tecnica.

URL : https://tomishori.online/

## Resumen del flujo

1. El cliente solicita una tarjeta vía `POST /cards/issue`.
2. `card-issuer` valida el payload, verifica que el cliente no tenga ya una tarjeta, genera un `requestId`, guarda la solicitud en estado `pending` y publica un evento en `io.card.requested.v1`.
3. `card-processor` consume el evento, simula un proceso externo de aprobación (200–500ms, éxito/fallo aleatorio).
4. **Éxito** → arma la tarjeta (id, número, vencimiento, cvv), actualiza la base de datos y publica `io.cards.issued.v1` con estado `emitido`.
5. **Fallo transitorio** → reintenta hasta 3 veces con backoff exponencial (1s, 2s, 4s).
6. **Reintentos agotados** → publica el evento en `io.card.requested.v1.dlq` con la razón, número de intentos y el payload original.

Regla de negocio central: **un cliente solo puede solicitar y tener una única tarjeta.**

**Reintento tras fallo permanente**: si el intento anterior de un cliente terminó en el DLQ (fallo permanente, no una tarjeta ya emitida), ese cliente **sí puede volver a solicitarla** — la regla es "una única tarjeta", no "un único intento". Para esto, `card-issuer` no solo publica eventos: también **consume** `io.cards.issued.v1` y `io.card.requested.v1.dlq` para mantener sincronizado el estado de su propia solicitud (`pending` → `issued` / `failed`). Sin esto, una vez que `document_number` queda registrado, el `UNIQUE` constraint bloquearía cualquier reintento para siempre, incluso si la tarjeta nunca se emitió


## Arquitectura

Cada servicio sigue una arquitectura hexagonal/modular: la lógica de dominio y los casos de uso quedan desacoplados de los adaptadores (HTTP, Kafka, base de datos) mediante interfaces (puertos), lo que permite testear la lógica de negocio sin infraestructura real.

![Arquitectura](io-challenge-arqui.png)

### card-issuer (REST API + consumer de sincronización)

- `POST /cards/issue`
- Validación estricta de payload (esquema, rechaza campos desconocidos).
- Verificación de unicidad por `documentNumber`, respaldada por una restricción `UNIQUE` en base de datos:
  - Si no existe una fila para ese `documentNumber` → crea una nueva (`status: pending`).
  - Si existe con `status: pending` o `status: issued` → **rechaza con 409** (ya tiene una solicitud en curso o una tarjeta emitida).
  - Si existe con `status: failed` → **permite el reintento**: reescribe la fila con un `requestId` nuevo y `status: pending` (vía un `UPDATE ... WHERE document_number = ? AND status = 'failed'` — si otra solicitud concurrente ganó la carrera y ya la cambió de `failed`, el `UPDATE` afecta 0 filas y se rechaza con 409; mismo principio de atomicidad a nivel de base que ya usábamos para el `UNIQUE`, sin introducir una condición de carrera nueva).
- Genera `requestId` (= `source` del evento).
- Publica en Kafka con **key = `documentNumber`** (garantiza orden de eventos de un mismo cliente dentro de una partición).
- Almacena la solicitud en SQLite (`status`, `updated_at`).
- Responde `{ requestId, status }`.
- **Consume** `io.cards.issued.v1` y `io.card.requested.v1.dlq` para sincronizar el `status` de su propia fila (`pending → issued` / `pending → failed`). El `UPDATE` de sincronización lleva `WHERE request_id = ? AND status = 'pending'`: si la fila ya no está en `pending` (porque ya se sincronizó, o porque un reintento posterior la reemplazó con un `requestId` nuevo), la actualización no afecta ninguna fila.

### card-processor (Consumer)

- Escucha `io.card.requested.v1`.
- Distingue **errores permanentes** (payload malformado → directo al DLQ, sin reintentos) de **errores transitorios** (falla simulada de servicio externo → sí se reintenta).
- Verifica idempotencia por `requestId` antes de emitir.
- Simula carga externa (200–500ms) con éxito/fallo aleatorio; soporta flag `forceError` para forzar el camino de fallo de forma determinística.
- Genera los datos de la tarjeta: número VISA válido (algoritmo de Luhn), fecha de vencimiento, CVV.
- Éxito → publica `io.cards.issued.v1`.
- Reintentos agotados → publica en `io.card.requested.v1.dlq`, capturando el error sin relanzarlo.

## Contrato de eventos

Estructura inspirada en CloudEvents:

```json
{
  "id": 1,
  "source": "a097d1e9-493f-4d31-a964-b408ab54645c",
  "type": "io.card.requested.v1",
  "data": { "...": "..." }
}
```

- `id`: contador incremental dentro del mismo flujo (no global).
- `source`: UUID compartido por todos los eventos de una misma solicitud (= `requestId`).
- `type`: coincide con el nombre del tópico.
- `data`: payload de negocio del evento.
- `data.error`: presente solo en eventos de fallo (`reason`, `attempts`, payload original).

### Payload de solicitud (`POST /cards/issue`)

```json
{
  "customer": {
    "documentType": "DNI",
    "documentNumber": "11654321",
    "fullName": "Jose Peréz",
    "age": 25,
    "email": "joseperez@example.com"
  },
  "product": { "type": "VISA", "currency": "PEN" },
  "forceError": false
}
```

### Evento de éxito (`io.cards.issued.v1`, publicado por `card-processor`)

```json
{
  "id": 2,
  "source": "a097d1e9-493f-4d31-a964-b408ab54645c",
  "type": "io.cards.issued.v1",
  "data": {
    "requestId": "a097d1e9-493f-4d31-a964-b408ab54645c",
    "documentNumber": "11654321",
    "card": { "number": "4111111111111111", "expiry": "MM/YY", "cvv": "123" },
    "status": "issued"
  }
}
```

`card-issuer` solo lee `source` (= `requestId`) y `type` de este evento para sincronizar su propia fila — no persiste ni reexpone los datos de la tarjeta (esos viven únicamente en la base de `card-processor`).

### Evento de fallo permanente (`io.card.requested.v1.dlq`, publicado por `card-processor`)

```json
{
  "id": 2,
  "source": "a097d1e9-493f-4d31-a964-b408ab54645c",
  "type": "io.card.requested.v1.dlq",
  "data": {
    "requestId": "a097d1e9-493f-4d31-a964-b408ab54645c",
    "documentNumber": "11654321",
    "originalPayload": { "...": "el body original de POST /cards/issue" },
    "error": { "reason": "string legible", "attempts": 3 }
  }
}
```

`card-issuer` solo lee `source` y `type` acá también (los mismos dos campos alcanzan para sincronizar el `status`); `error`/`originalPayload` quedan disponibles para diagnóstico/soporte, no los usa `card-issuer`.

## Observabilidad

- Logs estructurados (`pino`), incluyendo `source`/`requestId` en cada línea para trazar un flujo completo entre ambos servicios.
- Métricas Prometheus (`prom-client`) en `/metrics`: solicitudes recibidas, tarjetas emitidas, reintentos, mensajes al DLQ, latencia de procesamiento.
- `/health` en ambos servicios, reflejando el estado real de la conexión a Kafka (no solo "proceso vivo").

## Seguridad

- Validación estricta de entrada (zod), rechazando campos no esperados.
- Número de tarjeta y CVV **enmascarados en logs y respuestas** (solo se exponen los últimos 4 dígitos).
- El CVV se genera y almacena únicamente porque el ejercicio lo requiere explícitamente; en un sistema real su almacenamiento estaria debería prohibirse.
- `helmet` + rate limiting en el endpoint público.
- Validación de variables de entorno al arrancar

## Despliegue

Instancia EC2 única con `docker compose`. El stack final tiene 5 servicios
(`docker-compose.yaml`, raíz del proyecto):

- `kafka`
- `kafka-init`: job de un solo disparo que crea los 3 tópicos de negocio
- `card-issuer` y `card-processor`
- `caddy` (`caddy:2-alpine`): reverse proxy delante de `card-issuer`, único
  servicio con puertos publicados al host (`80:80`, `443:443`).

### `Caddyfile`

```caddyfile
{$DOMAIN:localhost} {
	reverse_proxy card-issuer:3000
}
```

### Probar en local

```bash
docker compose up -d --build
docker compose ps   # los 5 servicios (kafka, kafka-init exited 0, card-issuer,
                     # card-processor, caddy) deben quedar "healthy"

# Happy path, a través de Caddy (no directo al contenedor) — el certificado
# es autofirmado por la CA interna de Caddy (sin DOMAIN), de ahí el -k:
curl -k -X POST https://localhost/cards/issue \
  -H "Content-Type: application/json" \
  -d '{"customer":{"documentType":"DNI","documentNumber":"11654321","fullName":"Jose Perez","age":25,"email":"joseperez@example.com"},"product":{"type":"VISA","currency":"PEN"},"forceError":false}'
# → 201 {"requestId":"...","status":"pending"}, y unos segundos después
#   card-issuer sincroniza status a "issued" (ver docker compose logs card-issuer)

# Camino a DLQ (forceError:true) — mismo endpoint, mismo curl, con
# "forceError": true y otro documentNumber. A los ~7s (3 reintentos con
# backoff 1s/2s/4s) card-processor publica en el DLQ y card-issuer
# sincroniza status a "failed".

docker compose down   # -v además si se quiere limpiar los volúmenes/datos
```


### Happy path

```bash
curl -k -X POST https://localhost/cards/issue \
  -H "Content-Type: application/json" \
  -d @examples/request.json
# → 201 {"requestId":"...","status":"pending"}

docker compose logs -f card-issuer   # a los pocos segundos: status "issued"
```

El `-k` es necesario porque, sin `DOMAIN` configurada, Caddy sirve HTTPS con
su CA interna (autofirmada)

### Camino a DLQ (`forceError`)

`forceError` es un campo válido del propio esquema HTTP (`POST /cards/issue`):
en `true` fuerza de forma determinística el fallo del simulador de aprobación
en `card-processor`, agotando los 3 reintentos y terminando en el DLQ.

```bash
curl -k -X POST https://localhost/cards/issue \
  -H "Content-Type: application/json" \
  -d @examples/request-force-error.json
# → 201 {"requestId":"...","status":"pending"}, y ~7s después (3 reintentos con
#   backoff 1s/2s/4s) card-processor publica en el DLQ y card-issuer sincroniza
#   status a "failed"

docker compose logs card-processor   # "Reintentos agotados, solicitud enviada al DLQ"
docker compose logs card-issuer      # status sincronizado a "failed"
```

### 6. Apagar

```bash
docker compose down   # agregar -v además para limpiar volúmenes/datos
```

Repetir cualquiera de los dos `curl` de arriba con el mismo `documentNumber`
de un pedido ya `pending`/`issued` responde `409`; repetirlo luego de que ese
mismo pedido terminó en `failed` (camino DLQ) es aceptado de nuevo (reintento
tras fallo permanente, ver sección "Resumen del flujo").
