export class CliError extends Error {
  constructor(code, message, remediation = null, details = null) {
    super(message);
    this.code = code;
    this.remediation = remediation;
    this.details = details;
  }
}
