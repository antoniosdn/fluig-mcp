// Monta zips em memória para os testes (cabeçalho local + diretório central + EOCD, CRC 0).
// Não é um teste: só um utilitário importado por flow-zip, flow-conversor e flow-regenerar.
import { deflateRawSync } from 'node:zlib';

/**
 * @param {Array<{nome: string, dados: Buffer|string, metodo?: 0|8|number, utf8?: boolean, cripto?: boolean}>} entradas
 * @param {{zip64?: boolean}} opcoes zip64: campos saturados no EOCD + localizador + EOCD64 + extra 0x0001 em cada entrada
 */
export function montarZip(entradas, { zip64 = false } = {}) {
  const partes = [];
  const central = [];
  let off = 0;
  for (const e of entradas) {
    const dados = Buffer.isBuffer(e.dados) ? e.dados : Buffer.from(e.dados);
    const metodo = e.metodo === undefined ? 0 : e.metodo;
    const comp = metodo === 8 ? deflateRawSync(dados) : dados;
    const nome = Buffer.from(e.nome, 'utf8');
    const flag = (e.utf8 === false ? 0 : 0x800) | (e.cripto ? 1 : 0);
    const loc = Buffer.alloc(30);
    loc.writeUInt32LE(0x04034b50, 0);
    loc.writeUInt16LE(20, 4);
    loc.writeUInt16LE(flag, 6);
    loc.writeUInt16LE(metodo, 8);
    loc.writeUInt32LE(comp.length, 18);
    loc.writeUInt32LE(dados.length, 22);
    loc.writeUInt16LE(nome.length, 26);
    partes.push(loc, nome, comp);

    const extra = zip64 ? Buffer.alloc(28) : Buffer.alloc(0);
    if (zip64) {
      extra.writeUInt16LE(0x0001, 0);
      extra.writeUInt16LE(24, 2);
      extra.writeBigUInt64LE(BigInt(dados.length), 4);
      extra.writeBigUInt64LE(BigInt(comp.length), 12);
      extra.writeBigUInt64LE(BigInt(off), 20);
    }
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(45, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt16LE(flag, 8);
    c.writeUInt16LE(metodo, 10);
    c.writeUInt32LE(zip64 ? 0xffffffff : comp.length, 20);
    c.writeUInt32LE(zip64 ? 0xffffffff : dados.length, 24);
    c.writeUInt16LE(nome.length, 28);
    c.writeUInt16LE(extra.length, 30);
    c.writeUInt32LE(zip64 ? 0xffffffff : off, 42);
    central.push(c, nome, extra);
    off += 30 + nome.length + comp.length;
  }
  const dirBuf = Buffer.concat(central);
  const fim = [];
  if (zip64) {
    const e64 = Buffer.alloc(56);
    e64.writeUInt32LE(0x06064b50, 0);
    e64.writeBigUInt64LE(44n, 4);
    e64.writeUInt16LE(45, 12);
    e64.writeUInt16LE(45, 14);
    e64.writeBigUInt64LE(BigInt(entradas.length), 24);
    e64.writeBigUInt64LE(BigInt(entradas.length), 32);
    e64.writeBigUInt64LE(BigInt(dirBuf.length), 40);
    e64.writeBigUInt64LE(BigInt(off), 48);
    const loc64 = Buffer.alloc(20);
    loc64.writeUInt32LE(0x07064b50, 0);
    loc64.writeBigUInt64LE(BigInt(off + dirBuf.length), 8);
    loc64.writeUInt32LE(1, 16);
    fim.push(e64, loc64);
  }
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(zip64 ? 0xffff : entradas.length, 8);
  eocd.writeUInt16LE(zip64 ? 0xffff : entradas.length, 10);
  eocd.writeUInt32LE(zip64 ? 0xffffffff : dirBuf.length, 12);
  eocd.writeUInt32LE(zip64 ? 0xffffffff : off, 16);
  fim.push(eocd);
  return Buffer.concat([...partes, dirBuf, ...fim]);
}
