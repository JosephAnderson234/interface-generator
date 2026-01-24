#!/usr/bin/env node
const { Command } = require("commander");
const fs = require("fs");

const program = new Command();

program
  .name("intgen")
  .description("Generador de interfaces TypeScript desde JSON")
  .version("1.0.0")
  .option('-i, --input <path>', 'Ruta al archivo JSON')
  .option('-o, --output <path>', 'Ruta de salida (.ts o .d.ts)')
  .option('-n, --name <name>', 'Nombre de la interfaz', 'GeneratedInterface')
  .action((options) => {
    try {
      const jsonContent = fs.readFileSync(options.input, 'utf-8');
      const jsonData = JSON.parse(jsonContent);
      
      const tsInterface = generateInterface(jsonData, options.name);
      
      fs.writeFileSync(options.output, tsInterface);
      console.log(`✓ Interfaz generada en ${options.output}`);
    } catch (error) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

function generateInterface(obj, name, interfaces = new Map()) {
  let properties = '';
  
  for (const [key, value] of Object.entries(obj)) {
    const typeInfo = inferType(value, key, interfaces);
    properties += `  ${key}: ${typeInfo};\n`;
  }
  
  const mainInterface = `export interface ${name} {\n${properties}}\n`;
  interfaces.set(name, mainInterface);
  
  return Array.from(interfaces.values()).join('\n');
}

function inferType(value, key = '', interfaces = new Map()) {

  if (value === null) return 'null';
  if (value === undefined) return 'undefined';

  if (Array.isArray(value)) {
    if (value.length === 0) return 'any[]';
    
    const firstElement = value[0];

    if (typeof firstElement === 'object' && firstElement !== null && !Array.isArray(firstElement)) {
      const interfaceName = key.charAt(0).toUpperCase() + key.slice(1).replace(/s$/, '');
      generateInterface(firstElement, interfaceName, interfaces);
      return `${interfaceName}[]`;
    }
    

    return `${inferType(firstElement, '', interfaces)}[]`;
  }

  if (typeof value === 'object' && value !== null) {
    const interfaceName = key.charAt(0).toUpperCase() + key.slice(1);
    generateInterface(value, interfaceName, interfaces);
    return interfaceName;
  }

  const type = typeof value;
  if (type === 'string') return 'string';
  if (type === 'number') return 'number';
  if (type === 'boolean') return 'boolean';
  if (type === 'bigint') return 'bigint';
  if (type === 'symbol') return 'symbol';
  
  return 'any';
}

program.parse();