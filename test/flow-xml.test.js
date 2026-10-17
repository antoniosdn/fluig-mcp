import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseXml, filho, filhos, textoDe } from '../src/flow/xml.js';

test('elementos aninhados, texto, <x/> e <x></x>', () => {
  const r = parseXml('<a><b>um</b><c/><d></d><e>  x  </e><b>dois</b></a>');
  assert.equal(r.nome, 'a');
  assert.equal(r.filhos.length, 5);
  assert.deepStrictEqual(r.filhos[0], { nome: 'b', filhos: [], texto: 'um' });
  assert.deepStrictEqual(r.filhos[1], { nome: 'c', filhos: [], texto: '' });
  assert.deepStrictEqual(r.filhos[2], { nome: 'd', filhos: [], texto: '' });
  assert.equal(r.filhos[3].texto, '  x  ', 'sem trim');
});

test('entidades nomeadas e numéricas, decodificadas uma vez só', () => {
  const r = parseXml('<a>&lt;&gt;&amp;&quot;&apos;|&#xd;|&#10004;|&#x2714;|&amp;lt;</a>');
  assert.equal(r.texto, `<>&"'|\r|✔|✔|&lt;`);
});

test('declaração, comentário, CDATA e BOM', () => {
  const r = parseXml('﻿<?xml version="1.0" encoding="UTF-8"?>\n<!-- c -->\n<a><!-- x --><b><![CDATA[<tag> & "texto"]]></b>t</a>\n<!-- fim -->');
  assert.equal(r.nome, 'a');
  assert.equal(r.texto, 't');
  assert.equal(r.filhos[0].texto, '<tag> & "texto"');
});

test('erros: atributo, DOCTYPE, entidade, & solto, fechamentos, raízes, vazio', () => {
  assert.throws(() => parseXml('<a b="1"></a>'), /atributo não suportado/);
  assert.throws(() => parseXml('<a><b c="1"/></a>'), /atributo não suportado/);
  assert.throws(() => parseXml('<!DOCTYPE a><a/>'), /DOCTYPE/);
  assert.throws(() => parseXml('<!ENTITY x "y"><a/>'), /DOCTYPE\/ENTITY/);
  assert.throws(() => parseXml('<a>&foo;</a>'), /entidade desconhecida/);
  assert.throws(() => parseXml('<a>a & b</a>'), /"&" solto/);
  assert.throws(() => parseXml('<a>&#xZZ;</a>'), /entidade numérica inválida/);
  assert.throws(() => parseXml('<a><b></a></b>'), /não casa/);
  assert.throws(() => parseXml('<a><b>'), /não fechada/);
  assert.throws(() => parseXml('<a/><b/>'), /mais de um elemento raiz/);
  assert.throws(() => parseXml('texto<a/>'), /texto fora do elemento raiz/);
  assert.throws(() => parseXml('<a/>texto'), /texto fora do elemento raiz/);
  assert.throws(() => parseXml('</a>'), /sem abertura/);
  assert.throws(() => parseXml(''), /documento vazio/);
  assert.throws(() => parseXml('   \n '), /documento vazio/);
  assert.throws(() => parseXml('<!-- só comentário -->'), /sem elemento raiz/);
  assert.throws(() => parseXml('<a>'), /posição/);
});

test('filho, filhos e textoDe', () => {
  const r = parseXml('<a><b>1</b><c>x</c><b>2</b><v/></a>');
  assert.equal(filho(r, 'b').texto, '1');
  assert.equal(filho(r, 'z'), undefined);
  assert.deepStrictEqual(filhos(r, 'b').map((n) => n.texto), ['1', '2']);
  assert.deepStrictEqual(filhos(r, 'z'), []);
  assert.equal(textoDe(r, 'c'), 'x');
  assert.equal(textoDe(r, 'v'), '');
  assert.equal(textoDe(r, 'z'), undefined);
  assert.equal(textoDe(undefined, 'z'), undefined);
});
