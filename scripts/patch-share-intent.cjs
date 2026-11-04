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
function patch(input){const source=input.replace(/\r\n/g,'\n');if(source.includes(marker)){if(!source.includes(replacement))throw Error('Share-intent patch changed; review required');return patchLifecycle(source);}
 if(crypto.createHash('sha256').update(source).digest('hex')!==original)throw Error('Unsupported share-intent source; review required');
 const start=source.indexOf('        @SuppressLint("Range")'),end=source.indexOf('        fun handleShareIntent(intent: Intent) {',start);
 if(start<0||end<0)throw Error('Share-intent patch anchor missing');
 return patchLifecycle((source.slice(0,start)+replacement+source.slice(end).replace('fun handleShareIntent(intent: Intent)','private fun handleShareIntentChecked(intent: Intent)')).replace('mapOf( "files" to arrayOf(getFileInfo(uri), "type" to "file"))','mapOf( "files" to arrayOf(getFileInfo(uri)), "type" to "file")'));
}
function replaceChecked(source,from,to){if(source.includes(to))return source;if(!source.includes(from))throw Error('Unsupported share-intent lifecycle source; review required');return source.replace(from,to);}
function patchLifecycle(source){
 source=replaceChecked(source,`        OnNewIntent {
            handleShareIntent(it)
        }`,`        OnNewIntent {
            // Axonic: a fresh share supersedes any unconsumed launch intent.
            ExpoShareIntentSingleton.intent = null
            ExpoShareIntentSingleton.isPending = false
            currentActivity?.intent = it
            handleShareIntent(it)
        }`);
 source=replaceChecked(source,`            ExpoShareIntentSingleton.intent = null
        }

        Function("hasShareIntent")`,`            ExpoShareIntentSingleton.intent = null
            ExpoShareIntentSingleton.isPending = false
            val activity = currentActivity
            val action = activity?.intent?.action
            if (action == Intent.ACTION_SEND || action == Intent.ACTION_SEND_MULTIPLE) {
                activity?.let { it.intent = Intent(Intent.ACTION_MAIN).setComponent(it.intent.component) }
            }
        }

        Function("hasShareIntent")`);
 source=replaceChecked(source,`if (intent.type!!.startsWith("text/plain")) {`,`if (intent.type!!.startsWith("text/plain") && !intent.hasExtra(Intent.EXTRA_STREAM) && intent.clipData?.takeIf { it.itemCount > 0 }?.getItemAt(0)?.uri == null) {`);
 source=replaceChecked(source,`val uri = intent.parcelable<Uri>(Intent.EXTRA_STREAM);`,`val uri = intent.parcelable<Uri>(Intent.EXTRA_STREAM) ?: intent.clipData?.takeIf { it.itemCount > 0 }?.getItemAt(0)?.uri;`);
 source=replaceChecked(source,`mapOf( "files" to arrayOf(getFileInfo(uri)), "type" to "file")`,`mapOf( "files" to arrayOf(getFileInfo(uri)), "text" to intent.getCharSequenceExtra(Intent.EXTRA_TEXT)?.toString(), "type" to "file")`);
 source=replaceChecked(source,`val uris = intent.parcelableArrayList<Uri>(Intent.EXTRA_STREAM)`,`val uris = intent.parcelableArrayList<Uri>(Intent.EXTRA_STREAM) ?: intent.clipData?.let { clip -> ArrayList((0 until clip.itemCount).mapNotNull { clip.getItemAt(it).uri }) }`);
 source=replaceChecked(source,`if (uris != null) {`,`if (!uris.isNullOrEmpty()) {`);
 source=replaceChecked(source,`mapOf( "files" to uris.map { getFileInfo(it) }, "type" to "file")`,`mapOf( "files" to uris.map { getFileInfo(it) }, "text" to intent.getCharSequenceExtra(Intent.EXTRA_TEXT)?.toString(), "type" to "file")`);
 return source;
}
function patchHook(source){
 source=replaceChecked(source,`setSharedIntent(parseShareIntent(event.value, options));`,`setError(null);
                setSharedIntent(parseShareIntent(event.value, options));`);
 source=replaceChecked(source,`setError("Cannot parse share intent value !");`,`setSharedIntent(SHAREINTENT_DEFAULTVALUE);
                setError("Cannot parse share intent value !");`);
 source=replaceChecked(source,`setError(event?.value);`,`setSharedIntent(SHAREINTENT_DEFAULTVALUE);
            setError(event?.value);`);
 return source;
}
function patchParser(source){
 source=replaceChecked(source,`if (shareIntent?.text) {`,`if (shareIntent?.text && !shareIntent?.files?.length) {`);
 source=replaceChecked(source,`files.every((file) => file.mimeType.startsWith("image/") ||
            file.mimeType.startsWith("video/"))`,`files.every((file) => file.mimeType?.startsWith("image/") ||
            file.mimeType?.startsWith("video/"))`);
 source=replaceChecked(source,`files: shareIntent?.files
`,`text: shareIntent?.text || null,
            files: shareIntent?.files
`);
 return source;
}
if(require.main===module){
 const root=path.resolve(__dirname,'../node_modules/expo-share-intent');
 for(const [name,transform] of [['android/src/main/java/expo/modules/shareintent/ExpoShareIntentModule.kt',patch],['build/useShareIntent.js',patchHook],['build/utils.js',patchParser]]){
  const file=path.join(root,name),source=fs.readFileSync(file,'utf8'),next=transform(source);if(source!==next)fs.writeFileSync(file,next);
 }
 console.log('Share-intent intake and lifecycle ready');
}
module.exports={patch,patchHook,patchParser};
