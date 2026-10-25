/**
 * Cache local do conversor oficial do Fluig Studio e o comando `instalar-conversor` (passo 5.2).
 *
 * Os JARs da TOTVS e da Eclipse Foundation NUNCA entram no repositório: são copiados (ou baixados)
 * para <cache>/studio/<versao>/ na máquina de quem roda o comando, conferidos pelo SHA-256 da
 * tabela CONVERSORES (medidos no passo 5.2, ver plano-passo5-2-regenerar.md §1.1).
 *
 * O importador do Studio (ECM30 → .process, plano-importador-studio.md) precisa de outros 17 JARs:
 * ficam em <cache>/importador/<versao>/, tabela IMPORTADORES, com o SWT da plataforma. Não vão para
 * studio/<versao>/ porque a reinstalação do conversor troca essa pasta inteira e a conferência
 * recusa JAR fora da tabela em plugins/.
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

/** JARs do Eclipse Neon.3 que o importador usa, iguais no Studio 1.8.2.0 e no 2.0.0.2 (medidos em 24/10/2026). */
const IMPORTADOR_ECLIPSE = (comUrl) => [
  jar('org.eclipse.graphiti_0.13.2.v20161129-0820.jar', 323351, '7a3b65ec972af5dd7b7eae8aaa770440ee03879bdcffffc71aba0bad408abaed', 'eclipse', comUrl),
  jar('org.eclipse.graphiti.ui_0.13.2.v20161129-0820.jar', 695255, '586cf3272b52d44377cdcad9fb396b1e5b5b54bd60649e9d4283754c6dc482b2', 'eclipse', comUrl),
  jar('org.eclipse.emf.transaction_1.9.0.201606071900.jar', 172879, 'c60b46ac9b512252dfbff4508fc787423e16201ac8c0ae1032640a66d56f77c8', 'eclipse', comUrl),
  jar('org.eclipse.emf.edit_2.12.0.v20160526-0356.jar', 278989, '9e315e867ace155219ba3ec14e27f513ca117f545624bbace263e28e520bf06d', 'eclipse', comUrl),
  jar('org.eclipse.draw2d_3.10.100.201606061308.jar', 616652, '6f8efee3b35175ed650c1dace639acc1bdc0f373332bb58a27069c34622ad062', 'eclipse', comUrl),
  jar('org.eclipse.equinox.preferences_3.6.1.v20160815-1406.jar', 133114, '8b85e6a5f8a2080ef661a04f6eeae50d2c5c913bae76e6c5b193b2aac14c06a3', 'eclipse', comUrl),
  jar('org.eclipse.ui.views.properties.tabbed_3.7.0.v20160310-0903.jar', 110526, '267cbc63c2a37714a2e37288af94d3c17d308fa148c87e4947c8f0679472d9da', 'eclipse', comUrl),
  jar('org.eclipse.gef_3.11.0.201606061308.jar', 999341, 'ca5e25dddc44ad0c220dea3b3283059f67fca884480f6267e70e22a8b872e06c', 'eclipse', comUrl),
  jar('org.eclipse.ui.workbench_3.108.3.v20170216-1539.jar', 4041043, 'b50e5b29a4f3fb9f206f137ed49520dfd0e3b5b125826eb91de14add1ed1c3ba', 'eclipse', comUrl),
  jar('org.eclipse.equinox.registry_3.6.100.v20160223-2218.jar', 186860, '5400bad0b52ca8318ba44504e58d4b01821adcf4e04c99efae101b87aa4c6ccd', 'eclipse', comUrl),
  jar('org.eclipse.core.commands_3.8.1.v20161221-1651.jar', 115396, 'b619eaed6360172cb38972b2e10a73d0706df162c89de66804adbc2a0648b76f', 'eclipse', comUrl),
  jar('org.eclipse.jface_3.12.2.v20170113-2113.jar', 1087190, 'bf3995710bdd28c59d7126b11792ab2a79e9179948490e2605b2e76c55dbced9', 'eclipse', comUrl),
  jar('org.eclipse.core.resources_3.11.1.v20161107-2032.jar', 882701, '01cf3ffdad887079fca0abf0edaef353039f389acadd14044d812ad28f85194d', 'eclipse', comUrl),
  jar('org.eclipse.core.jobs_3.8.0.v20160509-0411.jar', 111093, '50dbae7c3aa2c6fa00667fb891e165e8312bd1fef5878d7f161747b1afc8f186', 'eclipse', comUrl),
];

