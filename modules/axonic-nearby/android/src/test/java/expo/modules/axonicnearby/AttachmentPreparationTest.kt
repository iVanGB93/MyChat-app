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

 @Test fun version1MatchesIndependentNobleCiphertextAndLeaves(){
 val root=Files.createTempDirectory("attachment-native-test").toFile()
 try {
 val dir=File(root,"axonic-own-attachments-v1/${owner.substring(9)}/staging/$id");dir.mkdirs()
 File(dir,"content").writeBytes(ByteArray(4097){(it%251).toByte()});val output=File(dir,"ciphertext");output.writeBytes(byteArrayOf())
 val aads=listOf("[\"axonic-attachment-chunk-v1\",\"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\",\"axonic:1:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\",\"axonic:1:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc\",\"dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd\",4097,0]","[\"axonic-attachment-chunk-v1\",\"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\",\"axonic:1:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\",\"axonic:1:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc\",\"dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd\",4097,1]")
 assertEquals(listOf("2b6c675d5d5f059b29e7ec3a34556b506b086add51fe0006e4221feedfb2e9ed"),AttachmentPreparation.encrypt(root,owner,id,key,4097,0,aads.take(1)))
 assertEquals(listOf("838fb6115e46d68cabfb62c401f30159d46e6a2f9788d195f01e3d8ec26edd0a"),AttachmentPreparation.encrypt(root,owner,id,key,4097,1,aads.drop(1)))
 assertEquals("a89f2611c92ece46098e6153c59c5dde0b6026afdbbdff58c9777dddc5fff01c",MessageDigest.getInstance("SHA-256").digest(output.readBytes()).joinToString(""){"%02x".format(it)})
 assertThrows(IllegalArgumentException::class.java){AttachmentPreparation.encrypt(root,owner,id,key,4097,0,aads)}
 assertThrows(IllegalArgumentException::class.java){AttachmentPreparation.encrypt(root,owner,"../outside",key,4097,0,aads)}
 }finally{root.deleteRecursively()}
 }

 @Test fun version2MatchesIndependentNobleCiphertextAndLeaves(){
 val root=Files.createTempDirectory("attachment-native-test").toFile()
 try {
 val dir=File(root,"axonic-own-attachments-v1/${owner.substring(9)}/staging/$id");dir.mkdirs()
 File(dir,"content").writeBytes(ByteArray(4097){(it%251).toByte()});val output=File(dir,"ciphertext");output.writeBytes(byteArrayOf())
 val aads=listOf("[\"axonic-attachment-chunk-v2\",\"eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee\",\"axonic:1:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\",\"ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff\",2,4097,0]","[\"axonic-attachment-chunk-v2\",\"eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee\",\"axonic:1:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\",\"ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff\",2,4097,1]")
 assertEquals(listOf("16737bcb7bc2f0bcae9dd7aba38d1ead9e5251cc4ea1fcf1a900318a42fe4152"),AttachmentPreparation.encrypt(root,owner,id,key,4097,0,aads.take(1)))
 assertEquals(listOf("9a0963aab33a89d8877d3b89eb489214c4a1835a584e412736df4b5f35c7fd91"),AttachmentPreparation.encrypt(root,owner,id,key,4097,1,aads.drop(1)))
 assertEquals("2fda7ec573e56bbfa2a0cc081276d36fee99b4b8c001be7a0b9909c3c18e4dc3",MessageDigest.getInstance("SHA-256").digest(output.readBytes()).joinToString(""){"%02x".format(it)})
 assertThrows(IllegalArgumentException::class.java){AttachmentPreparation.encrypt(root,owner,id,key,4097,0,aads)}
 assertThrows(IllegalArgumentException::class.java){AttachmentPreparation.encrypt(root,owner,"../outside",key,4097,0,aads)}
 }finally{root.deleteRecursively()}
 }

}