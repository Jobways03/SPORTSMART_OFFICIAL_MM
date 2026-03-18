export class MfaRequiredRule {
  static isRequired(role: string): boolean {
    return role === 'ADMIN';
  }
}
