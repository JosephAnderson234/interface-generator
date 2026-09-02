#!/usr/bin/env node
const { Command } = require("commander");
const fs = require("fs");
const path = require("path");
const pkg = require(path.join(__dirname, "..", "package.json"));

const program = new Command();

// How many samples of an array we inspect to infer unions/optionality,
// so a huge JSON array doesn't get walked in full just to infer types.
const MAX_SAMPLES = 50;

program
	.name("intgen")
	.description("Generador de interfaces TypeScript desde JSON")
	.version(pkg.version)
	.option('-i, --input <path>', 'Ruta al archivo JSON')
	.option('-u, --url <url>', 'URL para obtener el JSON')
	.option('-m, --method <method>', 'Método HTTP para la URL', 'GET')
	.option('-o, --output <path>', 'Ruta de salida (.ts o .d.ts)')
	.option('-n, --name <name>', 'Nombre de la interfaz', 'GeneratedInterface')
	.option('-c, --casing <mode>', 'Convención para las keys de salida (original|camel)', 'original')
	.option('-s, --schema <kind>', 'Generar también un schema adicional junto a la interfaz (zod)')
	.action(async (options) => {
		try {
			if (!options.output) {
				throw new Error('Debes indicar --output (-o) con la ruta de salida.');
			}

			const jsonData = await loadJsonData(options);
			const casing = options.casing === 'camel' ? 'camel' : 'original';
			const output = generate(jsonData, { name: options.name, casing, schema: options.schema });

			fs.writeFileSync(options.output, output);
			console.log(`✓ Interfaz generada en ${options.output}`);
		} catch (error) {
			console.error(`Error: ${error.message}`);
			process.exit(1);
		}
	});

async function loadJsonData(options) {
	if (options.url) {
		const response = await fetch(options.url, { method: options.method });
		if (!response.ok) {
			throw new Error(`No se pudo obtener JSON (${response.status})`);
		}
		return response.json();
	}

	if (options.input) {
		const jsonContent = fs.readFileSync(options.input, 'utf-8');
		return JSON.parse(jsonContent);
	}

	throw new Error('Debes indicar --input o --url');
}

const IDENTIFIER_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

function formatKey(key) {
	return IDENTIFIER_RE.test(key) ? key : JSON.stringify(key);
}

function capitalize(key) {
	return key ? key.charAt(0).toUpperCase() + key.slice(1) : 'Item';
}

function toCamelCase(key) {
	return key.replace(/[-_\s]+(.)/g, (_, c) => c.toUpperCase());
}

function applyCasing(key, casing) {
	return casing === 'camel' ? toCamelCase(key) : key;
}

// Name used for the synthetic interface built from an array's elements,
// e.g. key "cats" -> "Cat". Only applies to array-of-objects, never to a
// plain nested object (which keeps its unstripped, singular-agnostic name).
function deriveArrayItemBaseName(key) {
	const stripped = capitalize(key).replace(/s$/, '');
	return stripped || 'Item';
}

// ---- type descriptors -------------------------------------------------
// { kind: 'primitive', name }        e.g. string, number, null, any...
// { kind: 'ref', name }              reference to an interface in `interfaces`
// { kind: 'array', of: descriptor }
// { kind: 'union', options: [descriptor, ...] }  (deduplicated, length >= 2)

function descriptorKey(d) {
	if (d.kind === 'primitive') return `p:${d.name}`;
	if (d.kind === 'ref') return `r:${d.name}`;
	if (d.kind === 'array') return `a:${descriptorKey(d.of)}`;
	return `u:${d.options.map(descriptorKey).sort().join(',')}`;
}

function unionOf(descriptors) {
	const seen = new Map();
	for (const d of descriptors) {
		const k = descriptorKey(d);
		if (!seen.has(k)) seen.set(k, d);
	}
	const deduped = Array.from(seen.values());
	if (deduped.length === 0) return { kind: 'primitive', name: 'any' };
	if (deduped.length === 1) return deduped[0];
	return { kind: 'union', options: deduped };
}

function fieldsSignature(fields) {
	return fields
		.map((f) => `${f.key}:${f.optional ? '?' : ''}${descriptorKey(f.type)}`)
		.sort()
		.join('|');
}

