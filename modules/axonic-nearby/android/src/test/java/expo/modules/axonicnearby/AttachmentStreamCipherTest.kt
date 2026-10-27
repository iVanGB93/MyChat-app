package expo.modules.axonicnearby
import java.security.MessageDigest
import org.junit.Assert.*
import org.junit.Test

class AttachmentStreamCipherTest {
 private fun key()=ByteArray(32){it.toByte()}
 private fun nonce()=ByteArray(24){(it+32).toByte()}
 private fun aad()="[\"axonic-wss-stream-v1\",\"fixture\"]".toByteArray()
 private fun crypt(encrypt:Boolean,input:ByteArray)=AttachmentStreamCipher.crypt(encrypt,key(),nonce(),aad(),input.copyOf())
 @Test fun matchesIndependentNobleVectorsAndClearsNativeInputs(){
  val expected=mapOf(2 to "5f18f98ddcabb7f42cfe36754893996d4205261bf5c52debfc3fce8bd36911de",1025 to "f82c46bc5f81b544005e4c076afaf0017be906ea0940146765487fb35985d57a",8193 to "a68e5e4878d3b41688e0133189b3760b9f971b30147fb046964bf0a5172b448b",32769 to "bc368e0bcfb46bbd0005dbeb46e6b05816b1c43f3e9b68a97eb455a9fee0e745")
  for((size,hash) in expected){
   val plain=ByteArray(size){(it%251).toByte()};val k=key();val n=nonce();val a=aad();val input=plain.copyOf()
   val encrypted=AttachmentStreamCipher.crypt(true,k,n,a,input)
   assertEquals(hash,MessageDigest.getInstance("SHA-256").digest(encrypted).joinToString(""){"%02x".format(it)})
   assertArrayEquals(plain,crypt(false,encrypted))
   for(bytes in listOf(k,n,a,input))assertTrue(bytes.all {it==0.toByte()})
   encrypted[encrypted.lastIndex]=(encrypted.last().toInt() xor 1).toByte()
   assertThrows(Exception::class.java){crypt(false,encrypted)}
  }
 }
 @Test fun rejectsWrongAadNonceKeyAndBounds(){
  val encrypted=crypt(true,ByteArray(33){7})
  for(which in 0..2){val k=key();val n=nonce();val a=aad();when(which){0->k[0]=99;1->n[0]=99;else->a[a.lastIndex-2]=99}
   assertThrows(Exception::class.java){AttachmentStreamCipher.crypt(false,k,n,a,encrypted.copyOf())}
  }
  for(size in listOf(0,1,32770))assertThrows(IllegalArgumentException::class.java){crypt(true,ByteArray(size))}
  for(size in listOf(0,17,32786))assertThrows(IllegalArgumentException::class.java){crypt(false,ByteArray(size))}
 }
}
