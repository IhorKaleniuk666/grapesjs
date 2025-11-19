export const getPrevValue = (source: any, patchPath: string) => {
  // patchPath: "/style/font-family" → ["style", "font-family"]
  const segments = patchPath.replace(/^\//, '').split('/');
  let cur: any = source;

  for (const seg of segments) {
    if (cur == null) return undefined;
    cur = cur[seg];
  }

  return cur;
};