// Returns a name safe to use in `interfaces`: reuses `baseName` if it's free
// or already describes the same shape, otherwise finds a free suffixed name
// (so e.g. `user.name` and `company.name`, with different shapes, don't collide).
function resolveInterfaceName(baseName, signature, interfaces) {
	const existing = interfaces.get(baseName);
	if (!existing || existing.signature === signature) return baseName;

	let i = 2;
	let candidate = `${baseName}${i}`;
	while (interfaces.has(candidate) && interfaces.get(candidate).signature !== signature) {
		i++;
		candidate = `${baseName}${i}`;
	}
	return candidate;
}

// Infers a type descriptor from one or more sample values seen at the same
// logical slot (a single property value, or every element of an array /
// every value a given key took across several sampled objects). Sample
// objects are merged into one interface with optional fields for keys that
// aren't present everywhere; sample values of different kinds become a union.
function resolveType(values, key, interfaces, casing) {
	values = values.slice(0, MAX_SAMPLES);

	const objectSamples = [];
	const arrayElementSamples = [];
	const otherDescriptors = [];
	let sawArray = false;

	for (const value of values) {
		if (value === null) { otherDescriptors.push({ kind: 'primitive', name: 'null' }); continue; }
		if (value === undefined) { otherDescriptors.push({ kind: 'primitive', name: 'undefined' }); continue; }

		if (Array.isArray(value)) {
			sawArray = true;
			for (const el of value.slice(0, MAX_SAMPLES)) arrayElementSamples.push(el);
			continue;
		}

		if (typeof value === 'object') { objectSamples.push(value); continue; }

		const type = typeof value;
		if (type === 'string') otherDescriptors.push({ kind: 'primitive', name: 'string' });
		else if (type === 'number') otherDescriptors.push({ kind: 'primitive', name: 'number' });
		else if (type === 'boolean') otherDescriptors.push({ kind: 'primitive', name: 'boolean' });
		else if (type === 'bigint') otherDescriptors.push({ kind: 'primitive', name: 'bigint' });
		else if (type === 'symbol') otherDescriptors.push({ kind: 'primitive', name: 'symbol' });
		else otherDescriptors.push({ kind: 'primitive', name: 'any' });
	}

	const descriptors = [...otherDescriptors];

	if (objectSamples.length > 0) {
		descriptors.push(buildObjectInterface(objectSamples, capitalize(key), interfaces, casing));
	}

	if (sawArray) {
		if (arrayElementSamples.length === 0) {
			descriptors.push({ kind: 'array', of: { kind: 'primitive', name: 'any' } });
		} else {
			const itemBaseName = deriveArrayItemBaseName(key);
			const elementType = resolveType(arrayElementSamples, itemBaseName, interfaces, casing);
			descriptors.push({ kind: 'array', of: elementType });
		}
	}

	return unionOf(descriptors);
}

// Merges N sample objects (all sharing the same logical slot) into a single
// interface: union of keys, `optional` for keys not present in every sample.
function buildObjectInterface(objects, baseName, interfaces, casing) {
	objects = objects.slice(0, MAX_SAMPLES);

	const keys = new Set();
	for (const obj of objects) for (const k of Object.keys(obj)) keys.add(k);

	const fields = [];
	for (const key of keys) {
		const valuesForKey = [];
		let presentCount = 0;
		for (const obj of objects) {
			if (Object.prototype.hasOwnProperty.call(obj, key)) {
				presentCount++;
				valuesForKey.push(obj[key]);
			}
		}
		const type = resolveType(valuesForKey, key, interfaces, casing);
		fields.push({ key: applyCasing(key, casing), type, optional: presentCount < objects.length });
	}

	const signature = fieldsSignature(fields);
	const name = resolveInterfaceName(baseName, signature, interfaces);
	if (!interfaces.has(name) || interfaces.get(name).signature !== signature) {
		interfaces.set(name, { name, fields, signature });
	}
	return { kind: 'ref', name };
}

function buildRootInterface(obj, name, interfaces, casing) {
	const fields = Object.keys(obj).map((key) => ({
		key: applyCasing(key, casing),
		type: resolveType([obj[key]], key, interfaces, casing),
		optional: false,
	}));
	interfaces.set(name, { name, fields, signature: fieldsSignature(fields) });
}

