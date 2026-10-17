/**
 * Subcomandos locais do `fluig-mcp` (passos 5.2 e 5.3): `regenerar`, `gerar` e `instalar-conversor`.
 *   fluig-mcp regenerar <arquivo.process> [1.8.2|2.0] [--proprio | --oficial] [--nao-gravar] [--cache <pasta>] [--java <caminho>]
 *   fluig-mcp gerar <spec.json> --projeto <pasta> [1.8.2|2.0] [--sobrescrever] [--oficial | --proprio] [--cache <pasta>] [--java <caminho>]
 *   fluig-mcp instalar-conversor --de <pasta plugins | raiz do Eclipse | studio.zip> [--versao 1.8.2.0|2.0.0.2|todas] [--cache <pasta>] [--forcar]
 *   fluig-mcp instalar-conversor --baixar 1.8.2.0 [--cache <pasta>] [--forcar]
 * `executarCli` devolve o código de saída: 0 ok, 1 erro de execução (ErroFluxo), 2 uso errado.
 */
import { ErroFluxo, regenerar } from './regenerar.js';
import { instalarConversor } from './conversor.js';
import { gerarArtefatos } from './artefatos.js';
import { readFile } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';

const USO = `Uso:
  fluig-mcp regenerar <arquivo.process> [1.8.2|2.0] [--proprio | --oficial] [--nao-gravar] [--cache <pasta>] [--java <caminho>]
  fluig-mcp gerar <spec.json> --projeto <pasta> [1.8.2|2.0] [--sobrescrever] [--oficial | --proprio] [--cache <pasta>] [--java <caminho>]
  fluig-mcp instalar-conversor --de <pasta plugins | raiz do Eclipse | studio.zip> [--versao 1.8.2.0|2.0.0.2|todas] [--cache <pasta>] [--forcar]
  fluig-mcp instalar-conversor --baixar 1.8.2.0 [--cache <pasta>] [--forcar]`;

class UsoErrado extends Error {}

/** Separa posicionais de opções. `comValor` lista as opções que levam um valor. */
function analisar(args, comValor, sinalizadores) {
  const pos = [];
  const op = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!a.startsWith('--')) {
      pos.push(a);
    } else if (comValor.includes(a)) {
      if (i + 1 >= args.length || args[i + 1].startsWith('--')) throw new UsoErrado(`A opção ${a} precisa de um valor.`);
      op[a] = args[++i];
    } else if (sinalizadores.includes(a)) {
      op[a] = true;
    } else {
      throw new UsoErrado(`Opção desconhecida: ${a}.`);
    }
  }
  return { pos, op };
}

const MB = (n) => `${(n / 1048576).toFixed(1)} MB`;

