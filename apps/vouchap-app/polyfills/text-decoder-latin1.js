/**
 * Hermes (React Native): TextDecoder does not support encoding "latin1".
 * Some image/PDF-related deps instantiate `new TextDecoder('latin1')` at module load — patch early on Hermes.
 */
(function installLatin1TextDecoder() {
  const g = typeof globalThis !== 'undefined' ? globalThis : global;
  const NativeTD = g.TextDecoder;
  if (typeof NativeTD !== 'function') return;

  try {
    // eslint-disable-next-line no-new
    new NativeTD('latin1');
    return;
  } catch (_) {
    // continue with polyfill wrapper
  }

  function decodeLatin1(input) {
    const u8 =
      input instanceof ArrayBuffer
        ? new Uint8Array(input)
        : new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
    let s = '';
    for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
    return s;
  }

  class Latin1Decoder {
    decode(input) {
      return decodeLatin1(input);
    }
  }

  function PatchedTextDecoder(encoding, options) {
    const enc = String(encoding ?? 'utf-8').toLowerCase();
    if (
      enc === 'latin1' ||
      enc === 'iso-8859-1' ||
      enc === 'iso8859-1' ||
      enc === 'windows-1252'
    ) {
      return new Latin1Decoder();
    }
    return new NativeTD(encoding, options);
  }

  PatchedTextDecoder.prototype = NativeTD.prototype;
  g.TextDecoder = PatchedTextDecoder;
})();
