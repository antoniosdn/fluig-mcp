/**
 * Cache local do conversor oficial do Fluig Studio e o comando `instalar-conversor` (passo 5.2).
 *
 * Os JARs da TOTVS e da Eclipse Foundation NUNCA entram no repositório: são copiados (ou baixados)
 * para <cache>/studio/<versao>/ na máquina de quem roda o comando, conferidos pelo SHA-256 da
 * tabela CONVERSORES (medidos no passo 5.2, ver plano-passo5-2-regenerar.md §1.1).
 */
import { createHash, randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { ErroFluxo } from './erro.js';
import { abrirZip, lerZipDeBuffer } from './zip.js';

const sha = (b) => createHash('sha256').update(b).digest('hex');

const URL_TOTVS = 'http://update.fluig.com/182/plugins/';
const URL_ECLIPSE = 'https://download.eclipse.org/releases/neon/201703231000/plugins/';

const jar = (nome, bytes, sha256, origem, comUrl) => {
  const j = { nome, bytes, sha256, origem };
  if (comUrl) j.url = (origem === 'totvs' ? URL_TOTVS : URL_ECLIPSE) + nome;
  return j;
};

const ECLIPSE = (comUrl) => [
  jar('org.eclipse.emf.ecore_2.12.0.v20160420-0247.jar', 1190945, '74b5e5b39d9ac18c76a8f7f2d6b53c8ff316cb77c1ee7404d5a2d8026d2cfca5', 'eclipse', comUrl),
  jar('org.eclipse.emf.common_2.12.0.v20160420-0247.jar', 357670, 'b5593e44e091d49011a19b6f8426fa4c1d154150fbfec37938b8ec3b7c22a33d', 'eclipse', comUrl),
  jar('org.eclipse.emf.ecore.xmi_2.12.0.v20160420-0247.jar', 230424, '292dab7b61c17c691df60974b7ca70609679f114aceaafbba277cfca121a4d5b', 'eclipse', comUrl),
  jar('org.eclipse.graphiti.mm_0.13.2.v20161129-0820.jar', 220803, '6617eea00079dac3d5c6bb1e8861cdfba229e643b8291cbd7c79db7d4892e3fa', 'eclipse', comUrl),
  jar('org.apache.xerces_2.9.0.v201101211617.jar', 1306967, '64634c651cb6a3c088ca4404634437833e039b903c80069bdaa0efa27e1e1201', 'eclipse', comUrl),
  jar('com.ibm.icu_56.1.0.v201601250100.jar', 11365876, '799f4c95c43d0a6fa6e0000bba12783065cc17f492b2be9de5cba7fc16b686e0', 'eclipse', comUrl),
  jar('org.eclipse.osgi_3.11.3.v20170209-1843.jar', 1367994, 'e655cae749b14f10c37dbf0e80bafe2715ab3b18d095927e03c5785d00b8ba5b', 'eclipse', comUrl),
  jar('org.eclipse.equinox.common_3.8.0.v20160509-1230.jar', 120435, '55b77373a114cf53a7f5df2bff621eaf52ea279381d5ab3736e3330576e28572', 'eclipse', comUrl),
  jar('org.eclipse.core.runtime_3.12.0.v20160606-1342.jar', 75728, '72b466872894d9cacbf8614c7463bf82f93b7eb5eb06fe0976969dbeedf32e86', 'eclipse', comUrl),
];

const XSTREAM = Object.freeze({
  bytes: 483453,
  sha256: '29e83a585d56a76b1d417dade617465d18f8aab7bec1390b742508c7d173318a',
});

/** Tabela dos JARs esperados, por versão do Studio. A ordem é a do classpath. */
export const CONVERSORES = Object.freeze({
  '1.8.2.0': Object.freeze({
    jars: Object.freeze([
      jar('com.totvs.tds.ecm.designer.model_1.8.2.0.jar', 6029734, '25822d5e8703ac36e120427f446b042d928ea49b87c346bfd31d8ff5a03df56d', 'totvs', true),
      jar('com.totvs.tds.ecm.designer.eclipse_1.8.2.0.jar', 13288151, '0a4ef3c22ec711a262646a131ffac83255d29fb9ae8530adfc7035b4198459cc', 'totvs', true),
      jar('com.totvs.tds.ecm_1.8.2.0.jar', 3567438, '8314337917222149e8e508e84c4bc05ca63e4072e73f45495982db8309302008', 'totvs', true),
      jar('com.totvs.tds.ecm.designer.export.bpmn20_1.8.2.0.jar', 6097316, 'd7bb7211b896c4ba92a20620069bcf8ab29805d4d1f296fa846ce854419caa33', 'totvs', true),
      ...ECLIPSE(true),
    ].map(Object.freeze)),
    xstream: XSTREAM,
  }),
  '2.0.0.2': Object.freeze({
    jars: Object.freeze([
      jar('com.totvs.tds.ecm.designer.model_2.0.0.2.jar', 6030971, '5088d2536c1c29305bf613a624221b55ceb0208c4baad07a844c7eb1871af655', 'totvs', false),
      jar('com.totvs.tds.ecm.designer.eclipse_2.0.0.2.jar', 13559431, '920020a53ee7ced07044257c392b7a574ff4603827fe8452f908eda7830a3284', 'totvs', false),
      jar('com.totvs.tds.ecm_2.0.0.2.jar', 3570903, '09762a4c78d534780c2e07ca4fc9278f3910b5a6cc33d2674cf83de9950cd5cb', 'totvs', false),
      jar('com.totvs.tds.ecm.designer.export.bpmn20_2.0.0.2.jar', 6097564, '6c2ca38f24b097e71e0245f5ff14f55cece36aea3abfff35c9d4dc02509fbc04', 'totvs', false),
      jar('com.totvs.tds.restclient_2.0.0.2.jar', 3287380, 'c368f489d76f1730d9bfbfe6116d12e44adde8a5bc15e7bab209f5209d83576e', 'totvs', false),
      ...ECLIPSE(false),
    ].map(Object.freeze)),
    xstream: XSTREAM,
  }),
});

export const W_STUDIO_SUBSTITUTO =
  'usando o conversor do Studio 2.0.0.2 para a versão 1.8.2; nos 10 processos do demo a saída é idêntica à do 1.8.2.0';

const RE_BPMN20 = /^com\.totvs\.tds\.ecm\.designer\.export\.bpmn20_/;
const DICA = 'fluig-mcp instalar-conversor --de <pasta plugins do Studio | zip>  (ou --baixar 1.8.2.0)';

/** opcoes.cache → env FLUIG_MCP_CACHE → ~/.fluig-mcp */
export function dirCache(opcoes = {}) {
  const env = opcoes.env || process.env;
  if (opcoes.cache) return resolve(opcoes.cache);
  if (env.FLUIG_MCP_CACHE && env.FLUIG_MCP_CACHE.trim()) return resolve(env.FLUIG_MCP_CACHE.trim());
  return join(homedir(), '.fluig-mcp');
}

const dirStudioDe = (cache, v) => join(cache, 'studio', v);

/**
 * '2.0' exige 2.0.0.2. '1.8.2' usa 1.8.2.0 se instalado; senão 2.0.0.2 (com aviso). Nenhum → null.
 * "Instalado" = há manifesto.json; a integridade é conferida por conferirConversor.
 */
export function studioParaVersao(versaoAlvo, { cache } = {}) {
  const base = cache || dirCache();
  const tem = (v) => existsSync(join(dirStudioDe(base, v), 'manifesto.json'));
  if (versaoAlvo === '2.0') {
    return tem('2.0.0.2') ? { versaoStudio: '2.0.0.2', dir: dirStudioDe(base, '2.0.0.2'), aviso: null } : null;
  }
  if (tem('1.8.2.0')) return { versaoStudio: '1.8.2.0', dir: dirStudioDe(base, '1.8.2.0'), aviso: null };
  if (tem('2.0.0.2')) {
    return { versaoStudio: '2.0.0.2', dir: dirStudioDe(base, '2.0.0.2'), aviso: { codigo: 'W_STUDIO_SUBSTITUTO', mensagem: W_STUDIO_SUBSTITUTO } };
  }
  return null;
}

const falhaCache = (arquivo, motivo) =>
  new ErroFluxo('E_CONVERSOR_CACHE', `${arquivo}: ${motivo}. Rode de novo: ${DICA}`);

/** Confere o cache a cada execução (SHA-256 recalculado contra a TABELA, não contra o manifesto). */
export async function conferirConversor(dirStudio, versaoStudio, { tabela = CONVERSORES } = {}) {
  const def = tabela[versaoStudio];
  if (!def) throw falhaCache(versaoStudio, 'versão do Studio desconhecida');
  let manifesto;
  try {
    manifesto = JSON.parse(await readFile(join(dirStudio, 'manifesto.json'), 'utf8'));
  } catch {
    throw falhaCache('manifesto.json', 'ausente ou ilegível');
  }
  if (manifesto.versaoStudio !== versaoStudio) {
    throw falhaCache('manifesto.json', `versão ${manifesto.versaoStudio} difere da esperada (${versaoStudio})`);
  }
  const checar = async (rel, esperado) => {
    let b;
    try {
      b = await readFile(join(dirStudio, ...rel.split('/')));
    } catch {
      throw falhaCache(rel, 'ausente');
    }
    if (b.length !== esperado.bytes) throw falhaCache(rel, `tamanho ${b.length}, esperado ${esperado.bytes}`);
    const h = sha(b);
    if (h !== esperado.sha256) throw falhaCache(rel, `SHA-256 ${h}, esperado ${esperado.sha256}`);
  };
  for (const j of def.jars) await checar(`plugins/${j.nome}`, j);
  await checar('xstream.jar', def.xstream);
  let presentes = [];
  try {
    presentes = await readdir(join(dirStudio, 'plugins'));
  } catch {
    /* já falhou acima */
  }
  const permitidos = new Set(def.jars.map((j) => j.nome));
  for (const p of presentes) {
    if (p.toLowerCase().endsWith('.jar') && !permitidos.has(p)) throw falhaCache(`plugins/${p}`, 'JAR que não está na tabela');
  }
  return {
    classpath: def.jars.map((j) => join(dirStudio, 'plugins', j.nome)),
    xstream: join(dirStudio, 'xstream.jar'),
  };
}

// ---------------------------------------------------------------- fontes

function candidatosPasta(de) {
  const base = resolve(de);
  return [join(base, 'plugins'), base];
}

async function abrirFontePasta(de) {
  let info;
  try {
    info = await stat(de);
  } catch {
    throw new ErroFluxo('E_FONTE', `Pasta ou zip não encontrado: ${de}. Informe --de <pasta plugins do Studio | studio.zip>.`);
  }
  if (!info.isDirectory()) throw new ErroFluxo('E_FONTE', `${de} não é pasta.`);
  const dirs = candidatosPasta(de);
  return {
    origem: { tipo: 'pasta', caminho: resolve(de) },
    tem: (nome) => dirs.some((d) => existsSync(join(d, nome))),
    async obter(nome) {
      const d = dirs.find((x) => existsSync(join(x, nome)));
      return readFile(join(d, nome));
    },
    async fechar() {},
  };
}

async function abrirFonteZip(de) {
  const z = await abrirZip(de).catch((e) => {
    if (e.codigo === 'E_ZIP') throw new ErroFluxo('E_ZIP', `${de}: ${e.message}`);
    throw e;
  });
  const achar = (nome) => z.entradas.filter((e) => e.nome === `plugins/${nome}` || e.nome.endsWith(`/plugins/${nome}`));
  return {
    origem: { tipo: 'zip', caminho: resolve(de) },
    tem: (nome) => achar(nome).length > 0,
    async obter(nome) {
      const lista = achar(nome);
      if (lista.length > 1) {
        throw new ErroFluxo('E_ZIP', `Zip ambíguo: ${nome} aparece ${lista.length} vezes (${lista.map((e) => e.nome).join(', ')}). Use uma pasta plugins ou um zip com um único Studio.`);
      }
      try {
        return await z.ler(lista[0]);
      } catch (e) {
        if (e.codigo === 'E_ZIP') throw new ErroFluxo('E_ZIP', `${de}: ${e.message}`);
        throw e;
      }
    },
    fechar: () => z.fechar(),
  };
}

async function abrirFonte(de) {
  if (/\.zip$/i.test(de)) return abrirFonteZip(de);
  return abrirFontePasta(de);
}

// ---------------------------------------------------------------- gravação

function conferirBytes(nome, buf, esperado) {
  if (buf.length !== esperado.bytes) {
    throw new ErroFluxo('E_HASH', `${nome}: tamanho ${buf.length}, esperado ${esperado.bytes}. Arquivo recusado; nada foi gravado no cache.`);
  }
  const h = sha(buf);
  if (h !== esperado.sha256) {
    throw new ErroFluxo('E_HASH', `${nome}: SHA-256 esperado ${esperado.sha256}, obtido ${h}. Arquivo recusado; nada foi gravado no cache.`);
  }
}

function extrairXstream(bufferBpmn, def) {
  let z;
  try {
    z = lerZipDeBuffer(bufferBpmn);
    const b = z.ler('META-INF/lib/xstream.jar');
    conferirBytes('xstream.jar', b, def.xstream);
    return b;
  } catch (e) {
    if (e.codigo === 'E_ZIP') throw new ErroFluxo('E_ZIP', `Não foi possível extrair META-INF/lib/xstream.jar do JAR export.bpmn20: ${e.message}`);
    throw e;
  }
}

/**
 * Monta a pasta da versão em diretório temporário e só no fim faz rename para o destino.
 * `fornecer(j)` devolve o Buffer de cada JAR da tabela.
 */
async function gravarVersao({ cache, versaoStudio, def, fornecer, origem, forcar, log }) {
  const raizStudio = join(cache, 'studio');
  const destino = dirStudioDe(cache, versaoStudio);
  const tabelaLocal = { [versaoStudio]: def };

  if (existsSync(destino) && !forcar) {
    try {
      await conferirConversor(destino, versaoStudio, { tabela: tabelaLocal });
      return { versaoStudio, dir: destino, arquivos: def.jars.length + 1, bytes: 0, jaInstalado: true };
    } catch {
      /* inválido: reinstala */
    }
  }

  await mkdir(raizStudio, { recursive: true });
  const tmp = join(raizStudio, `.instalando-${versaoStudio}-${process.pid}-${randomBytes(4).toString('hex')}`);
  try {
    await mkdir(join(tmp, 'plugins'), { recursive: true });
    const arquivos = {};
    let total = 0;
    let bufBpmn = null;
    for (const j of def.jars) {
      const buf = await fornecer(j);
      conferirBytes(j.nome, buf, j);
      await writeFile(join(tmp, 'plugins', j.nome), buf);
      arquivos[`plugins/${j.nome}`] = { bytes: buf.length, sha256: sha(buf) };
      total += buf.length;
      if (RE_BPMN20.test(j.nome)) bufBpmn = buf;
      log(`  ${j.nome} (${buf.length} bytes) ok`);
    }
    if (!bufBpmn) throw new ErroFluxo('E_FONTE', 'A tabela não tem o JAR export.bpmn20, de onde sai o xstream.jar.');
    const xs = extrairXstream(bufBpmn, def);
    await writeFile(join(tmp, 'xstream.jar'), xs);
    arquivos['xstream.jar'] = { bytes: xs.length, sha256: sha(xs) };
    total += xs.length;
    await writeFile(
      join(tmp, 'manifesto.json'),
      JSON.stringify({ formato: 1, versaoStudio, instaladoEm: new Date().toISOString(), origem, arquivos }, null, 2) + '\n'
    );
    let antigo = null;
    if (existsSync(destino)) {
      antigo = `${destino}.antigo-${Date.now()}`;
      await rename(destino, antigo);
    }
    try {
      await rename(tmp, destino);
    } catch (e) {
      if (antigo) await rename(antigo, destino).catch(() => {});
      throw e;
    }
    if (antigo) await rm(antigo, { recursive: true, force: true });
    return { versaoStudio, dir: destino, arquivos: Object.keys(arquivos).length, bytes: total, jaInstalado: false };
  } catch (e) {
    await rm(tmp, { recursive: true, force: true });
    throw e;
  }
}

async function instalarDeFonte({ versaoStudio, de, cache, tabela, forcar, log }) {
  const def = tabela[versaoStudio];
  const fonte = await abrirFonte(de);
  try {
    const ausentes = def.jars.filter((j) => !fonte.tem(j.nome)).map((j) => j.nome);
    if (ausentes.length) {
      throw new ErroFluxo('E_FONTE', `Studio ${versaoStudio}: faltam ${ausentes.length} JAR(s) em ${de}: ${ausentes.join(', ')}. Aponte --de para a pasta plugins (ou o zip) de um Studio ${versaoStudio}.`);
    }
    return await gravarVersao({ cache, versaoStudio, def, fornecer: (j) => fonte.obter(j.nome), origem: fonte.origem, forcar, log });
  } finally {
    await fonte.fechar();
  }
}

async function instalarBaixando({ versaoStudio, cache, tabela, buscar, forcar, log }) {
  const def = tabela[versaoStudio];
  if (!def) throw new ErroFluxo('E_BAIXAR', `Versão ${versaoStudio} desconhecida. Versões: ${Object.keys(tabela).join(', ')}.`);
  const semUrl = def.jars.filter((j) => !j.url);
  if (semUrl.length) {
    throw new ErroFluxo(
      'E_BAIXAR',
      `Não há URL de download para o Studio ${versaoStudio}: o site oficial publica 2.0.0, não 2.0.0.2. Para o 2.0, use --de <pasta plugins | zip> de um Studio 2.0.0.2.`
    );
  }
  const total = def.jars.reduce((s, j) => s + j.bytes, 0);
  log(`Download do conversor do Studio ${versaoStudio} (${def.jars.length} arquivos, ${(total / 1048576).toFixed(1)} MB):`);
  for (const j of def.jars) log(`  ${j.url}  ${j.nome}  ${j.bytes} bytes`);
  log('O download é feito por você, sob os termos da TOTVS e da Eclipse Foundation (EPL). Cada arquivo só é aceito se o tamanho e o SHA-256 baterem com a tabela.');
  const fornecer = async (j) => {
    let r;
    try {
      r = await buscar(j.url);
    } catch (e) {
      throw new ErroFluxo('E_BAIXAR', `${j.url}: falha no download (${e && e.message}). Tente de novo ou use --de.`);
    }
    if (!r || r.status !== 200) {
      throw new ErroFluxo('E_BAIXAR', `${j.url}: HTTP ${r && r.status}. Nada foi gravado; tente de novo ou use --de <pasta plugins | zip>.`);
    }
    return Buffer.from(await r.arrayBuffer());
  };
  return gravarVersao({
    cache,
    versaoStudio,
    def,
    fornecer,
    origem: { tipo: 'baixar', urls: def.jars.map((j) => j.url) },
    forcar,
    log,
  });
}

/**
 * Instala o conversor no cache.
 *  - baixar: versão (ex.: '1.8.2.0') → baixa, confere e instala. Devolve um resultado.
 *  - de: pasta/zip. Com `versao` → um resultado. Sem `versao` ou 'todas' → array, uma entrada por versão
 *    da tabela cujos JARs estejam todos na fonte; nenhuma completa → E_FONTE listando o que falta.
 * Resultado: { versaoStudio, dir, arquivos, bytes, jaInstalado }.
 */
export async function instalarConversor({
  versao,
  de,
  baixar = false,
  cache,
  tabela = CONVERSORES,
  buscar = (url) => fetch(url),
  forcar = false,
  log = () => {},
} = {}) {
  const base = cache ? resolve(cache) : dirCache();
  if (baixar) {
    const v = typeof baixar === 'string' ? baixar : versao;
    if (!v) throw new ErroFluxo('E_BAIXAR', 'Informe a versão: --baixar 1.8.2.0.');
    return instalarBaixando({ versaoStudio: v, cache: base, tabela, buscar, forcar, log });
  }
  if (!de) throw new ErroFluxo('E_FONTE', 'Informe a fonte: --de <pasta plugins do Studio | raiz do Eclipse | studio.zip> ou --baixar 1.8.2.0.');
  if (versao && versao !== 'todas') {
    if (!tabela[versao]) throw new ErroFluxo('E_FONTE', `Versão ${versao} desconhecida. Versões: ${Object.keys(tabela).join(', ')}.`);
    return instalarDeFonte({ versaoStudio: versao, de, cache: base, tabela, forcar, log });
  }
  // todas as versões completas na fonte
  const fonte = await abrirFonte(de);
  const faltas = {};
  const completas = [];
  try {
    for (const [v, def] of Object.entries(tabela)) {
      const ausentes = def.jars.filter((j) => !fonte.tem(j.nome)).map((j) => j.nome);
      if (ausentes.length) faltas[v] = ausentes;
      else completas.push(v);
    }
  } finally {
    await fonte.fechar();
  }
  if (!completas.length) {
    const linhas = Object.entries(faltas).map(([v, a]) => `Studio ${v}: faltam ${a.join(', ')}`);
    throw new ErroFluxo('E_FONTE', `Nenhuma versão completa em ${de}.\n${linhas.join('\n')}\nAponte --de para a pasta plugins (ou o zip) de um Studio.`);
  }
  const resultados = [];
  for (const v of completas) {
    log(`Instalando o conversor do Studio ${v}...`);
    resultados.push(await instalarDeFonte({ versaoStudio: v, de, cache: base, tabela, forcar, log }));
  }
  return resultados;
}
