/**
 * Leitor ZIP mínimo, sem dependência (passo 5.2). Serve para abrir o zip de um Studio e os JARs
 * (que são zips) e extrair entradas armazenadas (método 0) ou deflate (método 8).
 * Não confere CRC: quem chama confere o SHA-256 do que extraiu.
 */
import { open } from 'node:fs/promises';
import { inflateRawSync } from 'node:zlib';

const SIG_EOCD = 0x06054b50;
const SIG_LOC64 = 0x07064b50;
const SIG_EOCD64 = 0x06064b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_LOCAL = 0x04034b50;

function erroZip(mensagem) {
  const e = new Error(mensagem);
  e.codigo = 'E_ZIP';
  return e;
}

function lerU64(buf, off) {
  const v = buf.readBigUInt64LE(off);
  if (v > BigInt(Number.MAX_SAFE_INTEGER)) throw erroZip('Zip com valor maior que o suportado.');
  return Number(v);
}

/** Interpreta o diretório central a partir de leituras posicionais `ler(offset, tamanho) → Buffer`. */
function interpretar(tamanhoTotal, lerPos) {
  const janela = Math.min(tamanhoTotal, 65557);
  const cauda = lerPos(tamanhoTotal - janela, janela);
  let eocd = -1;
  for (let i = cauda.length - 22; i >= 0; i--) {
    if (cauda.readUInt32LE(i) === SIG_EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw erroZip('Arquivo não é um zip válido (fim do diretório central não encontrado).');
  let total = cauda.readUInt16LE(eocd + 10);
  let tamDir = cauda.readUInt32LE(eocd + 12);
  let offDir = cauda.readUInt32LE(eocd + 16);
  if (total === 0xffff || tamDir === 0xffffffff || offDir === 0xffffffff) {
    const posLoc = tamanhoTotal - janela + eocd - 20;
    if (posLoc < 0) throw erroZip('Zip64 sem localizador.');
    const loc = lerPos(posLoc, 20);
    if (loc.readUInt32LE(0) !== SIG_LOC64) throw erroZip('Zip64 sem localizador (0x07064b50).');
    const posE64 = lerU64(loc, 8);
    const e64 = lerPos(posE64, 56);
    if (e64.readUInt32LE(0) !== SIG_EOCD64) throw erroZip('Zip64 com EOCD64 inválido.');
    total = lerU64(e64, 32);
    tamDir = lerU64(e64, 40);
    offDir = lerU64(e64, 48);
  }
  const dir = lerPos(offDir, tamDir);
  const entradas = [];
  let p = 0;
  for (let n = 0; n < total; n++) {
    if (p + 46 > dir.length || dir.readUInt32LE(p) !== SIG_CENTRAL) throw erroZip('Diretório central corrompido.');
    const flag = dir.readUInt16LE(p + 8);
    const metodo = dir.readUInt16LE(p + 10);
    let tamanhoComprimido = dir.readUInt32LE(p + 20);
    let tamanho = dir.readUInt32LE(p + 24);
    const lenNome = dir.readUInt16LE(p + 28);
    const lenExtra = dir.readUInt16LE(p + 30);
    const lenCom = dir.readUInt16LE(p + 32);
    let offsetLocal = dir.readUInt32LE(p + 42);
    const nome = dir.toString((flag & 0x800) !== 0 ? 'utf8' : 'latin1', p + 46, p + 46 + lenNome);
    const extra = dir.subarray(p + 46 + lenNome, p + 46 + lenNome + lenExtra);
    let q = 0;
    while (q + 4 <= extra.length) {
      const id = extra.readUInt16LE(q);
      const len = extra.readUInt16LE(q + 2);
      if (id === 0x0001) {
        let r = q + 4;
        if (tamanho === 0xffffffff) { tamanho = lerU64(extra, r); r += 8; }
        if (tamanhoComprimido === 0xffffffff) { tamanhoComprimido = lerU64(extra, r); r += 8; }
        if (offsetLocal === 0xffffffff) { offsetLocal = lerU64(extra, r); r += 8; }
      }
      q += 4 + len;
    }
    entradas.push({ nome, metodo, tamanho, tamanhoComprimido, offsetLocal, flag });
    p += 46 + lenNome + lenExtra + lenCom;
  }
  return entradas;
}

function extrair(entrada, lerPos) {
  if (entrada.flag & 1) throw erroZip(`Entrada criptografada não suportada: ${entrada.nome}.`);
  if (entrada.metodo !== 0 && entrada.metodo !== 8) {
    throw erroZip(`Método de compressão ${entrada.metodo} não suportado (entrada ${entrada.nome}); só 0 (armazenado) e 8 (deflate).`);
  }
  const cab = lerPos(entrada.offsetLocal, 30);
  if (cab.readUInt32LE(0) !== SIG_LOCAL) throw erroZip(`Cabeçalho local inválido em ${entrada.nome}.`);
  const ini = entrada.offsetLocal + 30 + cab.readUInt16LE(26) + cab.readUInt16LE(28);
  const comprimido = lerPos(ini, entrada.tamanhoComprimido);
  const dados = entrada.metodo === 0 ? Buffer.from(comprimido) : inflateRawSync(comprimido);
  if (dados.length !== entrada.tamanho) {
    throw erroZip(`Tamanho de ${entrada.nome} não confere com o diretório (${dados.length} lidos, ${entrada.tamanho} esperados).`);
  }
  return dados;
}

function resolver(entradas, nomeOuEntrada) {
  if (typeof nomeOuEntrada !== 'string') return nomeOuEntrada;
  const e = entradas.find((x) => x.nome === nomeOuEntrada);
  if (!e) throw erroZip(`Entrada ${nomeOuEntrada} não existe no zip.`);
  return e;
}

/** Versão síncrona, para JAR pequeno já em memória. */
export function lerZipDeBuffer(buffer) {
  const lerPos = (off, len) => {
    if (off < 0 || off + len > buffer.length) throw erroZip('Zip truncado.');
    return buffer.subarray(off, off + len);
  };
  const entradas = interpretar(buffer.length, lerPos);
  return {
    entradas,
    ler: (nomeOuEntrada) => extrair(resolver(entradas, nomeOuEntrada), lerPos),
    fechar() {},
  };
}

/** Abre um arquivo zip com leituras posicionais (não carrega o arquivo inteiro). */
export async function abrirZip(caminho) {
  const fh = await open(caminho, 'r');
  try {
    const { size } = await fh.stat();
    const lerPosAsync = async (off, len) => {
      const buf = Buffer.alloc(len);
      let lido = 0;
      while (lido < len) {
        const { bytesRead } = await fh.read(buf, lido, len - lido, off + lido);
        if (bytesRead === 0) throw erroZip('Zip truncado.');
        lido += bytesRead;
      }
      return buf;
    };
    // `interpretar` e `extrair` são síncronos: pré-lê as regiões necessárias.
    const janela = Math.min(size, 65557);
    const cauda = await lerPosAsync(size - janela, janela);
    const cache = new Map([[`${size - janela}:${janela}`, cauda]]);
    const pendentes = [];
    const lerPos = (off, len) => {
      if (off >= size - janela && off + len <= size) return cauda.subarray(off - (size - janela), off - (size - janela) + len);
      const c = cache.get(`${off}:${len}`);
      if (c) return c;
      pendentes.push([off, len]);
      throw Object.assign(new Error('precisa-ler'), { precisa: true });
    };
    const comRetry = async (fn) => {
      for (;;) {
        try {
          return fn();
        } catch (e) {
          if (!e.precisa) throw e;
          while (pendentes.length) {
            const [off, len] = pendentes.pop();
            cache.set(`${off}:${len}`, await lerPosAsync(off, len));
          }
        }
      }
    };
    const entradas = await comRetry(() => interpretar(size, lerPos));
    return {
      entradas,
      async ler(nomeOuEntrada) {
        const entrada = resolver(entradas, nomeOuEntrada);
        const dados = await comRetry(() => extrair(entrada, lerPos));
        // libera o que foi pré-lido para a entrada (não guarda arquivos grandes)
        for (const k of [...cache.keys()]) if (!k.startsWith(`${size - janela}:`)) cache.delete(k);
        return dados;
      },
      async fechar() {
        await fh.close();
      },
    };
  } catch (e) {
    await fh.close();
    throw e;
  }
}
