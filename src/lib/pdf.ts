export async function extractPdfText(bytes: Uint8Array, maxChars = 20000): Promise<string> {
  // Dynamic import — pdfjs-dist is ~500KB and an MV3 service worker can
  // restart from cold fairly often; no reason to pay that parse cost on
  // every startup when most opens aren't a PDF.
  //
  // Legacy build, not the default one: pdfjs-dist's main build assumes a
  // browser document/Web Crypto environment a service worker doesn't fully
  // provide — confirmed by testing (the default build throws on load
  // outside a real browser tab). The legacy build plus disableWorker works
  // without spawning a Worker, which a service worker can't do anyway.
  const { getDocument, GlobalWorkerOptions } = await import('pdfjs-dist/legacy/build/pdf.mjs')
  GlobalWorkerOptions.workerSrc = ''

  // disableWorker isn't in the public type (an older/internal option), but
  // it's what made this work without a Worker in testing — cast rather than
  // drop it and risk silently reintroducing a Worker dependency.
  const doc = await getDocument({
    data: bytes,
    disableWorker: true,
    isEvalSupported: false,
    useWorkerFetch: false,
  } as any).promise

  let text = ''
  for (let i = 1; i <= doc.numPages; i++) {
    if (text.length >= maxChars) break
    const page = await doc.getPage(i)
    const content = await page.getTextContent()
    text += content.items.map((item: any) => ('str' in item ? item.str : '')).join(' ') + '\n\n'
  }
  return text.trim().slice(0, maxChars)
}
