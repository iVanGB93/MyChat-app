/** Trusted platform encoding only; protocol callers validate framing and authentication. */
export interface AttachmentEncoding {
 toHex(bytes:Uint8Array):string;
 fromHex(hex:string):Uint8Array;
 toBase64(bytes:Uint8Array):string;
 fromBase64(base64:string):Uint8Array;
}
