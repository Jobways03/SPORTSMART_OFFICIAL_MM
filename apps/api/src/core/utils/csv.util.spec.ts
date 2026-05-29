import { toCsv, csvHeaderLine, csvRowLines, csvFilenameSlug } from './csv.util';

describe('csv.util', () => {
  describe('toCsv — RFC 4180 escaping', () => {
    it('emits a header line and one line per row', () => {
      const csv = toCsv([{ a: '1', b: '2' }], ['a', 'b']);
      expect(csv).toBe('a,b\n1,2\n');
    });

    it('quotes fields containing comma, quote, or newline; doubles interior quotes', () => {
      const csv = toCsv(
        [{ a: 'x,y', b: 'he said "hi"', c: 'line1\nline2' }],
        ['a', 'b', 'c'],
      );
      expect(csv).toBe('a,b,c\n"x,y","he said ""hi""","line1\nline2"\n');
    });

    it('renders null/undefined as empty and Date as ISO', () => {
      const d = new Date('2026-04-30T10:00:00.000Z');
      const csv = toCsv([{ a: null, b: undefined, c: d }], ['a', 'b', 'c']);
      expect(csv).toBe('a,b,c\n,,2026-04-30T10:00:00.000Z\n');
    });

    it('coerces BigInt via String()', () => {
      const csv = toCsv([{ a: 123n }], ['a']);
      expect(csv).toBe('a\n123\n');
    });

    it('returns just the header for an empty row set', () => {
      expect(toCsv([], ['a', 'b'])).toBe('a,b\n');
    });
  });

  describe('toCsv — CSV/formula injection (CWE-1236)', () => {
    it.each([
      ['=1+1', "'=1+1"],
      ['=cmd|\'/c calc\'!A1', "'=cmd|'/c calc'!A1"],
      ['@SUM(A1:A2)', "'@SUM(A1:A2)"],
      ['\tleadingtab', "'\tleadingtab"],
    ])('prefixes a single quote on formula-trigger cell %p', (input, expected) => {
      // No comma/quote/newline in these inputs, so the only change is the
      // leading-quote neutralisation (no RFC-4180 wrapping).
      const csv = toCsv([{ a: input }], ['a']);
      expect(csv).toBe(`a\n${expected}\n`);
    });

    it('neutralises a formula even when the cell also needs quoting', () => {
      const csv = toCsv([{ a: '=HYPERLINK("http://evil","clickme")' }], ['a']);
      // Leading quote added, then RFC-4180 wraps it (contains a comma + quotes).
      expect(csv).toBe('a\n"\'=HYPERLINK(""http://evil"",""clickme"")"\n');
    });

    it('does NOT mangle plain numeric literals (finance exports rely on this)', () => {
      const csv = toCsv(
        [{ neg: '-100', pos: '+91', dec: '-3.14', plain: '12.5' }],
        ['neg', 'pos', 'dec', 'plain'],
      );
      expect(csv).toBe('neg,pos,dec,plain\n-100,+91,-3.14,12.5\n');
    });

    it('neutralises a hyphen-led non-number (e.g. a malicious name)', () => {
      const csv = toCsv([{ a: '-2+3+cmd' }], ['a']);
      expect(csv).toBe("a\n'-2+3+cmd\n");
    });
  });

  describe('BOM option', () => {
    it('omits the BOM by default', () => {
      expect(toCsv([{ a: '1' }], ['a']).charCodeAt(0)).toBe('a'.charCodeAt(0));
    });

    it('prepends a UTF-8 BOM when requested', () => {
      const csv = toCsv([{ a: 'हिंदी' }], ['a'], { bom: true });
      expect(csv.charCodeAt(0)).toBe(0xfeff);
      expect(csv.slice(1)).toBe('a\nहिंदी\n');
    });
  });

  describe('streaming helpers', () => {
    it('csvHeaderLine returns the escaped header terminated by a newline', () => {
      expect(csvHeaderLine(['a', 'b'])).toBe('a,b\n');
    });

    it('csvRowLines returns body rows only and an empty string for no rows', () => {
      expect(csvRowLines([], ['a'])).toBe('');
      expect(csvRowLines([{ a: '1' }, { a: '2' }], ['a'])).toBe('1\n2\n');
    });

    it('header + concatenated batches equals the buffered toCsv output', () => {
      const headers = ['a'];
      const rows = [{ a: 'x' }, { a: 'y' }, { a: 'z' }];
      const streamed =
        csvHeaderLine(headers) +
        csvRowLines(rows.slice(0, 2), headers) +
        csvRowLines(rows.slice(2), headers);
      expect(streamed).toBe(toCsv(rows, headers));
    });
  });

  describe('csvFilenameSlug', () => {
    it('lowercases, replaces non-alphanumerics with underscores, trims', () => {
      expect(csvFilenameSlug(['returns', '2026-04-01', '2026-04-30'])).toBe(
        'returns_2026_04_01_2026_04_30',
      );
    });

    it('drops null/undefined/empty parts', () => {
      expect(csvFilenameSlug(['returns', undefined, null, ''])).toBe('returns');
    });
  });
});
