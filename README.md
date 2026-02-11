## Instalación
npm install -g intgen

## Uso
intgen -i input.json -o output.ts
intgen -u https://example.com/data.json -o output.ts

## Opciones
- -i, --input   Archivo JSON
- -u, --url     URL con JSON
- -o, --output  Archivo TypeScript
- -m, --method  Método HTTP para la URL (por defecto: GET)