# MCP Suitability Gate (`npm run mcp:gate`)

Gate determinista que verifica que la **superficie de tools MCP** generada por el bridge sea **apta
para un modelo** — no solo que exista. Puro JavaScript, **zero-dep**, pensado para CI.

> Motivación: `mcp-fastapi-bridge.js` traduce las rutas REST **1:1** (1 endpoint = 1 tool). Esa
> superficie cruda es difícil de usar para un modelo: familias de tools estructuralmente idénticas
> que no puede desambiguar, parámetros opcionales libres, tools sin schema. Este gate lo detecta
> con números, de forma determinista, y falla el build si la superficie no es apta.

## Uso

```bash
PORT=0 npm run mcp:gate     # exit 0 = PASS, 1 = FAIL (apto para CI)
```

Arranca la app, vuelca el OpenAPI que ya genera (`_getOpenAPISchema`) y evalúa la superficie 1:1 que
produciría el bridge (filtrando rutas de sistema como hace el bridge real).

Salida típica sobre una superficie 1:1 sin agrupar:

```
[X] AACS gate sobre la superficie MCP: FAIL  (20 tools / 5 entidades)
     j-shape: 21 pares idénticos -> get_users__id_~delete_users__id_; ...
     undisciplined: 1 tools -> post_vectors_search
     -> superficie 1:1 inapta; agrupá task-oriented (CRUD->find/upsert/remove, search_* unificado con mode).
```

## Qué mide (núcleo estructural de AACS)

| Regla | ERROR si | Qué caza |
|---|---|---|
| `tool-count` | > 20 tools | superficie inflada |
| `entity-ratio` | tools/entidad > 7 | demasiadas tools por entidad (CRUD desplegado) |
| `J_shape` | dos tools con árbol de tipos idéntico (> 0.95) | tools que el modelo no distingue por forma — **ignora nombres** a propósito (§3.5 AACS) |
| `U` (opcionales libres) | > 5 por tool | tools con demasiados parámetros opcionales planos |

Cualquier ERROR ⇒ veredicto **FAIL**. (Hay además umbrales WARN no bloqueantes.)

## Cómo arreglar un FAIL (reshape task-oriented)

El gate **audita**, no reescribe el bridge. Para que pase, rediseña la superficie por *tarea*, no por
endpoint:

- **CRUD → `find_X` / `upsert_X` / `remove_X`** por entidad, en vez de get/post/put/delete sueltos.
- **Familias `search_*` → una sola tool** con un parámetro `mode: enum[...]`.
- **Documenta las propiedades** (`description`) y estructura los filtros en objetos en vez de muchos
  opcionales planos.
- Si dos tools son una **familia real** indistinguible a propósito, decláralas con `x-variant-of` mutuo.

## Archivos

- [`aacs-lite.js`](aacs-lite.js) — el gate (consume un OpenAPI → veredicto + findings). Reusable como
  CLI: `node ccdd/aacs-lite.js openapi.json`.
- [`mcp-gate.js`](mcp-gate.js) — glue de build: vuelca el OpenAPI de la app y lo evalúa.

## Alcance honesto

- Es el **núcleo estructural** de [AACS](https://github.com/MauricioPerera/ccdd-gate) (linter
  determinista de complejidad de tool-schemas), **no la spec completa**. Está **validado** contra el
  AACS conformante (Python): da el **mismo veredicto** sobre la API real (FAIL, 20 tools, 21 pares
  J_shape, 1 undisciplined).
- Es un gate de **forma**: condición **necesaria, no suficiente**. Que pase no garantiza un buen MCP
  (un god-tool por operación también pasa) — mide que la superficie no sea el volcado 1:1.
- La **aptitud real para un modelo dado** se mide con un eval empírico (correr ese modelo contra la
  superficie), fuera de este gate.
