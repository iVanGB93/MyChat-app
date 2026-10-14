package expo.modules.axonicnearby

import java.io.File
import java.io.RandomAccessFile
import java.security.MessageDigest
import org.bouncycastle.crypto.modes.XChaCha20Poly1305
import org.bouncycastle.crypto.params.AEADParameters
import org.bouncycastle.crypto.params.KeyParameter

/** Bounded encryption of private staged files, using the existing wire format. */
internal object AttachmentPreparation {
  private fun hex(bytes: ByteArray): String {
    val alphabet="0123456789abcdef"
    return buildString(bytes.size*2) { for(b in bytes) { val n=b.toInt() and 255;append(alphabet[n ushr 4]);append(alphabet[n and 15]) } }
  }
  @Synchronized fun encrypt(rootDir:File,owner:String,id:String,keyHex:String,total:Long,start:Int,aads:List<String>):List<String> {
    require(owner.matches(Regex("axonic:1:[0-9a-f]{64}")) && id.matches(Regex("[0-9a-f]{64}")))
    require(keyHex.matches(Regex("[0-9a-f]{64}")) && total in 1..250L*1024*1024)
    require(start>=0 && aads.size in 1..128 && start.toLong()+aads.size<=(total+4095)/4096)
    require(aads.all { it.length in 1..1024 && it.all { c -> c.code<128 } })
    val dir=File(rootDir.canonicalFile,"axonic-own-attachments-v1/${owner.substring(9)}/staging/$id")
    val content=File(dir,"content");val output=File(dir,"ciphertext")
    require(content.canonicalFile==content.absoluteFile && output.canonicalFile==output.absoluteFile)
    require(content.isFile && content.length()==total && output.isFile && output.length()==start.toLong()*4112)
    val key=ByteArray(32) { keyHex.substring(it*2,it*2+2).toInt(16).toByte() }
    val plain=ByteArray(4096);val encrypted=ByteArray(4112);val leaves=ArrayList<String>(aads.size)
    try {
      RandomAccessFile(content,"r").use { input -> RandomAccessFile(output,"rw").use { out ->
        input.seek(start.toLong()*4096);out.seek(start.toLong()*4112)
        for((offset,canonical) in aads.withIndex()) {
          check(!Thread.currentThread().isInterrupted) { "Attachment preparation cancelled" }
          val index=start+offset;val length=minOf(4096L,total-index.toLong()*4096).toInt()
          input.readFully(plain,0,length)
          val aad=canonical.toByteArray(Charsets.US_ASCII)
          val nonce=MessageDigest.getInstance("SHA-256").digest(aad).copyOf(24)
          val cipher=XChaCha20Poly1305()
          cipher.init(true,AEADParameters(KeyParameter(key),128,nonce,aad))
          var count=cipher.processBytes(plain,0,length,encrypted,0)
          count+=cipher.doFinal(encrypted,count)
          check(count==length+16)
          out.write(encrypted,0,count)
          leaves.add(AttachmentHash.sha256("[\"axonic-attachment-leaf-v1\",$index,\"${hex(encrypted.copyOf(count))}\"]"))
          plain.fill(0);encrypted.fill(0)
        }
        require(input.length()==total)
      } }
      return leaves
    } finally { key.fill(0);plain.fill(0);encrypted.fill(0) }
  }
}
