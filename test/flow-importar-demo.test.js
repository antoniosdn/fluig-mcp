// Importador do Studio de verdade (Java x64 + conversor e importador no cache), com os ECM30 de test/fixtures/flow.
// Só roda com FLUIG_DEMO_IMPORTADOR=1 (sob Rosetta é pesado) e pula sem importador ou sem Java x86_64:
//   FLUIG_DEMO_IMPORTADOR=1 [FLUIG_MCP_CACHE=<cache>] [FLUIG_MCP_JAVA_IMPORTADOR=<java x64>] node --test test/flow-importar-demo.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirCache, importadorParaVersao } from '../src/flow/conversor.js';
import { conferirJavaImportador, resolverJavaImportador } from '../src/flow/java.js';
import { importarEcm30, numerosDoXml } from '../src/flow/importar.js';

const cache = dirCache();
const fixture = (nome) => readFileSync(new URL(`./fixtures/flow/${nome}.ecm30.xml`, import.meta.url), 'utf8');

async function motivoPular(versaoAlvo) {
  if (process.env.FLUIG_DEMO_IMPORTADOR !== '1') return 'defina FLUIG_DEMO_IMPORTADOR=1 para rodar';
  if (!importadorParaVersao(versaoAlvo, { cache })) return `sem conversor + importador para ${versaoAlvo} em ${cache}`;
  try {
    await conferirJavaImportador(await resolverJavaImportador());
  } catch (e) {
    return `sem Java x64 para o importador (${e.codigo})`;
  }
  return false;
}

// só exportações reais de servidor: sintetico-paralelo-2.0 foi montado à mão para o leitor e não tem
// campos que o servidor sempre manda (o importador do Studio falha nele em createEndEvent)
const CASOS = [
  ['medicao_contrato', '1.8.2'],
  ['rpa', '1.8.2'],
  ['medicao_contrato', '2.0'],
  ['rpa', '2.0'],
];

for (const [nome, versaoAlvo] of CASOS) {
  const pular = await motivoPular(versaoAlvo);
  test(`importar ${nome} (${versaoAlvo}): ids e ECM30 regenerado com os números do servidor`, { skip: pular }, async () => {
    const xml = fixture(nome);
    const r = await importarEcm30(xml, { versaoAlvo });
    const esperado = numerosDoXml(xml);
    assert.deepEqual(Object.keys(r.ids.atividades).map(Number), esperado.estados);
    assert.deepEqual(Object.keys(r.ids.ligacoes).map(Number), esperado.ligacoes);
    for (const [n, id] of Object.entries(r.ids.atividades)) {
      assert.ok(id.endsWith(n), `${id} termina em ${n}`);
      assert.doesNotMatch(id, /swimlane|pool/i, `a atividade ${n} não pode apontar para raia ou pool`);
    }
    for (const [n, id] of Object.entries(r.ids.ligacoes)) assert.ok(id === null || id.endsWith(n), `${id} termina em ${n}`);
    assert.equal(r.conversor.tipo, 'oficial');
    assert.deepEqual(numerosDoXml(r.ecm30.conteudo), esperado, 'o conversor oficial devolve os mesmos números');
  });
}
