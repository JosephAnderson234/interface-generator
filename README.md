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

## Opciones

| Flag | Descripción | Por defecto |
|------|-------------|-------------|
| `-i, --input <path>` | Ruta a un archivo JSON local. Requerido si no se usa `-u`. | — |
| `-u, --url <url>` | URL de la que se obtiene el JSON. Requerido si no se usa `-i`. | — |
| `-m, --method <method>` | Método HTTP usado al pedir `-u`. | `GET` |
| `-o, --output <path>` | Ruta del archivo `.ts`/`.d.ts` de salida. Obligatorio. | — |
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

## Tests

```
npm test
```

Corre la suite con el test runner nativo de Node (`node --test`, sin
dependencias adicionales): tests unitarios sobre `generate()` para uniones de
tipo, opcionalidad, casing y el modo Zod, más un puñado de tests de
integración que invocan el binario real para validar el parseo de opciones de
`commander` (`--output` obligatorio, `--method`, `--version`).