/** SWT por plataforma (só x86_64 no Neon). Linux fica de fora até a tabela ter o hash do gtk. */
const IMPORTADOR_SWT = (comUrl) => ({
  darwin: jar('org.eclipse.swt.cocoa.macosx.x86_64_3.105.3.v20170228-0512.jar', 2457231, 'a938b8d291d0b023950f2e719885c0de766e93b688e66fc9d1a5e48df5b9da15', 'eclipse', comUrl),
  win32: jar('org.eclipse.swt.win32.win32.x86_64_3.105.3.v20170228-0512.jar', 2872490, '94f31d6395eda1b37e39687e7405838eefcce147afdfc998444425f10bc87e13', 'eclipse', comUrl),
});

const congelarImportador = (jars, swt) =>
  Object.freeze({
    jars: Object.freeze(jars.map(Object.freeze)),
    swt: Object.freeze(Object.fromEntries(Object.entries(swt).map(([p, j]) => [p, Object.freeze(j)]))),
  });

/**
 * JARs do importador por versão do Studio, além dos do conversor da mesma versão (o classpath é
 * conversor + importador + xstream). A ordem é a do classpath; o SWT da plataforma vai no fim.
 */
export const IMPORTADORES = Object.freeze({
  '1.8.2.0': congelarImportador(
    [
      jar('com.totvs.tds.ecm.designer.gui_1.8.2.0.jar', 1798061, '4ffa94892b64692a418192204fb26742537902b2ebc1e208f0169a1a0d922a4c', 'totvs', true),
      jar('com.totvs.tds.ecm.designer.integration_1.8.2.0.jar', 17732, '63949ee175f6987a93733560c1917935a2908965f1948c798f9bfaf916f3a26e', 'totvs', true),
      ...IMPORTADOR_ECLIPSE(true),
    ],
    IMPORTADOR_SWT(true)
  ),
  '2.0.0.2': congelarImportador(
    [
      jar('com.totvs.tds.ecm.designer.gui_2.0.0.2.jar', 1810053, '0bcb3fa824399596dab460d694067863234b8a8fca36354b6951caa28f0c7817', 'totvs', false),
      jar('com.totvs.tds.ecm.designer.integration_2.0.0.2.jar', 17731, 'b33142ed7d964057560a94704d143af530a9f922f8a133c2327a08a3ee38e08a', 'totvs', false),
      ...IMPORTADOR_ECLIPSE(false),
    ],
    IMPORTADOR_SWT(false)
  ),
});

/** Lista completa do importador numa plataforma (JARs + SWT). Plataforma sem SWT na tabela → E_IMPORTADOR_PLATAFORMA. */
export function jarsImportador(def, plataforma = process.platform) {
  const swt = def.swt[plataforma];
  if (!swt) {
    throw new ErroFluxo(
      'E_IMPORTADOR_PLATAFORMA',
      `O importador do Studio não tem o SWT para a plataforma "${plataforma}" (só macOS e Windows, x86_64). Use outra máquina ou edite o .process na extensão Fluiggers.`
    );
  }
  return [...def.jars, swt];
}

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

const dirImportadorDe = (cache, v) => join(cache, 'importador', v);

export const W_IMPORTADOR_SUBSTITUTO =
  'usando o importador do Studio 2.0.0.2 para a versão 1.8.2 (o 1.8.2.0 não está instalado)';

/**
 * Mesma regra de studioParaVersao, mas exige conversor E importador da mesma versão (o classpath do
 * importador inclui os JARs do conversor). "Instalado" = há os dois manifesto.json.
 */
export function importadorParaVersao(versaoAlvo, { cache } = {}) {
  const base = cache || dirCache();
  const tem = (v) => existsSync(join(dirStudioDe(base, v), 'manifesto.json')) && existsSync(join(dirImportadorDe(base, v), 'manifesto.json'));
  const de = (v, aviso) => ({ versaoStudio: v, dirStudio: dirStudioDe(base, v), dirImportador: dirImportadorDe(base, v), aviso });
  if (versaoAlvo === '2.0') return tem('2.0.0.2') ? de('2.0.0.2', null) : null;
  if (tem('1.8.2.0')) return de('1.8.2.0', null);
  if (tem('2.0.0.2')) return de('2.0.0.2', { codigo: 'W_IMPORTADOR_SUBSTITUTO', mensagem: W_IMPORTADOR_SUBSTITUTO });
  return null;
}

const falhaCache = (arquivo, motivo) =>
  new ErroFluxo('E_CONVERSOR_CACHE', `${arquivo}: ${motivo}. Rode de novo: ${DICA}`);

