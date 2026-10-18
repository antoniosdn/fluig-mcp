/**
 * Definição geral do processo (comum a todas as versões) lida de um XML ECM30.
 *
 *   const { descricao, categoria, volume, expediente, instrucao } = lerDefinicao(xml);
 *
 * Lê o primeiro <ProcessDefinition>. Campo ausente vira ''. Lança se o XML não for um ECM30 com ProcessDefinition.
 */
import { parseXml, textoDe } from './xml.js';

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
  };
}
