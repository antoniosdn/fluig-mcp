// Ida e volta com os XML ECM30 de uma pasta local (ex.: o projeto de demonstração).
// Opcional: sem FLUIG_ECM30_DIR o teste é pulado. Nada é copiado para o repositório nem gravado em disco.
//   FLUIG_ECM30_DIR=<pasta com *.ecm30.xml> [FLUIG_ECM30_VERSAO=1.8.2|2.0] node --test test/flow-ida-volta-demo.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compararIdaEVolta, formatarCobertura } from '../src/flow/comparar.js';

const pasta = process.env.FLUIG_ECM30_DIR;
const versaoAlvo = process.env.FLUIG_ECM30_VERSAO || '1.8.2';

test(
  'ida e volta dos XML ECM30 da pasta FLUIG_ECM30_DIR',
  { skip: pasta ? false : 'defina FLUIG_ECM30_DIR com a pasta dos *.ecm30.xml para rodar' },
  async (t) => {
    const arquivos = readdirSync(pasta)
      .filter((f) => f.endsWith('.ecm30.xml'))
      .sort();
    assert.ok(arquivos.length > 0, `nenhum *.ecm30.xml em ${pasta}`);

    const resultados = [];
    for (const arquivo of arquivos) {
      await t.test(arquivo, async () => {
        const xml = readFileSync(join(pasta, arquivo), 'utf8');
        const r = await compararIdaEVolta(xml, {
          versaoAlvo,
          processIdSubstituto: (id) => id.replace(/[^A-Za-z0-9_]/g, '_'),
        });
        r.nome = arquivo.replace(/\.ecm30\.xml$/, '');
        resultados.push(r);
        assert.ok(
          r.resultado === 'igual' || r.resultado === 'fora_v1',
          `${arquivo}: ${r.resultado} ${JSON.stringify(r.diferencas.slice(0, 5))} ${JSON.stringify(r.motivos)}`
        );
      });
    }
    t.diagnostic(`\n${formatarCobertura(resultados)}`);
  }
);
