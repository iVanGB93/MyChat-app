const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const originalHash='d1ba647c0cc83019396ad996b206aa27a59b34130aa212659b4b99c33ceb2da8';
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
const marker='  // Axonic recorder lifecycle serialization v1\n';
function patch(source){
 const s=source.replace(/\r\n/g,'\n');
 if(s.includes(marker)){
  const original=s.replaceAll(marker+'  @Synchronized\n','').replace('    if (!isPrepared || recorder == null || isRecording) return\n','').replace('    if (!isRecording || recorder == null) return\n','');
  if(hash(original)!==originalHash)throw Error('expo-audio recorder patch drift; review required');return s;
 }
 if(hash(s)!==originalHash)throw Error('Unsupported expo-audio recorder source; review required');
 let result=s;
 for(const signature of ['  fun record() {','  fun pauseRecording() {','  fun stopRecording(): Bundle {','  private fun reset() {'])result=result.replace(signature,marker+'  @Synchronized\n'+signature);
 return result.replace('  fun record() {\n','  fun record() {\n    if (!isPrepared || recorder == null || isRecording) return\n').replace('  fun pauseRecording() {\n','  fun pauseRecording() {\n    if (!isRecording || recorder == null) return\n');
}
if(require.main===module){const file=path.resolve(__dirname,'../node_modules/expo-audio/android/src/main/java/expo/modules/audio/AudioRecorder.kt');const before=fs.readFileSync(file,'utf8'),after=patch(before);if(before!==after)fs.writeFileSync(file,after);console.log('Expo audio recorder lifecycle guard ready');}
module.exports={patch};
