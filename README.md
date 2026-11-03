# intgen

CLI que genera interfaces TypeScript (y opcionalmente schemas Zod) a partir
de un JSON, ya sea un archivo local o la respuesta de una URL.

## Requisitos

Node.js >= 18 (usa el `fetch` global y el test runner `node:test` incluidos desde esa versión).

## Instalación
npm install -g @yiuseppedev/interface-generator

## Uso
intgen -i input.json -o output.ts
intgen -u https://example.com/data.json -o output.ts
intgen -i input.json -o output.ts -c camel
intgen -i input.json -o output.ts -s zod
intgen -u https://api.example.com/me -H "Authorization: Bearer $TOKEN" -o src/types/me.ts
curl -s https://api.example.com/me | intgen -i - -o - -n Me

## Opciones

| Flag | Descripción | Por defecto |
|------|-------------|-------------|
| `-i, --input <path>` | Ruta a un archivo JSON local (`-` lee de stdin). Requerido si no se usa `-u`. | — |
| `-u, --url <url>` | URL de la que se obtiene el JSON. Requerido si no se usa `-i`. | — |
| `-m, --method <method>` | Método HTTP usado al pedir `-u`. | `GET` |
| `-H, --header <header>` | Header HTTP para `-u`, con formato `"Nombre: valor"`. Repetible. | — |
| `-o, --output <path>` | Ruta del archivo `.ts`/`.d.ts` de salida. Obligatorio. `-` escribe a stdout. | — |
| `-n, --name <name>` | Nombre de la interfaz (u objeto item, si el JSON raíz es un array) raíz. | `GeneratedInterface` |
| `-c, --casing <mode>` | Convención de las *property keys* generadas: `original` o `camel`. Nunca afecta los nombres de interfaz. | `original` |
| `-s, --schema <kind>` | Genera además un schema adicional en el mismo archivo. Único valor soportado hoy: `zod`. | — (desactivado) |

Si falta `-i`/`-u` o `-o`, `intgen` termina con código de salida `1` y un
mensaje de error explicando qué falta — no intenta adivinar valores por defecto.

## Comportamiento con arrays de objetos

Cuando el JSON raíz o un campo es un array de objetos, `intgen` analiza hasta
50 elementos de muestra (no solo el primero) para inferir el tipo:

- Si un campo no aparece en todos los objetos, se marca como opcional (`key?: type`).
- Si un campo tiene distintos tipos entre los objetos, se genera una unión (`key: string | number`).

```json
[{ "id": 1, "name": "a" }, { "id": 2, "name": "b", "tag": "x" }]
```

```ts
export interface RootItem {
  id: number;
  name: string;
  tag?: string;
}
export type Root = RootItem[];
```

## Modo Zod (`-s zod`)

Con `-s zod`, además de las interfaces TypeScript se genera un schema
[Zod](https://zod.dev) equivalente (`export const XSchema = z.object({...})`)
en el mismo archivo de salida. `intgen` no depende de `zod`: si vas a usar el
schema generado, instálalo en tu propio proyecto con `npm install zod`.

## Uso programático

`bin/index.js` exporta `generate(data, options)`, que hace lo mismo que el
CLI pero sin tocar disco ni red — recibe el JSON ya parseado y devuelve el
string con las interfaces (y el schema Zod, si aplica):

```js
const { generate } = require('@yiuseppedev/interface-generator/bin');

const ts = generate({ id: 1, name: 'a' }, { name: 'User', casing: 'camel', schema: 'zod' });
```

`options` acepta las mismas tres cosas que configuran el CLI: `name`,
`casing` (`'original' | 'camel'`) y `schema` (`'zod'` u omitido). Si `data`
no es un objeto ni un array de objetos, `generate` lanza un `Error` con un
mensaje descriptivo en vez de devolver una interfaz vacía o incorrecta.

## Uso con agentes de IA (Claude Code, Claude Desktop, Cursor…)

Escribir tipos a mano a partir de un JSON grande es justo el tipo de tarea
donde un LLM gasta tokens y puede inventar campos. `intgen` lo hace de forma
determinista, y — clave para agentes — **el JSON no tiene que pasar por el
contexto del modelo**: el agente le pasa una URL o un path y recibe solo el
código (o solo un resumen, si escribe directo a disco).

El paquete trae tres piezas:

| Pieza | Para qué |
|-------|----------|
| `intgen-mcp` | Servidor [MCP](https://modelcontextprotocol.io) por stdio con la tool `generate_types` (sin dependencias extra). |
| `skills/intgen/SKILL.md` | Skill de Claude Code: le enseña al agente cuándo usar `intgen`, cómo elegir nombre/casing/zod y cómo revisar el resultado. |
| `.claude-plugin/` | Manifiesto de plugin + marketplace que instala la skill y el servidor MCP de una vez. |

### Opción 1 — Plugin de Claude Code (skill + MCP)

```
/plugin marketplace add JosephAnderson234/interface-generator
/plugin install intgen@intgen
```

### Opción 2 — Solo el servidor MCP

Claude Code:

```bash
claude mcp add intgen -- npx -y -p @yiuseppedev/interface-generator intgen-mcp
```

Claude Desktop / Cursor / cualquier cliente MCP (`mcpServers` en su config):

```json
{
  "mcpServers": {
    "intgen": {
      "command": "npx",
      "args": ["-y", "-p", "@yiuseppedev/interface-generator", "intgen-mcp"]
    }
  }
}
```

La tool `generate_types` acepta exactamente una fuente — `json` (texto
inline), `file` (path local) o `url` (+ `method`, `headers`) — y las mismas
opciones del CLI: `name`, `casing`, `schema`. Con `output_path` escribe el
archivo y devuelve solo `Wrote N exports to <path>: ...`. Los errores
(JSON inválido, raíz primitiva, HTTP != 2xx) vuelven como resultado con
`isError: true`, así el modelo puede leerlos y corregir.

### Opción 3 — Solo la skill

Copia `skills/intgen/` a `.claude/skills/intgen/` de tu proyecto (o a
`~/.claude/skills/intgen/` para todos). La skill usa `npx`, así que no hace
falta instalar nada más.

## Tests

```
npm test
```

Corre la suite con el test runner nativo de Node (`node --test`, sin
dependencias adicionales): tests unitarios sobre `generate()` para uniones de
tipo, opcionalidad, casing y el modo Zod, más un puñado de tests de
integración que invocan el binario real para validar el parseo de opciones de
`commander` (`--output` obligatorio, `--method`, `--version`).