// Returns null when the root was an object (already registered as `name` in
// `interfaces`), or { name, type } when the root was an array, meaning the
// caller still needs to render `export type <name> = <type>;`.
function generateFromRoot(data, name, interfaces, casing) {
	if (data === null || typeof data !== 'object') {
		throw new Error('El JSON raíz debe ser un objeto o un array de objetos, no un valor primitivo.');
	}

	if (Array.isArray(data)) {
		if (data.length === 0) {
			return { name, type: { kind: 'array', of: { kind: 'primitive', name: 'any' } } };
		}

		const items = data.slice(0, MAX_SAMPLES);
		const baseItemName = name.endsWith('s') ? name.slice(0, -1) : `${name}Item`;
		const elementType = resolveType(items, baseItemName, interfaces, casing);
		return { name, type: { kind: 'array', of: elementType } };
	}

	buildRootInterface(data, name, interfaces, casing);
	return null;
}

// ---- TypeScript rendering ----------------------------------------------

function renderTs(descriptor) {
	if (descriptor.kind === 'primitive') return descriptor.name;
	if (descriptor.kind === 'ref') return descriptor.name;
	if (descriptor.kind === 'array') {
		const inner = renderTs(descriptor.of);
		return descriptor.of.kind === 'union' ? `(${inner})[]` : `${inner}[]`;
	}
	return descriptor.options.map(renderTs).join(' | ');
}

function renderInterfaceTs(entry) {
	let properties = '';
	for (const f of entry.fields) {
		properties += `  ${formatKey(f.key)}${f.optional ? '?' : ''}: ${renderTs(f.type)};\n`;
	}
	return `export interface ${entry.name} {\n${properties}}\n`;
}

function renderAllTs(interfaces, rootAlias) {
	const blocks = Array.from(interfaces.values()).map(renderInterfaceTs);
	if (rootAlias) blocks.push(`export type ${rootAlias.name} = ${renderTs(rootAlias.type)};\n`);
	return blocks.join('\n');
}

// ---- Zod rendering (coexists with the TS interfaces above) -------------

function renderZodPrimitive(name) {
	switch (name) {
		case 'string': return 'z.string()';
		case 'number': return 'z.number()';
		case 'boolean': return 'z.boolean()';
		case 'null': return 'z.null()';
		case 'undefined': return 'z.undefined()';
		case 'bigint': return 'z.bigint()';
		default: return 'z.any()';
	}
}

function renderZodType(descriptor) {
	if (descriptor.kind === 'primitive') return renderZodPrimitive(descriptor.name);
	if (descriptor.kind === 'ref') return `${descriptor.name}Schema`;
	if (descriptor.kind === 'array') return `z.array(${renderZodType(descriptor.of)})`;
	return `z.union([${descriptor.options.map(renderZodType).join(', ')}])`;
}

function renderInterfaceZod(entry) {
	let properties = '';
	for (const f of entry.fields) {
		properties += `  ${formatKey(f.key)}: ${renderZodType(f.type)}${f.optional ? '.optional()' : ''},\n`;
	}
	return `export const ${entry.name}Schema = z.object({\n${properties}});\n`;
}

function renderAllZod(interfaces, rootAlias) {
	const blocks = ['import { z } from "zod";', ''];
	for (const entry of interfaces.values()) blocks.push(renderInterfaceZod(entry));
	if (rootAlias) blocks.push(`export const ${rootAlias.name}Schema = ${renderZodType(rootAlias.type)};\n`);
	return blocks.join('\n');
}

// Core generation entry point, decoupled from the CLI so it can be
// `require()`d (by tests, or any programmatic consumer) without triggering
// commander's argv parsing.
function generate(data, { name = 'GeneratedInterface', casing = 'original', schema } = {}) {
	const interfaces = new Map();
	const rootAlias = generateFromRoot(data, name, interfaces, casing);

	let output = renderAllTs(interfaces, rootAlias);
	if (schema === 'zod') {
		output += '\n' + renderAllZod(interfaces, rootAlias);
	}
	return output;
}

if (require.main === module) {
	program.parse();
}

module.exports = { generate };
