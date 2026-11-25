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
            val reported = resolver.getType(uri)?.substringBefore(';')?.lowercase()
            val mime = reported?.takeUnless { it == "application/octet-stream" }
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
const metadata=replacement.slice(0,replacement.indexOf('        fun handleShareIntent'));
function patch(input){
 let source=input.replace(/\r\n/g,'\n');
 if(source.includes(marker)){
  const legacyMetadata=metadata.replace(`val reported = resolver.getType(uri)?.substringBefore(';')?.lowercase()\n            val mime = reported?.takeUnless { it == "application/octet-stream" }`,'val mime = resolver.getType(uri)');
  if(source.includes(legacyMetadata))source=source.replace(legacyMetadata,metadata);
  if(!source.includes(metadata))throw Error('Share-intent patch changed; review required');
  return patchDelivery(source);
 }
 if(crypto.createHash('sha256').update(source).digest('hex')!==original)throw Error('Unsupported share-intent source; review required');
 const start=source.indexOf('        @SuppressLint("Range")'),end=source.indexOf('        fun handleShareIntent(intent: Intent) {',start);
 if(start<0||end<0)throw Error('Share-intent patch anchor missing');
 return patchDelivery(source.slice(0,start)+replacement+source.slice(end).replace('fun handleShareIntent(intent: Intent)','private fun handleShareIntentChecked(intent: Intent)'));
}
function replaceChecked(source,from,to){if(source.includes(to))return source;if(!source.includes(from))throw Error('Unsupported share-intent lifecycle source; review required');return source.replace(from,to);}
const deliveryMarker='// Axonic: consume the newest Android share once on the native modules queue.';
function patchDelivery(source){
 if(source.includes(deliveryMarker))return source;
 const notify=source.indexOf('        private fun notifyShareIntent');
 const intake=source.indexOf('        '+marker);
 const handler=source.indexOf('        fun handleShareIntent(intent: Intent)');
 const parcel=source.indexOf('        /*\n         * https://stackoverflow',handler);
 const start=source.indexOf('        AsyncFunction("getShareIntent")');
 const end=source.indexOf('        OnCreate {',start);
 if(notify<0||intake<notify||handler<intake||parcel<handler||start<parcel||end<start)throw Error('Unsupported share-intent delivery source');
 const lifecycle=`        ${deliveryMarker}
        AsyncFunction("getShareIntent") { _: String ->
            val pending = synchronized(ExpoShareIntentSingleton) {
                val intent = ExpoShareIntentSingleton.intent
                ExpoShareIntentSingleton.intent = null
                ExpoShareIntentSingleton.isPending = false
                intent?.let { it to generation }
            } ?: return@AsyncFunction
            val payload = try { readShare(pending.first) } catch (_: Exception) { null }
            synchronized(ExpoShareIntentSingleton) {
                if (pending.second == generation && instance === this@ExpoShareIntentModule) {
                    if (payload == null) sendEvent("onError", mapOf("value" to "Unable to read this share. Try sharing it again."))
                    else sendEvent("onChange", mapOf("value" to payload))
                }
            }
        }

        Function("clearShareIntent") { _: String ->
            synchronized(ExpoShareIntentSingleton) {
                generation++
                ExpoShareIntentSingleton.intent = null
                ExpoShareIntentSingleton.isPending = false
            }
        }

        Function("hasShareIntent") { _: String ->
            synchronized(ExpoShareIntentSingleton) { ExpoShareIntentSingleton.isPending }
        }

        OnNewIntent { incoming ->
            if (incoming.action == Intent.ACTION_SEND || incoming.action == Intent.ACTION_SEND_MULTIPLE) {
                synchronized(ExpoShareIntentSingleton) {
                    generation++
                    ExpoShareIntentSingleton.intent = Intent(incoming)
                    ExpoShareIntentSingleton.isPending = true
                    sendEvent("onStateChange", mapOf("value" to "pending"))
                }
            }
        }

`;
 const read=`        private fun readShare(intent: Intent): Map<String, Any?>? {
            val clip = intent.clipData
            val uris = when (intent.action) {
                Intent.ACTION_SEND -> listOfNotNull(intent.parcelable<Uri>(Intent.EXTRA_STREAM)
                    ?: intent.data?.takeIf { it.scheme == "content" || it.scheme == "file" }
                    ?: clip?.takeIf { it.itemCount > 0 }?.getItemAt(0)?.uri)
                Intent.ACTION_SEND_MULTIPLE -> intent.parcelableArrayList<Uri>(Intent.EXTRA_STREAM)
                    ?.takeIf { it.isNotEmpty() }
                    ?: clip?.let { (0 until it.itemCount).mapNotNull { index -> it.getItemAt(index).uri } }.orEmpty()
                else -> return null
            }
            val text = intent.getCharSequenceExtra(Intent.EXTRA_TEXT)?.toString()
            if (uris.isEmpty()) {
                if (intent.action != Intent.ACTION_SEND || intent.hasExtra(Intent.EXTRA_STREAM) ||
                    intent.type?.startsWith("text/") != true || text.isNullOrBlank()) return null
                return mapOf("text" to text, "type" to "text", "meta" to mapOf("title" to intent.getCharSequenceExtra(Intent.EXTRA_TITLE)?.toString()))
            }
            require(uris.size <= 4)
            val files = uris.map { uri ->
                val file = getFileInfo(uri)
                if (intent.type?.substringBefore(';')?.equals("application/pdf", ignoreCase = true) == true) {
                    val mime = file["mimeType"]
                    require(mime == "application/pdf" || mime == "application/octet-stream")
                    file + ("mimeType" to "application/pdf")
                } else file
            }
            return mapOf("files" to files, "text" to text, "type" to "file")
        }

`;
 return source.slice(0,notify)+'        private var generation = 0L\n        private fun notifyError(message: String) { instance?.sendEvent("onError", mapOf("value" to message)) }\n\n'+source.slice(intake,handler)+read+source.slice(parcel,start)+lifecycle+source.slice(end);
}
function patchActivity(source){
 return replaceChecked(source,`        // only store when the new intent is not empty
        if (activity?.intent?.type != null) {
            ExpoShareIntentSingleton.intent = activity?.intent
            ExpoShareIntentSingleton.isPending = true
        }`,`        val intent = activity?.intent ?: return
        if (savedInstanceState == null && (intent.action == Intent.ACTION_SEND || intent.action == Intent.ACTION_SEND_MULTIPLE)) {
            synchronized(ExpoShareIntentSingleton) {
                ExpoShareIntentSingleton.intent = Intent(intent)
                ExpoShareIntentSingleton.isPending = true
            }
        }`);
}
function patchHook(source){
 source=replaceChecked(source,`        clearNativeModule &&`,`        clearNativeModule && Platform.OS !== "android" &&`);
 source=replaceChecked(source,`        else if (Platform.OS === "android") {
            ExpoShareIntentModule?.getShareIntent("");
        }
        else if (Platform.OS === "ios") {`,`        // Android drains after the native listeners are registered.
        else if (Platform.OS === "ios") {`);
 source=replaceChecked(source,`        setIsReady(true);
        return () => {
            changeSubscription.remove();`,`        const pendingSubscription = Platform.OS === "android" ? ExpoShareIntentModule.addListener("onStateChange", (event) => {
            if (event.value !== "pending") return;
            setSharedIntent(SHAREINTENT_DEFAULTVALUE);
            setError(null);
            ExpoShareIntentModule.getShareIntent("");
        }) : null;
        if (Platform.OS === "android") ExpoShareIntentModule.getShareIntent("");
        setIsReady(true);
        return () => {
            pendingSubscription?.remove();
            changeSubscription.remove();`);

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
 for(const [name,transform] of [['android/src/main/java/expo/modules/shareintent/ExpoShareIntentModule.kt',patch],['android/src/main/java/expo/modules/shareintent/ExpoShareIntentReactActivityLifecycleListener.kt',patchActivity],['build/useShareIntent.js',patchHook],['build/utils.js',patchParser]]){
  const file=path.join(root,name),source=fs.readFileSync(file,'utf8'),next=transform(source);if(source!==next)fs.writeFileSync(file,next);
 }
 console.log('Share-intent intake and lifecycle ready');
}
module.exports={patch,patchHook,patchParser};