export async function executarCli(argv, { saida = console.log, erro = console.error } = {}) {
  const [comando, ...resto] = argv;
  try {
    if (comando === 'regenerar') {
      const { pos, op } = analisar(resto, ['--cache', '--java'], ['--proprio', '--oficial', '--nao-gravar']);
      if (pos.length < 1 || pos.length > 2) throw new UsoErrado('Informe o arquivo .process e, se quiser, a versão (1.8.2 ou 2.0).');
      if (op['--proprio'] && op['--oficial']) throw new UsoErrado('Use --proprio ou --oficial, não os dois.');
      const r = await regenerar(pos[0], {
        versao: pos[1] || '1.8.2',
        conversor: op['--proprio'] ? 'proprio' : op['--oficial'] ? 'oficial' : 'auto',
        cache: op['--cache'],
        java: op['--java'],
        gravar: !op['--nao-gravar'],
      });
      if (r.conversor.tipo === 'oficial') {
        saida(`conversor: oficial (Studio ${r.conversor.versaoStudio}, Java ${r.conversor.java.major})`);
      } else {
        saida('conversor: gerador próprio (plano B)');
      }
      const gravar = !op['--nao-gravar'];
      const estado = (alterado) => (!gravar ? 'não gravado' : alterado ? 'gravado' : 'sem mudança');
      saida(`ecm30: ${r.ecm30.caminho} (${r.ecm30.bytes} bytes, ${estado(r.ecm30.alterado)})`);
      if (r.ecm30.backup) saida(`backup: ${r.ecm30.backup}`);
      saida(`svg: ${r.svg.caminho} (${r.svg.bytes} bytes, ${estado(r.svg.alterado)})`);
      for (const a of r.avisos) saida(`aviso ${a.codigo}: ${a.mensagem}`);
      return 0;
    }
    if (comando === 'gerar') {
      const { pos, op } = analisar(resto, ['--projeto', '--cache', '--java'], ['--sobrescrever', '--proprio', '--oficial']);
      if (pos.length < 1 || pos.length > 2) throw new UsoErrado('Informe o arquivo spec.json e, se quiser, a versão (1.8.2 ou 2.0).');
      if (!op['--projeto']) throw new UsoErrado('Informe --projeto <pasta> (raiz do projeto Fluig, onde fica workflow/).');
      if (op['--proprio'] && op['--oficial']) throw new UsoErrado('Use --proprio ou --oficial, não os dois.');
      let spec;
      try {
        spec = JSON.parse(await readFile(pos[0], 'utf8'));
      } catch (e) {
        throw new ErroFluxo('E_SPEC', `Não foi possível ler a spec ${pos[0]}: ${e && e.message}`);
      }
      const projeto = isAbsolute(op['--projeto']) ? op['--projeto'] : resolve(op['--projeto']);
      const r = await gerarArtefatos(spec, {
        versaoAlvo: pos[1] || '1.8.2',
        projeto,
        sobrescrever: !!op['--sobrescrever'],
        conversor: op['--proprio'] ? 'proprio' : op['--oficial'] ? 'oficial' : 'auto',
        cache: op['--cache'],
        java: op['--java'],
      });
      if (!r.ok) {
        for (const e of r.erros) erro(`erro ${e.codigo}: ${e.mensagem}`);
        for (const a of r.avisos) saida(`aviso ${a.codigo}: ${a.mensagem}`);
        return 1;
      }
      if (r.conversor.tipo === 'oficial') {
        saida(`conversor: oficial (Studio ${r.conversor.versaoStudio}, Java ${r.conversor.java.major})`);
      } else {
        saida('conversor: gerador próprio (plano B)');
      }
      const estado = (alterado) => (alterado ? 'gravado' : 'sem mudança');
      saida(`process: ${r.process.caminho} (${r.process.bytes} bytes, ${estado(r.process.alterado)})`);
      if (r.process.backup) saida(`backup: ${r.process.backup}`);
      saida(`ecm30: ${r.ecm30.caminho} (${r.ecm30.bytes} bytes, ${estado(r.ecm30.alterado)})`);
      if (r.ecm30.backup) saida(`backup: ${r.ecm30.backup}`);
      saida(`svg: ${r.svg.caminho} (${r.svg.bytes} bytes, ${estado(r.svg.alterado)})`);
      for (const a of r.avisos) saida(`aviso ${a.codigo}: ${a.mensagem}`);
      return 0;
    }
    if (comando === 'instalar-conversor') {
      const { pos, op } = analisar(resto, ['--de', '--versao', '--baixar', '--cache'], ['--forcar']);
      if (pos.length) throw new UsoErrado(`Argumento inesperado: ${pos[0]}.`);
      if (!op['--de'] && !op['--baixar']) throw new UsoErrado('Informe --de <pasta plugins | zip> ou --baixar <versão>.');
      if (op['--de'] && op['--baixar']) throw new UsoErrado('Use --de ou --baixar, não os dois.');
      const r = await instalarConversor({
        de: op['--de'],
        versao: op['--versao'],
        baixar: op['--baixar'] || false,
        cache: op['--cache'],
        forcar: !!op['--forcar'],
        log: saida,
      });
      for (const i of Array.isArray(r) ? r : [r]) {
        saida(
          i.jaInstalado
            ? `Studio ${i.versaoStudio}: já instalado e conferido em ${i.dir} (use --forcar para reinstalar).`
            : `Studio ${i.versaoStudio}: instalado em ${i.dir} (${i.arquivos} arquivos, ${MB(i.bytes)}).`
        );
      }
      return 0;
    }
    throw new UsoErrado(`Subcomando desconhecido: ${comando || '(nenhum)'}.`);
  } catch (e) {
    if (e instanceof UsoErrado) {
      erro(`erro de uso: ${e.message}`);
      erro(USO);
      return 2;
    }
    if (e instanceof ErroFluxo) {
      erro(`erro ${e.codigo}: ${e.message}`);
      return 1;
    }
    erro(`erro: ${e && e.message ? e.message : e}`);
    return 1;
  }
}