/** Confere tamanho e SHA-256 de <dir>/<rel> contra `esperado` ({bytes, sha256}). */
async function conferirArquivo(dir, rel, esperado, falha) {
  let b;
  try {
    b = await readFile(join(dir, ...rel.split('/')));
  } catch {
    throw falha(rel, 'ausente');
  }
  if (b.length !== esperado.bytes) throw falha(rel, `tamanho ${b.length}, esperado ${esperado.bytes}`);
  const h = sha(b);
  if (h !== esperado.sha256) throw falha(rel, `SHA-256 ${h}, esperado ${esperado.sha256}`);
}

/** Confere tamanho e SHA-256 de cada JAR em <dir>/plugins e recusa JAR fora da lista. */
async function conferirPlugins(dir, jars, falha) {
  for (const j of jars) await conferirArquivo(dir, `plugins/${j.nome}`, j, falha);
  let presentes = [];
  try {
    presentes = await readdir(join(dir, 'plugins'));
  } catch {
    /* já falhou acima */
  }
  const permitidos = new Set(jars.map((j) => j.nome));
  for (const p of presentes) {
    if (p.toLowerCase().endsWith('.jar') && !permitidos.has(p)) throw falha(`plugins/${p}`, 'JAR que não está na tabela');
  }
}

const falhaImportador = (arquivo, motivo) =>
  new ErroFluxo('E_IMPORTADOR_CACHE', `importador: ${arquivo}: ${motivo}. Rode de novo: ${DICA}`);

/**
 * Confere o importador a cada execução, contra a TABELA. Devolve só os JARs do importador; quem
 * monta o classpath junta os do conversor (conferirConversor) e o xstream.
 */
export async function conferirImportador(dirImportador, versaoStudio, { tabela = IMPORTADORES, plataforma = process.platform } = {}) {
  const def = tabela[versaoStudio];
  if (!def) throw falhaImportador(versaoStudio, 'versão do Studio sem importador na tabela');
  const jars = jarsImportador(def, plataforma);
  let manifesto;
  try {
    manifesto = JSON.parse(await readFile(join(dirImportador, 'manifesto.json'), 'utf8'));
  } catch {
    throw falhaImportador('manifesto.json', 'ausente ou ilegível');
  }
  if (manifesto.versaoStudio !== versaoStudio) {
    throw falhaImportador('manifesto.json', `versão ${manifesto.versaoStudio} difere da esperada (${versaoStudio})`);
  }
  if (manifesto.plataforma !== plataforma) {
    throw falhaImportador('manifesto.json', `instalado para "${manifesto.plataforma}", esta máquina é "${plataforma}"`);
  }
  await conferirPlugins(dirImportador, jars, falhaImportador);
  return { classpath: jars.map((j) => join(dirImportador, 'plugins', j.nome)), swt: join(dirImportador, 'plugins', jars[jars.length - 1].nome) };
}

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
  await conferirPlugins(dirStudio, def.jars, falhaCache);
  await conferirArquivo(dirStudio, 'xstream.jar', def.xstream, falhaCache);
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
  const tabelaLocal = { [versaoStudio]: def };
  return gravarPasta({
    raiz: join(cache, 'studio'),
    destino: dirStudioDe(cache, versaoStudio),
    versaoStudio,
    jars: def.jars,
    fornecer,
    origem,
    forcar,
    log,
    jaConferido: async (destino) => {
      await conferirConversor(destino, versaoStudio, { tabela: tabelaLocal });
      return def.jars.length + 1;
    },
    // o xstream.jar sai de dentro do JAR export.bpmn20
    extras: async (tmp, buffers) => {
      const nomeBpmn = def.jars.map((j) => j.nome).find((n) => RE_BPMN20.test(n));
      if (!nomeBpmn) throw new ErroFluxo('E_FONTE', 'A tabela não tem o JAR export.bpmn20, de onde sai o xstream.jar.');
      const xs = extrairXstream(buffers.get(nomeBpmn), def);
      await writeFile(join(tmp, 'xstream.jar'), xs);
      return { 'xstream.jar': xs };
    },
  });
}

/** Importador do Studio: <cache>/importador/<versão>/plugins, com o SWT da plataforma e a plataforma no manifesto. */
async function gravarImportador({ cache, versaoStudio, def, plataforma, fornecer, origem, forcar, log }) {
  const jars = jarsImportador(def, plataforma);
  return gravarPasta({
    raiz: join(cache, 'importador'),
    destino: dirImportadorDe(cache, versaoStudio),
    versaoStudio,
    jars,
    fornecer,
    origem,
    forcar,
    log,
    manifestoExtra: { plataforma },
    jaConferido: async (destino) => {
      await conferirImportador(destino, versaoStudio, { tabela: { [versaoStudio]: def }, plataforma });
      return jars.length;
    },
  });
}

