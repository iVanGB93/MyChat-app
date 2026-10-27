package expo.modules.axonicnearby
import java.io.File
import java.nio.file.Files
import java.security.MessageDigest
import org.junit.Assert.*
import org.junit.Test
class AttachmentPreparationTest {
 private val owner="axonic:1:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
 private val id="bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
 private val key="0101010101010101010101010101010101010101010101010101010101010101"
 @Test fun streamBlockMatchesIndependentNobleVectorAndTail(){
  val root=Files.createTempDirectory("attachment-stream-test").toFile()
  try {
   val dir=File(root,"axonic-own-attachments-v1/${owner.substring(9)}/staging/$id");dir.mkdirs()
   File(dir,"content").writeBytes(ByteArray(3_000_017){(it%251).toByte()})
   val output=File(dir,"ciphertext");output.writeBytes(byteArrayOf())
   val receiver="axonic:1:"+"c".repeat(64);val device="d".repeat(64)
   val expected=listOf("58e55c5dfc0923370018f1676dd62ace06d4be0720e9e19e9f2d2c9451185b6f","0718614843d4513b3f07f7842b20874eae97ac3c3df471e5cb57abce07ec1845")
   for(index in 0..1){
    val aad="[\"axonic-attachment-block-v3\",\"$id\",\"$owner\",\"$receiver\",\"$device\",3000017,$index]"
    assertEquals(listOf(expected[index]),AttachmentPreparation.encrypt(root,owner,id,key,3_000_017, index,listOf(aad),3_000_000))
   }
   assertEquals(3_000_049L,output.length())
   assertEquals("a4af20ae88e1c6c851e3fab3a3cc834b548690f158e330f590fa46928f1af18d",MessageDigest.getInstance("SHA-256").digest(output.readBytes()).joinToString(""){"%02x".format(it)})
  }finally{root.deleteRecursively()}
 }

 @Test fun legacyFormatsAreRejectedWithoutWritingCiphertext(){
  val root=Files.createTempDirectory("attachment-native-rejection-test").toFile()
  try {
   val dir=File(root,"axonic-own-attachments-v1/${owner.substring(9)}/staging/$id");dir.mkdirs()
   File(dir,"content").writeBytes(ByteArray(4097){(it%251).toByte()})
   val output=File(dir,"ciphertext");output.writeBytes(byteArrayOf())
   for(version in 1..2){
    val aad="[\"axonic-attachment-chunk-v$version\",\"$id\",4097,0]"
    assertThrows(IllegalArgumentException::class.java){AttachmentPreparation.encrypt(root,owner,id,key,4097,0,listOf(aad))}
    assertThrows(IllegalArgumentException::class.java){AttachmentPreparation.encrypt(root,owner,id,key,4097,0,listOf(aad),4096)}
    assertEquals(0L,output.length())
   }
   val aad="[\"axonic-attachment-block-v3\",\"$id\",4097,0]"
   assertThrows(IllegalArgumentException::class.java){AttachmentPreparation.encrypt(root,owner,"../outside",key,4097,0,listOf(aad))}
   assertThrows(IllegalArgumentException::class.java){AttachmentPreparation.encrypt(root,owner,id,key,4097,1,listOf(aad))}
   assertThrows(IllegalArgumentException::class.java){AttachmentPreparation.encrypt(root,owner,id,"00",4097,0,listOf(aad))}
  }finally{root.deleteRecursively()}
 }
}
