import { describe, expect, it } from 'vitest';
import { Scrubber, shortNameSpellings } from '../lib/output.js';

describe('shortNameSpellings', () => {
  it('derives the likely Windows 8.3 spellings of long segments only', () => {
    expect(shortNameSpellings('C:\\Users\\Ryan Liu')).toEqual(['C:\\Users\\RYANLI~1', 'C:\\Users\\RYANLI~2', 'C:\\Users\\RYANLI~3', 'C:\\Users\\RYANLI~4']);
    expect(shortNameSpellings('C:\\Users\\bob')).toEqual([]);
    expect(shortNameSpellings('/Users/someone-long')).toEqual([]);
  });
});

describe('Scrubber', () => {
  it('replaces every spelling of the home folder, including the short name, and a long hostname', () => {
    const s = new Scrubber(['C:\\Users\\Ryan Liu'], 'ryans-macbook-pro');
    expect(s.scrub('at C:\\Users\\Ryan Liu\\.claude and C:/Users/Ryan Liu/dev and c:\\users\\ryan liu\\x')).toBe('at ~\\.claude and ~/dev and ~\\x');
    expect(s.scrub('"C:\\\\Users\\\\Ryan Liu\\\\x"')).toBe('"~\\\\x"');
    expect(s.scrub('C:\\Users\\RYANLI~1\\AppData')).toBe('~\\AppData');
    expect(s.scrub('on ryans-macbook-pro and RYANS-MACBOOK-PRO.local')).toBe('on [REDACTED:hostname] and [REDACTED:hostname].local');
  });
  it('leaves a short hostname alone, because it is an ordinary word', () => {
    expect(new Scrubber(['/home/x'], 'dev').scrub('the dev box')).toBe('the dev box');
    expect(new Scrubber(['/home/x'], 'dev').scrub('/home/x/y')).toBe('~/y');
  });
});
