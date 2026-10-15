const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const target='node_modules/@react-native-async-storage/async-storage/android/src/main/java/com/reactnativecommunity/asyncstorage/ReactDatabaseSupplier.java';
const edits=[
 ['super(context, DATABASE_NAME, null, DATABASE_VERSION);','super(context, DATABASE_NAME, null, DATABASE_VERSION, db -> { throw new SQLiteException("AXONIC_STORAGE_CORRUPT"); });'],
 ['BuildConfig.AsyncStorage_db_size * 1024L * 1024L','64L * 1024L * 1024L /* Axonic bounded storage ceiling */'],
 ['      deleteDatabase();\n      onCreate(db);','      throw new SQLiteException("AXONIC_STORAGE_SCHEMA_UNSUPPORTED");'],
 ['        if (tries > 0) {\n          deleteDatabase();\n        }\n','        // Axonic: never delete user data to recover an open failure.\n'],
 ['    // Sometimes retrieving the database fails. We do 2 retries: first without database deletion\n    // and then with deletion.','    // Retry opening once, preserving original files on both attempts.'],
 ['      // Clearing the database has failed, delete it instead.\n      if (deleteDatabase()) {\n        FLog.d(ReactConstants.TAG, "Deleted Local Database " + DATABASE_NAME);\n        return;\n      }','      // Axonic: propagate clear failure instead of deleting the database.'],
];
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
function patch(input){const source=input.replace(/\r\n/g,'\n');let original=source;for(const [before,after] of [...edits].reverse())original=original.replace(after,before);if(hash(original)!=='532da53a2921284fdc575c582efb8d6a0bb0752364218459e81f4abf82c09d8e')throw Error('AsyncStorage source changed; safety patch review required');return edits.reduce((s,[before,after])=>s.replace(before,after),original);}
if(require.main===module){const file=path.resolve(__dirname,'..',target),source=fs.readFileSync(file,'utf8'),next=patch(source);if(source!==next)fs.writeFileSync(file,next);console.log('AsyncStorage non-destructive recovery and 64 MiB ceiling ready');}
module.exports={patch,target};
