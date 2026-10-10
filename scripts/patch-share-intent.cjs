const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const marker='// Axonic: metadata-only share intake; copy only when the user sends.';
const original='157fad3c5d10fedd3303ea5908981467cee3020600813d97207028c76aa50e0b';
const replacement=`        ${marker}
        private fun getFileInfo(uri: Uri): Map<String, String?> {
            require(uri.scheme == "content" || uri.scheme == "file") { "Unsupported shared file" }
            val resolver = instance?.context?.contentResolver ?: error("Share context unavailable")
            var name = uri.lastPathSegment ?: "Attachment"
            var size: String? = null
            if (uri.scheme == "content") {
                resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use { cursor ->
                    if (cursor.moveToFirst()) {
                        val nameColumn = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                        val sizeColumn = cursor.getColumnIndex(OpenableColumns.SIZE)
                        if (nameColumn >= 0 && !cursor.isNull(nameColumn)) name = cursor.getString(nameColumn)
                        if (sizeColumn >= 0 && !cursor.isNull(sizeColumn)) size = cursor.getString(sizeColumn)
                    }
                }
            } else {
                val file = File(uri.path ?: error("Missing file path"))
                name = file.name
                if (file.isFile) size = file.length().toString()
            }
            val mime = resolver.getType(uri)
                ?: MimeTypeMap.getSingleton().getMimeTypeFromExtension(name.substringAfterLast('.', "").lowercase())
                ?: "application/octet-stream"
            return mapOf("contentUri" to uri.toString(),
                "filePath" to if (uri.scheme == "file") uri.path else null,
                "fileName" to name, "fileSize" to size, "mimeType" to mime)
        }

        fun handleShareIntent(intent: Intent) {
            try { handleShareIntentChecked(intent) }
            catch (_: Exception) { notifyError("Unable to read this shared file. Try sharing it again.") }
        }

`;
function patch(input){const source=input.replace(/\r\n/g,'\n');if(source.includes(marker)){if(!source.includes(replacement))throw Error('Share-intent patch changed; review required');return source;}
 if(crypto.createHash('sha256').update(source).digest('hex')!==original)throw Error('Unsupported share-intent source; review required');
 const start=source.indexOf('        @SuppressLint("Range")'),end=source.indexOf('        fun handleShareIntent(intent: Intent) {',start);
 if(start<0||end<0)throw Error('Share-intent patch anchor missing');
 return (source.slice(0,start)+replacement+source.slice(end).replace('fun handleShareIntent(intent: Intent)','private fun handleShareIntentChecked(intent: Intent)')).replace('mapOf( "files" to arrayOf(getFileInfo(uri), "type" to "file"))','mapOf( "files" to arrayOf(getFileInfo(uri)), "type" to "file")');
}
if(require.main===module){const file=path.resolve(__dirname,'../node_modules/expo-share-intent/android/src/main/java/expo/modules/shareintent/ExpoShareIntentModule.kt');const source=fs.readFileSync(file,'utf8'),next=patch(source);if(source!==next)fs.writeFileSync(file,next);console.log('Share-intent metadata-only intake ready');}
module.exports={patch};
