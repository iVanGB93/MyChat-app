package expo.modules.axonicnearby

import org.bouncycastle.crypto.modes.XChaCha20Poly1305
import org.bouncycastle.crypto.params.AEADParameters
import org.bouncycastle.crypto.params.KeyParameter

/** Bounded WSS v1 record primitive. JS retains derivation, nonce/sequence state,
 * peer binding and framing. No plaintext is returned before tag verification. */
internal object AttachmentStreamCipher {
  fun crypt(encrypt:Boolean,key:ByteArray,nonce:ByteArray,aad:ByteArray,input:ByteArray):ByteArray {
    var output:ByteArray?=null
    try {
      require(key.size==32 && nonce.size==24)
      require(aad.size in 1..512 && aad.all { it.toInt() in 32..126 })
      require(aad.toString(Charsets.US_ASCII).startsWith("[\"axonic-wss-stream-v1\","))
      require(input.size in (if(encrypt) 2..32769 else 18..32785))
      val cipher=XChaCha20Poly1305()
      cipher.init(encrypt,AEADParameters(KeyParameter(key),128,nonce,aad))
      val result=ByteArray(if(encrypt) input.size+16 else input.size-16)
      output=result
      var count=cipher.processBytes(input,0,input.size,result,0)
      count+=cipher.doFinal(result,count)
      check(count==result.size)
      return result
    } catch(error:Exception) { output?.fill(0);throw error }
    finally { key.fill(0);nonce.fill(0);aad.fill(0);input.fill(0) }
  }
}