/**
 * Monta a pasta em diretório temporário e só no fim faz rename para o destino.
 * `fornecer(j)` devolve o Buffer de cada JAR; `extras(tmp, buffers)` grava arquivos derivados.
 */
async function gravarPasta({ raiz, destino, versaoStudio, jars, fornecer, origem, forcar, log, jaConferido, extras, manifestoExtra = {} }) {
  if (existsSync(destino) && !forcar) {
    try {
      const n = await jaConferido(destino);
      return { versaoStudio, dir: destino, arquivos: n, bytes: 0, jaInstalado: true };
    } catch {
      /* inválido: reinstala */
    }
  }

  await mkdir(raiz, { recursive: true });
  const tmp = join(raiz, `.instalando-${versaoStudio}-${process.pid}-${randomBytes(4).toString('hex')}`);
  try {
    await mkdir(join(tmp, 'plugins'), { recursive: true });
    const arquivos = {};
    let total = 0;
    const buffers = new Map();
    for (const j of jars) {
      const buf = await fornecer(j);
      conferirBytes(j.nome, buf, j);
      await writeFile(join(tmp, 'plugins', j.nome), buf);
      arquivos[`plugins/${j.nome}`] = { bytes: buf.length, sha256: sha(buf) };
      total += buf.length;
      buffers.set(j.nome, buf);
      log(`  ${j.nome} (${buf.length} bytes) ok`);
    }
    if (extras) {
      for (const [nome, buf] of Object.entries(await extras(tmp, buffers))) {
        arquivos[nome] = { bytes: buf.length, sha256: sha(buf) };
        total += buf.length;
      }
    }
    await writeFile(
      join(tmp, 'manifesto.json'),
      JSON.stringify({ formato: 1, versaoStudio, ...manifestoExtra, instaladoEm: new Date().toISOString(), origem, arquivos }, null, 2) + '\n'
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

/** Fornecedor de JAR por download; HTTP diferente de 200 ou falha de rede → E_BAIXAR. */
const fornecerBaixando = (buscar) => async (j) => {
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

function anunciarDownload(rotulo, jars, log) {
  const total = jars.reduce((s, j) => s + j.bytes, 0);
  log(`Download do ${rotulo} (${jars.length} arquivos, ${(total / 1048576).toFixed(1)} MB):`);
  for (const j of jars) log(`  ${j.url}  ${j.nome}  ${j.bytes} bytes`);
  log('O download é feito por você, sob os termos da TOTVS e da Eclipse Foundation (EPL). Cada arquivo só é aceito se o tamanho e o SHA-256 baterem com a tabela.');
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
  anunciarDownload(`conversor do Studio ${versaoStudio}`, def.jars, log);
  return gravarVersao({
    cache,
    versaoStudio,
    def,
    fornecer: fornecerBaixando(buscar),
    origem: { tipo: 'baixar', urls: def.jars.map((j) => j.url) },
    forcar,
    log,
  });
}

/** Pastas de importador já instaladas no cache, de outras versões do Studio. */
function outrosImportadores(cache, versaoStudio, tabela) {
  return Object.keys(tabela)
    .filter((v) => v !== versaoStudio)
    .map((v) => dirImportadorDe(cache, v))
    .filter((d) => existsSync(join(d, 'manifesto.json')));
}

/**
 * Importador da mesma versão, da mesma fonte do conversor. Nunca lança: o conversor já foi
 * instalado, e o que faltar no importador volta como { instalado: false, codigo, motivo }.
 */
async function instalarImportador({ versaoStudio, de, baixar, cache, tabela, plataforma, buscar, forcar, log }) {
  const def = tabela[versaoStudio];
  if (!def) return null;
  try {
    const jars = jarsImportador(def, plataforma);
    let r;
    if (baixar) {
      const semUrl = jars.filter((j) => !j.url);
      if (semUrl.length) {
        throw new ErroFluxo('E_BAIXAR', `Não há URL de download do importador do Studio ${versaoStudio}; use --de <pasta plugins | zip> de um Studio ${versaoStudio}.`);
      }
      anunciarDownload(`importador do Studio ${versaoStudio} (${plataforma})`, jars, log);
      r = await gravarImportador({
        cache,
        versaoStudio,
        def,
        plataforma,
        fornecer: fornecerBaixando(buscar),
        origem: { tipo: 'baixar', urls: jars.map((j) => j.url) },
        forcar,
        log,
      });
    } else {
      const fonte = await abrirFonte(de);
      try {
        // o que faltar na fonte (ex.: o SWT do Mac num Studio 2.0 de Windows) pode vir do importador de outra
        // versão já instalado: os JARs do Eclipse e o SWT são os mesmos bytes, e o SHA-256 da tabela é conferido
        const doCache = new Map();
        for (const j of jars) {
          if (fonte.tem(j.nome)) continue;
          const achado = outrosImportadores(cache, versaoStudio, tabela).map((d) => join(d, 'plugins', j.nome)).find((c) => existsSync(c));
          if (achado) doCache.set(j.nome, achado);
        }
        const ausentes = jars.filter((j) => !fonte.tem(j.nome) && !doCache.has(j.nome)).map((j) => j.nome);
        if (ausentes.length) {
          const dica = ausentes.some((n) => !/^com\.totvs\./.test(n))
            ? ' Os do Eclipse e o SWT são os mesmos do 1.8.2.0: rode antes `fluig-mcp instalar-conversor --baixar 1.8.2.0` e repita.'
            : '';
          throw new ErroFluxo('E_FONTE', `faltam ${ausentes.length} JAR(s) do importador em ${de}: ${ausentes.join(', ')}.${dica}`);
        }
        log(`Instalando o importador do Studio ${versaoStudio} (${plataforma})...`);
        for (const [n, c] of doCache) log(`  ${n}: do cache (${c})`);
        const fornecer = (j) => (doCache.has(j.nome) ? readFile(doCache.get(j.nome)) : fonte.obter(j.nome));
        const origem = doCache.size ? { ...fonte.origem, doCache: [...doCache.values()] } : fonte.origem;
        r = await gravarImportador({ cache, versaoStudio, def, plataforma, fornecer, origem, forcar, log });
      } finally {
        await fonte.fechar();
      }
    }
    return { instalado: true, ...r };
  } catch (e) {
    if (!(e instanceof ErroFluxo)) throw e;
    return { instalado: false, codigo: e.codigo, motivo: e.message };
  }
}

/**
 * Instala o conversor no cache e, com `importador` (padrão), o importador da mesma versão.
 *  - baixar: versão (ex.: '1.8.2.0') → baixa, confere e instala. Devolve um resultado.
 *  - de: pasta/zip. Com `versao` → um resultado. Sem `versao` ou 'todas' → array, uma entrada por versão
 *    da tabela cujos JARs estejam todos na fonte; nenhuma completa → E_FONTE listando o que falta.
 * Resultado: { versaoStudio, dir, arquivos, bytes, jaInstalado, importador? }, com
 * importador = { instalado: true, dir, arquivos, bytes, jaInstalado } ou { instalado: false, codigo, motivo };
 * ausente quando a versão não tem importador na tabela ou `importador` é false.
 */
export async function instalarConversor({
  versao,
  de,
  baixar = false,
  cache,
  tabela = CONVERSORES,
  importador = true,
  tabelaImportador = IMPORTADORES,
  plataforma = process.platform,
  buscar = (url) => fetch(url),
  forcar = false,
  log = () => {},
} = {}) {
  const base = cache ? resolve(cache) : dirCache();
  const comImportador = async (r, fonte) => {
    if (!importador) return r;
    const imp = await instalarImportador({ versaoStudio: r.versaoStudio, ...fonte, cache: base, tabela: tabelaImportador, plataforma, buscar, forcar, log });
    return imp ? { ...r, importador: imp } : r;
  };
  if (baixar) {
    const v = typeof baixar === 'string' ? baixar : versao;
    if (!v) throw new ErroFluxo('E_BAIXAR', 'Informe a versão: --baixar 1.8.2.0.');
    return comImportador(await instalarBaixando({ versaoStudio: v, cache: base, tabela, buscar, forcar, log }), { baixar: true });
  }
  if (!de) throw new ErroFluxo('E_FONTE', 'Informe a fonte: --de <pasta plugins do Studio | raiz do Eclipse | studio.zip> ou --baixar 1.8.2.0.');
  if (versao && versao !== 'todas') {
    if (!tabela[versao]) throw new ErroFluxo('E_FONTE', `Versão ${versao} desconhecida. Versões: ${Object.keys(tabela).join(', ')}.`);
    return comImportador(await instalarDeFonte({ versaoStudio: versao, de, cache: base, tabela, forcar, log }), { de });
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
    resultados.push(await comImportador(await instalarDeFonte({ versaoStudio: v, de, cache: base, tabela, forcar, log }), { de }));
  }
  return resultados;
}
