// Phase 152 — CSV parser (RFC-4180) + bank-response mapping.

import { parseCsv, parseCsvRecords } from '../../src/core/utils/csv.util';
import { BankResponseParserService } from '../../src/modules/payouts/bank-response-parser.service';
import { BadRequestAppException } from '../../src/core/exceptions';

describe('parseCsv (RFC-4180)', () => {
  it('parses simple rows', () => {
    expect(parseCsv('a,b,c\n1,2,3')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ]);
  });

  it('handles quoted fields with embedded commas + newlines + escaped quotes', () => {
    const csv = 'name,note\n"Acme, Inc.","line1\nline2"\n"a ""quoted"" word",x';
    expect(parseCsv(csv)).toEqual([
      ['name', 'note'],
      ['Acme, Inc.', 'line1\nline2'],
      ['a "quoted" word', 'x'],
    ]);
  });

  it('strips a leading BOM and tolerates CRLF', () => {
    expect(parseCsv('﻿a,b\r\n1,2\r\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('keys records by lower-cased header, dropping blank rows', () => {
    const recs = parseCsvRecords('Settlement_ID,Status\n s1 , PAID \n\n s2 ,FAILED');
    expect(recs).toEqual([
      { settlement_id: 's1', status: 'PAID' },
      { settlement_id: 's2', status: 'FAILED' },
    ]);
  });
});

describe('BankResponseParserService', () => {
  const svc = new BankResponseParserService();

  it('maps settlement_id / status / paid_amount_in_paise / utr', () => {
    const { rows } = svc.parse(
      'settlement_id,status,paid_amount_in_paise,utr\nset-1,PAID,100000,UTR9\nset-2,FAILED,,bounced',
    );
    expect(rows[0]).toEqual({
      settlementId: 'set-1',
      status: 'PAID',
      paidAmountInPaise: 100000n,
      utrReference: 'UTR9',
      failureReason: undefined,
    });
    expect(rows[1]!.status).toBe('FAILED');
  });

  it('derives paise from a rupees column (paid_amount or the exported amount)', () => {
    const { rows } = svc.parse('settlement_id,status,amount,utr\nset-1,SUCCESS,1234.56,UTR1');
    expect(rows[0]!.status).toBe('PAID'); // SUCCESS token → PAID
    expect(rows[0]!.paidAmountInPaise).toBe(123456n);
  });

  it('accepts common bank status synonyms', () => {
    const { rows } = svc.parse(
      'settlement_id,status,paid_amount_in_paise\na,PROCESSED,1\nb,REJECTED,1',
    );
    expect(rows[0]!.status).toBe('PAID');
    expect(rows[1]!.status).toBe('FAILED');
  });

  it('throws on a missing settlement_id', () => {
    expect(() => svc.parse('status,utr\nPAID,UTR1')).toThrow(BadRequestAppException);
  });

  it('throws on an unrecognised status', () => {
    expect(() => svc.parse('settlement_id,status\ns1,PENDING_REVIEW')).toThrow(
      BadRequestAppException,
    );
  });

  it('throws on an empty file', () => {
    expect(() => svc.parse('')).toThrow(BadRequestAppException);
  });
});
