#!/usr/bin/env node
// Minimal MCP (Model Context Protocol) server over stdio for intgen.
//
// Exposes the generator as a tool so AI agents (Claude Code, Claude Desktop,
// Cursor, etc.) can turn a JSON payload — inline, a local file, or a URL —
// into TypeScript interfaces / Zod schemas without reading the whole payload
// into their context window.
//
// Implemented directly on JSON-RPC 2.0 (newline-delimited, per the MCP stdio
// transport) to keep the package dependency-free beyond `commander`.
// IMPORTANT: stdout is the protocol channel — never console.log() here.

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { generate, loadJsonData } = require('./index.js');
const pkg = require(path.join(__dirname, '..', 'package.json'));

const SUPPORTED_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];

const TOOLS = [
	{
		name: 'generate_types',
		title: 'Generate TypeScript types from JSON',
		description:
			'Infers TypeScript interfaces (and optionally Zod schemas) from a JSON sample. ' +
			'Provide exactly one source: `json` (inline JSON text), `file` (path to a local .json file) ' +
			'or `url` (fetched server-side, so large API responses never enter your context). ' +
			'Arrays of objects are sampled (up to 50 items) to detect optional fields and union types. ' +
			'Pass `output_path` to write the result straight to disk and get back only a short summary.',
		inputSchema: {
			type: 'object',
			properties: {
				json: { type: 'string', description: 'Inline JSON text to infer types from.' },
				file: { type: 'string', description: 'Path to a local JSON file (relative to the server cwd or absolute).' },
				url: { type: 'string', description: 'URL that returns JSON.' },
				method: { type: 'string', description: 'HTTP method for `url`.', default: 'GET' },
				headers: {
					type: 'object',
					description: 'HTTP headers for `url`, e.g. {"Authorization": "Bearer ..."}.',
					additionalProperties: { type: 'string' },
				},
				name: {
					type: 'string',
					description: 'Name of the root interface (or root type alias when the JSON root is an array).',
					default: 'GeneratedInterface',
				},
				casing: {
					type: 'string',
					enum: ['original', 'camel'],
					description: 'Property key convention. Never affects interface names.',
					default: 'original',
				},
				schema: {
					type: 'string',
					enum: ['zod'],
					description: 'Also emit Zod schemas in the same output.',
				},
				output_path: {
					type: 'string',
					description: 'If set, write the generated code to this path (.ts/.d.ts) and return only a summary.',
				},
			},
			additionalProperties: false,
		},
	},
];

function send(message) {
	process.stdout.write(JSON.stringify(message) + '\n');
}

function reply(id, result) {
	send({ jsonrpc: '2.0', id, result });
}

function replyError(id, code, message) {
	send({ jsonrpc: '2.0', id, error: { code, message } });
}

function exportedNames(code) {
	const names = [];
	for (const m of code.matchAll(/^export (?:interface|type|const) (\w+)/gm)) names.push(m[1]);
	return names;
}

async function callGenerateTypes(args = {}) {
	const sources = ['json', 'file', 'url'].filter((k) => args[k] !== undefined && args[k] !== '');
	if (sources.length !== 1) {
		throw new Error('Provide exactly one of `json`, `file` or `url`.');
	}

	let data;
	if (args.json !== undefined) {
		try {
			data = JSON.parse(args.json);
		} catch (error) {
			throw new Error(`\`json\` is not valid JSON: ${error.message}`);
		}
	} else {
		data = await loadJsonData({
			input: args.file,
			url: args.url,
			method: args.method,
			headers: args.headers,
		});
	}

	const casing = args.casing === 'camel' ? 'camel' : 'original';
	const code = generate(data, { name: args.name || 'GeneratedInterface', casing, schema: args.schema });

	if (args.output_path) {
		const target = path.resolve(args.output_path);
		fs.mkdirSync(path.dirname(target), { recursive: true });
		fs.writeFileSync(target, code);
		const names = exportedNames(code);
		return `Wrote ${names.length} exports to ${target}: ${names.join(', ')}`;
	}

	return code;
}

async function handle(message) {
	const { id, method, params } = message;
	const isNotification = id === undefined || id === null;

	switch (method) {
		case 'initialize': {
			const requested = params && params.protocolVersion;
			const protocolVersion = SUPPORTED_PROTOCOL_VERSIONS.includes(requested)
				? requested
				: SUPPORTED_PROTOCOL_VERSIONS[0];
			return reply(id, {
				protocolVersion,
				capabilities: { tools: {} },
				serverInfo: { name: 'intgen', version: pkg.version },
				instructions:
					'Use generate_types whenever you need TypeScript types or Zod schemas for a JSON payload. ' +
					'Prefer `url` or `file` over pasting large JSON inline, and `output_path` to avoid echoing big files.',
			});
		}
		case 'ping':
			return reply(id, {});
		case 'tools/list':
			return reply(id, { tools: TOOLS });
		case 'tools/call': {
			const name = params && params.name;
			if (name !== 'generate_types') {
				return replyError(id, -32602, `Unknown tool: ${name}`);
			}
			try {
				const text = await callGenerateTypes(params.arguments);
				return reply(id, { content: [{ type: 'text', text }] });
			} catch (error) {
				// Tool-level failures are reported in-band so the model can read and recover.
				return reply(id, { content: [{ type: 'text', text: `Error: ${error.message}` }], isError: true });
			}
		}
		default:
			if (isNotification) return; // e.g. notifications/initialized, notifications/cancelled
			return replyError(id, -32601, `Method not found: ${method}`);
	}
}

function main() {
	const rl = readline.createInterface({ input: process.stdin, terminal: false });
	rl.on('line', (line) => {
		if (!line.trim()) return;
		let message;
		try {
			message = JSON.parse(line);
		} catch {
			return replyError(null, -32700, 'Parse error');
		}
		handle(message).catch((error) => {
			if (message && message.id != null) replyError(message.id, -32603, error.message);
		});
	});
}

if (require.main === module) {
	main();
}

module.exports = { callGenerateTypes, TOOLS };
