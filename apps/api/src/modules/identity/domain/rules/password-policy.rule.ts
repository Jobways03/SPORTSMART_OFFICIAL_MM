export class PasswordPolicyRule {
  static validate(password: string): boolean {
    return password.length >= 8;
  }
}
