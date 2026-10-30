export function redactWorkspacePreviewTicketFromPath(value: string): string {
  const pathname = value.split(/[?#]/, 1)[0];
  if (!/\/workspace\/preview\/[^/]+/i.test(pathname)) return value;
  return pathname.replace(
    /(\/workspace\/preview\/)[^/]+/i,
    '$1[redacted]',
  );
}
