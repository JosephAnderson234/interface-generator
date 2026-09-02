const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { generate } = require('../bin/index.js');

const BIN = path.join(__dirname, '..', 'bin', 'index.js');

function runCli(args, options = {}) {
	try {
		const stdout = execFileSync('node', [BIN, ...args], { encoding: 'utf-8', ...options });
		return { status: 0, stdout, stderr: '' };
	} catch (error) {
		return { status: error.status, stdout: error.stdout ?? '', stderr: error.stderr ?? '' };
	}
}

// ---- unión de tipos en arrays heterogéneos ------------------------------

test('arrays de objetos con formas distintas generan una unión de tipos', () => {
	const output = generate([{ a: 1 }, { a: 'x', b: true }], { name: 'Root' });
	assert.match(output, /a: number \| string;/);
	assert.match(output, /b\?: boolean;/);
});

test('array de primitivos heterogéneos genera una unión entre paréntesis', () => {
	const output = generate({ vals: [1, 'a', true] }, { name: 'Root' });
	assert.match(output, /vals: \(number \| string \| boolean\)\[\];/);
});

// ---- detección de opcionalidad ------------------------------------------

test('un campo ausente en algún objeto del array se marca opcional', () => {
	const output = generate([{ a: 1, b: 2 }, { a: 3 }], { name: 'Root' });
	assert.match(output, /a: number;/);
	assert.match(output, /b\?: number;/);
});

test('un campo presente en todos los objetos NO se marca opcional', () => {
	const output = generate([{ a: 1 }, { a: 2 }], { name: 'Root' });
	assert.doesNotMatch(output, /a\?:/);
});

// ---- casing configurable -------------------------------------------------

test('casing camel convierte snake_case y kebab-case a camelCase', () => {
	const output = generate({ user_name: 'x', 'tag-id': 1 }, { name: 'Root', casing: 'camel' });
	assert.match(output, /userName: string;/);
	assert.match(output, /tagId: number;/);
});

test('sin casing (original) las keys no cambian', () => {
	const output = generate({ user_name: 'x', 'tag-id': 1 }, { name: 'Root' });
	assert.match(output, /user_name: string;/);
	assert.match(output, /"tag-id": number;/);
});

test('casing nunca afecta los nombres de interfaz, solo las property keys', () => {
	const output = generate({ user_profile: { first_name: 'a' } }, { name: 'Root', casing: 'camel' });
	// El nombre de interfaz se deriva de la key original (sin camelCase); solo la property key cambia.
	assert.match(output, /export interface User_profile/);
	assert.match(output, /firstName: string;/);
	assert.match(output, /userProfile: User_profile;/);
});

// ---- modo Zod (coexiste con la interfaz TS) ------------------------------

test('schema zod agrega un z.object por interfaz, sin quitar las interfaces TS', () => {
	const output = generate({ user: { name: 'a', age: 30 }, tags: ['x'] }, { name: 'Root', schema: 'zod' });
	assert.match(output, /export interface User \{/);
	assert.match(output, /export interface Root \{/);
	assert.match(output, /import \{ z \} from "zod";/);
	assert.match(output, /export const UserSchema = z\.object\(\{/);
	assert.match(output, /name: z\.string\(\),/);
	assert.match(output, /age: z\.number\(\),/);
	assert.match(output, /export const RootSchema = z\.object\(\{/);
	assert.match(output, /user: UserSchema,/);
	assert.match(output, /tags: z\.array\(z\.string\(\)\),/);
});

test('sin --schema no se genera ningún bloque zod', () => {
	const output = generate({ a: 1 }, { name: 'Root' });
	assert.doesNotMatch(output, /zod/);
});

test('zod marca campos opcionales con .optional()', () => {
	const output = generate([{ a: 1, b: 2 }, { a: 3 }], { name: 'Root', schema: 'zod' });
	assert.match(output, /b: z\.number\(\)\.optional\(\),/);
});

// ---- regresión: colisión de nombres de interfaz --------------------------

test('objetos hermanos con el mismo key pero distinta forma no se pisan', () => {
	const output = generate(
		{ user: { name: { first: 'a' } }, company: { name: { legal: 'b' } } },
		{ name: 'Root' }
	);
	assert.match(output, /export interface Name \{\n {2}first: string;\n\}/);
	assert.match(output, /export interface Name2 \{\n {2}legal: string;\n\}/);
	assert.match(output, /export interface User \{\n {2}name: Name;\n\}/);
	assert.match(output, /export interface Company \{\n {2}name: Name2;\n\}/);
});

// ---- regresión: JSON raíz array/primitivo --------------------------------

test('JSON raíz array de objetos genera <Name>Item + type alias', () => {
	const output = generate([{ id: 1, name: 'a' }, { id: 2, name: 'b' }], { name: 'Root' });
	assert.match(output, /export interface RootItem \{/);
	assert.match(output, /export type Root = RootItem\[\];/);
});

test('JSON raíz primitivo lanza un error claro', () => {
	assert.throws(() => generate('solo un string', { name: 'Root' }), /El JSON raíz debe ser un objeto/);
	assert.throws(() => generate(42, { name: 'Root' }), /El JSON raíz debe ser un objeto/);
	assert.throws(() => generate(null, { name: 'Root' }), /El JSON raíz debe ser un objeto/);
});

test('array raíz vacío genera un alias any[]', () => {
	const output = generate([], { name: 'Root' });
	assert.match(output, /export type Root = any\[\];/);
});

// ---- regresión: keys inválidas como identificador ------------------------

test('keys que no son identificadores JS válidos se citan', () => {
	const output = generate({ 'weird-key': 1, valid_key: 2 }, { name: 'Root' });
	assert.match(output, /"weird-key": number;/);
	assert.match(output, /valid_key: number;/);
});

// ---- cap de muestreo (MAX_SAMPLES) ----------------------------------------

test('solo se muestrean hasta 50 elementos de un array al inferir el tipo', () => {
	const items = Array.from({ length: 60 }, (_, i) => (i === 55 ? { a: 'texto' } : { a: 1 }));
	const output = generate(items, { name: 'Root' });
	// El elemento 55 (fuera de las primeras 50 muestras) no debe introducir una unión.
	assert.match(output, /a: number;/);
	assert.doesNotMatch(output, /a: number \| string;/);
});

// ---- integración CLI (comportamiento que solo existe a nivel commander) --

test('CLI: falta --output produce exit code 1 y mensaje claro', () => {
	const result = runCli(['-i', path.join(__dirname, 'test.json')]);
	assert.equal(result.status, 1);
	assert.match(result.stderr, /Debes indicar --output/);
});

test('CLI: -m/--method quedan disponibles como opciones válidas', () => {
	const help = execFileSync('node', [BIN, '--help'], { encoding: 'utf-8' });
	assert.match(help, /-m, --method <method>/);
});

test('CLI: --version refleja la versión de package.json', () => {
	const pkg = require('../package.json');
	const version = execFileSync('node', [BIN, '--version'], { encoding: 'utf-8' }).trim();
	assert.equal(version, pkg.version);
});

test('CLI: genera un archivo real a partir de test.json', () => {
	const os = require('node:os');
	const fs = require('node:fs');
	const outPath = path.join(os.tmpdir(), `intgen-test-${Date.now()}.ts`);
	const result = runCli(['-i', path.join(__dirname, 'test.json'), '-o', outPath, '-n', 'InterfaceTest']);
	assert.equal(result.status, 0);
	const content = fs.readFileSync(outPath, 'utf-8');
	assert.match(content, /export interface InterfaceTest \{/);
	fs.unlinkSync(outPath);
});
