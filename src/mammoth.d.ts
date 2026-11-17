declare module "mammoth/mammoth.browser" {
  const mammoth: {
    convertToHtml(
      input: { arrayBuffer: ArrayBuffer },
      options?: { styleMap?: string[] }
    ): Promise<{ value: string; messages: { type: string; message: string }[] }>;
  };
  export default mammoth;
}
