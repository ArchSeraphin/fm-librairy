const IPV4 = /^(\d{1,3}\.){3}\d{1,3}$/;
const IPV6 = /^[0-9a-fA-F:]+$/;

function isValidIp(value: string): boolean {
  if (IPV4.test(value)) {
    return value.split('.').every((part) => Number(part) >= 0 && Number(part) <= 255);
  }
  return IPV6.test(value) && value.includes(':');
}

export function extractIpFromHeaders(headers: Headers): string {
  const xff = headers.get('x-forwarded-for');
  if (xff) {
    const first = xff.split(',')[0]?.trim();
    if (first && isValidIp(first)) return first;
  }
  const real = headers.get('x-real-ip')?.trim();
  if (real && isValidIp(real)) return real;
  return '0.0.0.0';
}
