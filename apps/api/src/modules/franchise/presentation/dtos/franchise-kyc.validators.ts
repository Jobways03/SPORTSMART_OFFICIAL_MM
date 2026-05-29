import { registerDecorator, ValidationOptions } from 'class-validator';
import { isGstinValid } from '../../../tax/domain/gstin-validator';

/**
 * Phase 159j — shared franchise KYC identifier validators, so PAN/GST are
 * validated identically at every boundary they enter (onboarding submit,
 * franchise self-edit, admin edit). Previously each DTO had its own (or, for
 * admin-edit, no) regex, so a malformed identifier could slip in through one
 * path and then be VERIFIED by a reviewer.
 */

/**
 * PAN with a validated 4th-character holder-type code.
 *
 *   positions 1-3 : alphabetic series (AAA..ZZZ)
 *   position  4   : entity type — one of A/B/C/F/G/H/J/L/P/T
 *                   (A=AOP, B=BOI, C=Company, F=Firm/LLP, G=Government,
 *                    H=HUF, J=Artificial juridical person, L=Local authority,
 *                    P=Individual, T=Trust)
 *   position  5   : first character of the holder's name (A..Z)
 *   positions 6-9 : digits
 *   position  10  : check alphabet
 *
 * The old `[A-Z]{5}\d{4}[A-Z]` accepted any letter at position 4, passing
 * structurally-impossible PANs like `ABCDX1234F`.
 */
export const FRANCHISE_PAN_REGEX = /^[A-Z]{3}[ABCFGHJLPT][A-Z]\d{4}[A-Z]$/;

/**
 * Structural GSTIN shape (2-digit state code + 10-char PAN + entity code +
 * 'Z' + check char). Checksum is enforced separately by
 * {@link IsValidGstinChecksum}.
 */
export const FRANCHISE_GSTIN_REGEX =
  /^\d{2}[A-Z]{5}\d{4}[A-Z]{1}[A-Z\d]{1}[Z]{1}[A-Z\d]{1}$/;

/**
 * GSTIN Mod-36 checksum validation at the request boundary. The structural
 * regex catches shape errors; this catches a structurally-valid but
 * transposed/typo'd GSTIN whose 15th check character doesn't reconcile with
 * the first 14. Reuses the shared tax-domain validator so the checksum
 * algorithm lives in exactly one place (no second copy to drift).
 */
export function IsValidGstinChecksum(validationOptions?: ValidationOptions) {
  return (object: object, propertyName: string) => {
    registerDecorator({
      name: 'isValidGstinChecksum',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown) {
          // @IsOptional covers the absent case; only check provided strings.
          if (typeof value !== 'string' || value.length === 0) return true;
          return isGstinValid(value);
        },
        defaultMessage() {
          return 'GST number failed checksum validation (please re-check the GSTIN)';
        },
      },
    });
  };
}
