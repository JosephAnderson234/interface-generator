---
name: intgen
description: Generate TypeScript interfaces and/or Zod schemas from a real JSON payload (API response, fixture, config file, webhook sample) instead of hand-writing them. Use when the user asks to "type this response", "create interfaces/types/DTOs for this endpoint/JSON", "add a Zod schema for this payload", or when you are about to write types by reading a large JSON sample.
---

# intgen — JSON → TypeScript / Zod

`intgen` infers types deterministically from real data. Use it instead of
writing interfaces by eye: it is faster, it does not hallucinate fields, and it
keeps big payloads **out of your context window**.

## Pick the right entry point

1. **MCP tool available** (`generate_types` from the `intgen` server) → use it.
2. **Otherwise** use the CLI through npx (no install needed):
   ```bash
   npx -y @yiuseppedev/interface-generator <flags>
   ```
   If `intgen` is already on PATH, call it directly.

## Golden rule: don't load the JSON yourself

- Payload is at a **URL** → pass the URL (`url` / `-u`). Add auth with
  `headers` / `-H "Authorization: Bearer $TOKEN"`. Never paste secrets into the
  generated file or the chat; read tokens from env vars.
- Payload is a **file** → pass the path (`file` / `-i path.json`).
- Payload comes from **another command** → pipe it: `curl -s ... | intgen -i - -o -`.
- Only use inline `json` for small samples the user pasted.
- Write straight to the destination (`output_path` / `-o src/types/user.ts`)
  and read back only what you need, rather than echoing the whole result.

## Flags (CLI) ↔ arguments (MCP)

| CLI | MCP arg | Notes |
|-----|---------|-------|
| `-i <path>` / `-i -` | `file` | `-` = stdin |
| `-u <url>` | `url` | |
| `-m <method>` | `method` | default `GET` |
| `-H "K: v"` (repeatable) | `headers` (object) | |
| `-o <path>` / `-o -` | `output_path` | CLI requires `-o`; `-` = stdout |
| `-n <Name>` | `name` | root interface name, PascalCase |
| `-c camel` | `casing: "camel"` | only property keys change |
| `-s zod` | `schema: "zod"` | user project needs `zod` installed |

## Workflow

1. Find where the project keeps types (`src/types`, `types/`, next to the API
   client…) and match its naming. Choose a meaningful `name` (`User`, not
   `GeneratedInterface`). If the root is an array, `name` becomes the array
   alias and items get `<Name>Item` (or the singular, if `name` ends in `s`).
2. Match the project's key convention: if the code base uses camelCase
   *and* transforms responses, use `camel`; if it consumes raw API JSON, keep
   `original` (the types must match the wire format).
3. Use `schema: zod` when the project already depends on `zod` or the user
   wants runtime validation.
4. Generate, then **review and tidy** the output:
   - Fields seen only as `null` come out as `null`; widen them to the likely
     type (`string | null`) if you know it.
   - Empty arrays come out as `any[]`; replace with the real element type if known.
   - Auto-suffixed names (`Name2`) mean two different shapes shared a key;
     rename them to something meaningful (`CompanyName`).
   - Only the first 50 items of any array are sampled. If the user says a
     field is optional/nullable, trust them over the sample.
5. Run the project's type-check (`tsc --noEmit` or equivalent) if you wired
   the types into existing code.

## Examples

```bash
# Public endpoint → file
npx -y @yiuseppedev/interface-generator -u https://api.example.com/users -n Users -o src/types/users.ts

# Authenticated endpoint, with Zod
npx -y @yiuseppedev/interface-generator -u "$API/orders/1" -H "Authorization: Bearer $API_TOKEN" -n Order -s zod -o src/schemas/order.ts

# Pipe from another tool, print to stdout
curl -s https://api.example.com/me | npx -y @yiuseppedev/interface-generator -i - -o - -n Me
```

Programmatic (Node, e.g. inside a codegen script):

```js
const { generate } = require('@yiuseppedev/interface-generator/bin');
const code = generate(data, { name: 'User', casing: 'camel', schema: 'zod' });
```
