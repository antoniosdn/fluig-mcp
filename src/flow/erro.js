/** Erro com código estável (E_...) usado por regenerar, conversor, java e cli-fluxo. */
export class ErroFluxo extends Error {
  constructor(codigo, mensagem) {
    super(mensagem);
    this.name = 'ErroFluxo';
    this.codigo = codigo;
  }
}
