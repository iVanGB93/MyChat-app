import type {TextInput as NativeTextInput} from 'react-native';
import {KeyboardAwareTextInput as TextInput} from './KeyboardForm';
import React, {useRef, useState} from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import {useTheme} from '../../contexts/ThemeContext';

/** Local-only phrase editor. Box numbers are presentation, never phrase content. */
export default function RecoveryWordsInput({value,onChangeText,editable=true}:{value:string;onChangeText:(value:string)=>void;editable?:boolean}) {
  const {colors}=useTheme();
  const [editing,setEditing]=useState<number|null>(null);
  const tail=useRef<NativeTextInput>(null);
  const parts=value.trim().split(/\s+/).filter(Boolean);
  const trailing=/\s$/.test(value);
  const complete=trailing?parts:parts.slice(0,-1);
  const draft=trailing?'':parts.at(-1)??'';
  const write=(words:string[],last:string)=>{const next=[...words,last].join(' ');if(next.length<=512)onChangeText(next);};
  const changeWord=(index:number,text:string)=>{
    const next=[...complete];
    // Preserve this word's position when correcting it or pasting replacements.
    const replacements=text.trim().split(/\s+/).filter(Boolean);
    next.splice(index,1,...replacements);
    write(next,draft);
    if(/\s/.test(text)||!text){setEditing(null);tail.current?.focus();}
  };
  const inputStyle={color:colors.text,fontSize:16,padding:10,minWidth:90};
  return <View style={styles.container}>
    <Text style={{color:colors.textSecondary}}>RECOVERY WORDS</Text>
    <View style={[styles.words,{borderColor:colors.border,backgroundColor:colors.background}]}>
      {complete.map((word,index)=>editing===index?
        <TextInput key={index} autoFocus accessibilityLabel={`Edit recovery word ${index+1}`} value={word}
          onChangeText={text=>changeWord(index,text)} onBlur={()=>setEditing(null)} editable={editable}
          autoCapitalize="none" autoCorrect={false} autoComplete="off" textContentType="none" style={inputStyle}/>
        :<Pressable key={index} disabled={!editable} onPress={()=>setEditing(index)} accessibilityRole="button"
          accessibilityLabel={`Recovery word ${index+1}: ${word}. Tap to edit.`}
          style={[styles.word,{borderColor:colors.neonBorder,backgroundColor:colors.surface}]}>
          <Text style={{color:colors.textSecondary,fontSize:12}}>{index+1}</Text>
          <Text style={{color:colors.text,fontSize:16}}>{word}</Text>
        </Pressable>)}
      <TextInput ref={tail} accessibilityLabel="Next recovery word" placeholder={`Word ${complete.length+1}`}
        placeholderTextColor={colors.textSecondary} value={draft} editable={editable}
        onChangeText={text=>{if([...complete,text].join(' ').length<=512)write(complete,text.toLowerCase());}}
        onKeyPress={e=>{if(e.nativeEvent.key==='Backspace'&&!draft&&complete.length){setEditing(complete.length-1);}}}
        autoCapitalize="none" autoCorrect={false} autoComplete="off" textContentType="none" multiline style={[inputStyle,styles.tail]}/>
    </View>
    <Text style={{color:colors.textSecondary,fontSize:13}}>Type a space after each word to put it in a box. Tap a box to edit it. You can also paste the whole phrase.</Text>
  </View>;
}
const styles=StyleSheet.create({container:{gap:8},words:{flexDirection:'row',flexWrap:'wrap',alignItems:'center',gap:8,borderWidth:1,borderRadius:12,padding:10},word:{flexDirection:'row',alignItems:'center',gap:6,borderWidth:1,borderRadius:8,paddingHorizontal:10,paddingVertical:10},tail:{flexGrow:1}});
