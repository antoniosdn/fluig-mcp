/**
 * Definição geral do processo (comum a todas as versões) lida de um XML ECM30.
 *
 *   const { descricao, categoria, volume, expediente, instrucao } = lerDefinicao(xml);
 *
 * Lê o primeiro <ProcessDefinition>. Campo ausente vira ''. Lança se o XML não for um ECM30 com ProcessDefinition.
 */
import { parseXml, textoDe } from './xml.js';
import { escaparXml } from './gerar.js';

export function lerDefinicao(xml) {
  const raiz = parseXml(xml);
  if (raiz.nome !== 'list') {
    throw new Error(`XML não é um ECM30 de processo: a raiz deve ser <list> (veio <${raiz.nome}>).`);
  }
  const alvo = [];
  for (const c of raiz.filhos) {
    if (c.nome === 'list') alvo.push(...c.filhos);
    else alvo.push(c);
  }
  const def = alvo.find((e) => e.nome === 'ProcessDefinition');
  if (!def) throw new Error('XML não é um ECM30 de processo: falta o elemento ProcessDefinition.');
  const t = (nome) => {
    const v = textoDe(def, nome);
    return v === undefined ? '' : v.trim();
  };
  return {
    descricao: t('processDescription'),
    categoria: t('categoryId'),
    volume: t('volumeId'),
    expediente: t('periodId'),
    instrucao: t('instruction'),
    processCategoryId: t('processCategoryId'),
    icon: t('icon'),
  };
}

const CAMPOS_COMUNS = [
  ['descricao', 'processDescription'],
  ['categoria', 'categoryId'],
  ['volume', 'volumeId'],
  ['expediente', 'periodId'],
  ['instrucao', 'instruction'],
];
const CAMPOS_2_0 = [
  ['processCategoryId', 'processCategoryId'],
  ['icon', 'icon'],
];

/**
 * Aplica a definição geral `def` ao primeiro <ProcessDefinition> de um ECM30, sem tocar no resto do XML.
 * Chave ausente (undefined) em `def` deixa o elemento como está. `processCategoryId` e `icon` só são escritos
 * com versaoAlvo '2.0' e valor não vazio. Elemento ausente é inserido antes de </ProcessDefinition>.
 */
export function aplicarDefinicao(xml, def, { versaoAlvo } = {}) {
  const ini = /<ProcessDefinition(?:\s[^>]*)?>/.exec(xml);
  const fimTag = '</ProcessDefinition>';
  const fim = ini ? xml.indexOf(fimTag, ini.index) : -1;
  if (!ini || fim < 0) throw new Error('XML não é um ECM30 de processo: falta o elemento ProcessDefinition.');
  const aberturaFim = ini.index + ini[0].length;
  let bloco = xml.slice(aberturaFim, fim);
  const campos = [...CAMPOS_COMUNS];
  if (versaoAlvo === '2.0') campos.push(...CAMPOS_2_0);
  for (const [chave, tag] of campos) {
    const valor = def ? def[chave] : undefined;
    if (valor === undefined || valor === null) continue;
    if (CAMPOS_2_0.some(([c]) => c === chave) && valor === '') continue;
    const novo = `<${tag}>${escaparXml(valor)}</${tag}>`;
    const re = new RegExp(`<${tag}>[\\s\\S]*?</${tag}>|<${tag}\\s*/>`);
    if (re.test(bloco)) {
      bloco = bloco.replace(re, () => novo);
      continue;
    }
    const ultimo = /(\r?\n)([ \t]*)$/.exec(bloco);
    if (ultimo) {
      const linhas = bloco.slice(0, ultimo.index).split(/\r?\n/);
      const recuo = /^[ \t]*/.exec(linhas[linhas.length - 1])[0];
      bloco = `${bloco.slice(0, ultimo.index)}${ultimo[1]}${recuo}${novo}${ultimo[1]}${ultimo[2]}`;
    } else {
      bloco += novo;
    }
  }
  return xml.slice(0, aberturaFim) + bloco + xml.slice(fim);
}
