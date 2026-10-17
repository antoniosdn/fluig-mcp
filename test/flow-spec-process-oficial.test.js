// Opcional: spec → .process → ECM30 pelo conversor OFICIAL do Studio, conferido contra a spec e contra o gerador próprio.
//   node --test test/flow-spec-process-oficial.test.js      (usa FLUIG_MCP_CACHE ou ~/.fluig-mcp)
// Cada versão é pulada se o Studio dela não estiver no cache (1.8.2 → 1.8.2.0; 2.0 → 2.0.0.2, sem substituto) ou sem Java.
// Nada é gravado fora de um mkdtemp.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gerarArtefatos } from '../src/flow/artefatos.js';
import { compararSpecProcess, specParaProcess } from '../src/flow/spec-process.js';
import { lerXmlProcesso } from '../src/flow/ler.js';
import { gerarXmlProcesso } from '../src/flow/gerar.js';
import { compararXml } from '../src/flow/comparar.js';
import { validarSpec } from '../src/flow/validar.js';
import { dirCache } from '../src/flow/conversor.js';

const cache = dirCache();
const temJava = spawnSync('java', ['-version'], { encoding: 'utf8' }).status === 0 || !!process.env.JAVA_HOME || !!process.env.FLUIG_MCP_JAVA;
const STUDIO = { '1.8.2': '1.8.2.0', '2.0': '2.0.0.2' };
const motivo = (versao) =>
  !temJava ? 'Java não encontrado' : !existsSync(join(cache, 'studio', STUDIO[versao], 'manifesto.json')) ? `Studio ${STUDIO[versao]} não instalado em ${cache}` : false;

const fixture = (nome) => JSON.parse(readFileSync(new URL(`./fixtures/flow/${nome}.json`, import.meta.url), 'utf8'));
const CASOS = [
  ['spec-completa', (s) => s],
  ['spec-completa sem posições', (s) => { for (const a of s.atividades) delete a.posicao; return s; }],
  ['spec-ou', (s) => s],
];
const ARQUIVO = { 'spec-completa': 'spec-completa', 'spec-completa sem posições': 'spec-completa', 'spec-ou': 'spec-ou' };

for (const versaoAlvo of ['1.8.2', '2.0']) {
  for (const [nome, ajustar] of CASOS) {
    test(`oficial ${versaoAlvo}: ${nome}`, { skip: motivo(versaoAlvo) }, async (t) => {
      const projeto = mkdtempSync(join(tmpdir(), 'spec-process-oficial-'));
      try {
        const spec = ajustar(fixture(ARQUIVO[nome]));
        const t0 = Date.now();
        const r = await gerarArtefatos(spec, { versaoAlvo, projeto, conversor: 'oficial', cache });
        assert.equal(r.ok, true, JSON.stringify(r.erros));
        assert.equal(r.conversor.tipo, 'oficial');
        assert.deepEqual(r.avisos.filter((a) => a.codigo === 'W_CONVERSOR'), [], 'o conversor não deveria avisar');
        t.diagnostic(`Studio ${r.conversor.versaoStudio}, ${Date.now() - t0} ms`);

        // specParaProcess é determinístico: dá os mesmos ids, posições e origem do .process gravado
        const sp = specParaProcess(spec, { versaoAlvo });
        assert.equal(sp.texto, r.process.conteudo);

        // oráculo: o ECM30 oficial relido tem de ser a spec original
        const lido = lerXmlProcesso(r.ecm30.conteudo);
        assert.deepEqual(lido.avisos, []);
        assert.deepEqual(compararSpecProcess(spec, lido.spec, { ids: sp.ids, posicoes: sp.posicoes }), []);
        const v = await validarSpec(lido.spec, { versaoAlvo });
        assert.deepEqual(v.erros, []);

        // o ECM30 oficial tem o ProcessLink captura de erro -> tratamento (initialStateSequence = captura)
        const capturaSeq = String(sp.origem.capturas.erp);
        const tratamentoSeq = String(lido.origem.sequencias[`s${/(\d+)$/.exec(sp.ids.trata)[1]}`]);
        const ligacaoCaptura = new RegExp(
          `<initialStateSequence>${capturaSeq}</initialStateSequence>\\s*<finalStateSequence>${tratamentoSeq}</finalStateSequence>`
        );
        assert.match(r.ecm30.conteudo, ligacaoCaptura);
        assert.deepEqual(lido.origem.tratamentos, { [`s${/(\d+)$/.exec(sp.ids.erp)[1]}`]: sp.origem.tratamentos.erp });

        // cruzamento com o gerador próprio (mesma origem; posições efetivamente gravadas no .process)
        const comPosicoes = JSON.parse(JSON.stringify(spec));
        for (const a of comPosicoes.atividades) a.posicao = sp.posicoes[a.id];
        const direto = await gerarXmlProcesso(comPosicoes, { versaoAlvo, origem: sp.origem });
        assert.equal(direto.ok, true, JSON.stringify(direto.erros));
        assert.deepEqual(compararXml(r.ecm30.conteudo, direto.xml, { versaoAlvo }), []);

        if (versaoAlvo === '2.0') assert.match(r.ecm30.conteudo, /<formIdV2>/);
        else assert.doesNotMatch(r.ecm30.conteudo, /<formIdV2>/);
      } finally {
        rmSync(projeto, { recursive: true, force: true });
      }
    });
  }
}
