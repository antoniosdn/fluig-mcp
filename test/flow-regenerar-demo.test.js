// Opcional: regenera os .process de um projeto real com o conversor oficial do Studio e compara com .resources/.
//   FLUIG_DEMO_DIR=<projeto com workflow/> [FLUIG_MCP_CACHE=<cache>] node --test test/flow-regenerar-demo.test.js
// Pulado sem FLUIG_DEMO_DIR, sem Java ou sem o conversor 1.8.2.0 no cache (fluig-mcp instalar-conversor).
// Trabalha numa CÓPIA de workflow/{diagrams,scripts,literals}; nada é gravado no projeto.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { regenerar } from '../src/flow/regenerar.js';
import { dirCache, studioParaVersao } from '../src/flow/conversor.js';

const demo = process.env.FLUIG_DEMO_DIR;
const cache = dirCache();
const temJava = spawnSync('java', ['-version'], { encoding: 'utf8' }).status === 0 || !!process.env.JAVA_HOME || !!process.env.FLUIG_MCP_JAVA;
const tem182 = existsSync(join(cache, 'studio', '1.8.2.0', 'manifesto.json'));
const tem20 = existsSync(join(cache, 'studio', '2.0.0.2', 'manifesto.json'));
const motivo = !demo
  ? 'defina FLUIG_DEMO_DIR com a pasta do projeto (que tem workflow/)'
  : !temJava
    ? 'Java não encontrado'
    : !tem182
      ? `conversor 1.8.2.0 não instalado em ${cache}`
      : false;

const semDescricaoEventos = (xml) => xml.replace(/<eventDescription>[\s\S]*?<\/eventDescription>/g, '<eventDescription/>');
const semFormIdV2 = (xml) => xml.replace(/^[ \t]*<formIdV2>[^<]*<\/formIdV2>\r?\n/gm, '');

test('regenerar com o conversor oficial: SVG e ECM30 iguais aos do projeto', { skip: motivo }, async (t) => {
  const copia = mkdtempSync(join(tmpdir(), 'regen-demo-'));
  try {
    for (const d of ['diagrams', 'scripts', 'literals']) {
      if (existsSync(join(demo, 'workflow', d))) cpSync(join(demo, 'workflow', d), join(copia, 'workflow', d), { recursive: true });
    }
    const nomes = readdirSync(join(copia, 'workflow', 'diagrams')).filter((n) => n.endsWith('.process')).sort();
    assert.ok(nomes.length > 0, 'nenhum .process no projeto');
    const naoIdenticos = [];
    const saidas182 = {};
    for (const nome of nomes) {
      const base = nome.replace(/\.process$/, '');
      await t.test(base, async () => {
        const r = await regenerar(join(copia, 'workflow', 'diagrams', nome), { versao: '1.8.2', conversor: 'oficial' });
        assert.equal(r.conversor.tipo, 'oficial');
        assert.equal(r.conversor.versaoStudio, '1.8.2.0');
        saidas182[base] = r.ecm30.conteudo;
        const refSvg = readFileSync(join(demo, 'workflow', '.resources', `${base}.processimage.svg`), 'utf8');
        assert.equal(r.svg.conteudo, refSvg, 'SVG difere byte a byte');
        const refEcm = readFileSync(join(demo, 'workflow', '.resources', `${base}.ecm30.xml`), 'utf8');
        if (r.ecm30.conteudo !== refEcm) {
          assert.equal(semDescricaoEventos(r.ecm30.conteudo), semDescricaoEventos(refEcm), 'ECM30 difere fora do eventDescription');
          naoIdenticos.push(base);
        }
      });
    }
    t.diagnostic(`SVG: ${nomes.length}/${nomes.length} iguais; ECM30 byte a byte: ${nomes.length - naoIdenticos.length}/${nomes.length}; diferem só no eventDescription: ${naoIdenticos.join(', ') || 'nenhum'}`);

    if (tem20 && studioParaVersao('2.0', { cache })) {
      let n = 0;
      for (const nome of nomes) {
        const base = nome.replace(/\.process$/, '');
        const r = await regenerar(join(copia, 'workflow', 'diagrams', nome), { versao: '2.0', conversor: 'oficial', gravar: false });
        assert.equal(r.conversor.versaoStudio, '2.0.0.2');
        assert.equal(semFormIdV2(r.ecm30.conteudo), saidas182[base], `${base}: 2.0 difere do 1.8.2 além de formIdV2`);
        n++;
      }
      t.diagnostic(`versão 2.0 (Studio 2.0.0.2): ${n}/${nomes.length} diferem do 1.8.2 só por linhas formIdV2`);
    } else {
      t.diagnostic('Studio 2.0.0.2 não instalado no cache: comparação da versão 2.0 pulada');
    }
  } finally {
    rmSync(copia, { recursive: true, force: true });
  }
});
