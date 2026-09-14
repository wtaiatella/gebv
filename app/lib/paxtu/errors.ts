export class PaxtuSessionExpiredError extends Error {
  constructor(message = 'Sessão do Paxtu 100 expirada ou inválida. Por favor, faça login novamente.') {
    super(message);
    this.name = 'PaxtuSessionExpiredError';
  }
}

export class PaxtuApiError extends Error {
  statusCode: number;
  url: string;

  constructor(message: string, statusCode: number, url: string) {
    super(message);
    this.name = 'PaxtuApiError';
    this.statusCode = statusCode;
    this.url = url;
  }
}
