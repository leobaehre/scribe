import mammoth from "mammoth/mammoth.browser";

/**
 * Convert the bytes of a .docx file into HTML that TipTap can load.
 * Images are inlined as data URIs so the document is fully self-contained.
 */
export async function docxToHtml(bytes: Uint8Array): Promise<{ html: string; warnings: string[] }> {
  // Copy into a fresh ArrayBuffer (the input may be a view onto a larger buffer).
  const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const result = await mammoth.convertToHtml(
    { arrayBuffer },
    {
      styleMap: [
        "p[style-name='Title'] => h1:fresh",
        "p[style-name='Subtitle'] => h2:fresh",
        "p[style-name='Quote'] => blockquote > p:fresh",
        "u => u",
        "strike => s",
      ],
    }
  );
  return {
    html: result.value,
    warnings: result.messages.map((m) => m.message),
  };
}
