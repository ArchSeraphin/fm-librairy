const BROWSERS: Array<[RegExp, string]> = [
  [/Edg\//, 'Edge'],
  [/Chrome\//, 'Chrome'],
  [/Firefox\//, 'Firefox'],
  [/Version\/[\d.]+\s+(Mobile\/[\w.]+\s+)?Safari\//, 'Safari'],
  [/Safari\//, 'Safari'],
];

const OSES: Array<[RegExp, string]> = [
  [/iPhone|iPad|iOS/, 'iOS'],
  [/Android/, 'Android'],
  [/Macintosh|Mac OS X/, 'macOS'],
  [/Windows/, 'Windows'],
  [/Linux/, 'Linux'],
];

export function parseUserAgentLabel(ua: string): string | null {
  if (!ua || ua.trim().length === 0) return null;
  let browser = 'Browser';
  for (const [re, name] of BROWSERS) {
    if (re.test(ua)) {
      browser = name;
      break;
    }
  }
  let os = 'Unknown';
  for (const [re, name] of OSES) {
    if (re.test(ua)) {
      os = name;
      break;
    }
  }
  return `${browser} on ${os}`.slice(0, 64);
}
