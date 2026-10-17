// Opcional: confere lerProcess e o plano B contra o ECM30 oficial de um projeto real.
//   FLUIG_DEMO_DIR=<projeto com workflow/> node --test test/flow-process-demo.test.js
// Pulado sem FLUIG_DEMO_DIR. Trabalha numa CÓPIA de workflow/{diagrams,scripts,literals}; nada é gravado no projeto.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { lerProcess } from '../src/flow/process.js';
import { lerXmlProcesso } from '../src/flow/ler.js';
import { validarSpec } from '../src/flow/validar.js';
import { compararXml } from '../src/flow/comparar.js';
import { regenerar } from '../src/flow/regenerar.js';

const demo = process.env.FLUIG_DEMO_DIR;
const skip = demo ? false : 'defina FLUIG_DEMO_DIR com a pasta do projeto (que tem workflow/)';

const norm = (spec) => ({
  ...spec,
  atividades: [...spec.atividades].sort((a, b) => a.id.localeCompare(b.id)),
  ligacoes: spec.ligacoes.map((l) => JSON.stringify(l)).sort(),
});
const ordenado = (o) => JSON.stringify(Object.entries(o).sort());

test('lerProcess × lerXmlProcesso (oráculo) e plano B × ECM30 oficial', { skip }, async (t) => {
  const copia = mkdtempSync(join(tmpdir(), 'process-demo-'));
  try {
    for (const d of ['diagrams', 'scripts', 'literals']) {
      if (existsSync(join(demo, 'workflow', d))) cpSync(join(demo, 'workflow', d), join(copia, 'workflow', d), { recursive: true });
    }
    const nomes = readdirSync(join(copia, 'workflow', 'diagrams')).filter((n) => n.endsWith('.process')).sort();
    assert.ok(nomes.length > 0, 'nenhum .process no projeto');
    const resumo = { aceitos: [], recusados: [] };
    for (const nome of nomes) {
      const base = nome.replace(/\.process$/, '');
      await t.test(base, async () => {
        const texto = readFileSync(join(copia, 'workflow', 'diagrams', nome), 'utf8');
        const ecmOficial = readFileSync(join(demo, 'workflow', '.resources', `${base}.ecm30.xml`), 'utf8');
        const p = lerProcess(texto);
        const x = lerXmlProcesso(ecmOficial);
        // oráculo
        assert.deepEqual(norm(p.spec), norm(x.spec), 'spec difere');
        assert.equal(ordenado(p.origem.sequencias), ordenado(x.origem.sequencias), 'sequencias difere');
        assert.equal(ordenado(p.origem.capturas), ordenado(x.origem.capturas), 'capturas difere');
        // plano B
        const v = await validarSpec(p.spec, { versaoAlvo: '1.8.2' });
        const aceito = p.avisos.length === 0 && v.ok;
        const caminho = join(copia, 'workflow', 'diagrams', nome);
        if (aceito) {
          const r = await regenerar(caminho, { versao: '1.8.2', conversor: 'proprio', gravar: false });
          const difs = compararXml(ecmOficial, r.ecm30.conteudo, { versaoAlvo: '1.8.2' });
          assert.deepEqual(difs, [], `plano B difere do oficial na projeção v1: ${JSON.stringify(difs.slice(0, 5))}`);
          resumo.aceitos.push(base);
        } else {
          await assert.rejects(regenerar(caminho, { versao: '1.8.2', conversor: 'proprio', gravar: false }), (e) => e.codigo === 'E_PLANO_B_RECUSADO');
          resumo.recusados.push(base);
        }
      });
    }
    t.diagnostic(`oráculo: ${nomes.length}/${nomes.length}; plano B aceitos (${resumo.aceitos.length}): ${resumo.aceitos.join(', ') || '-'}; recusados (${resumo.recusados.length}): ${resumo.recusados.join(', ') || '-'}`);
  } finally {
    rmSync(copia, { recursive: true, force: true });
  }
});
