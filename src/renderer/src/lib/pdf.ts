import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

const asset = (p: string): string => new URL(`./pdfjs/${p}/`, document.baseURI).href

export function loadPdf(data: Uint8Array): Promise<pdfjs.PDFDocumentProxy> {
  return pdfjs.getDocument({
    data,
    cMapUrl: asset('cmaps'),
    cMapPacked: true,
    standardFontDataUrl: asset('standard_fonts'),
    wasmUrl: asset('wasm'),
    iccUrl: asset('iccs')
  }).promise
}

/** 文字檔編碼：先試 UTF-8，失敗再試 Big5、GBK */
export function decodeText(data: Uint8Array): string {
  for (const enc of ['utf-8', 'big5', 'gbk']) {
    try {
      return new TextDecoder(enc, { fatal: true }).decode(data).replace(/^﻿/, '')
    } catch {
      /* 換下一個編碼 */
    }
  }
  return new TextDecoder('utf-8').decode(data)
}
