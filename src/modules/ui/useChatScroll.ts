import {useEffect,useMemo,useRef,useState,type RefObject} from 'react';
import {type FlatList,type LayoutChangeEvent,type NativeScrollEvent,type NativeSyntheticEvent} from 'react-native';
import {Keyboard} from 'react-native';

// Inverted lists: this header is below the newest message. At rest it is
// scrolled out; pulling toward the bottom reveals space above floating tools.
export const CHAT_REVEAL_SPACE=56;
export function useChatScroll<T>(list:RefObject<FlatList<T>|null>,scope:string,newestKey?:string){
 const [height,setHeight]=useState(0),[showScrollToBottom,setShowScrollToBottom]=useState(false);
 const scrollButtonVisible=useRef(false);
 const state=useRef({offset:CHAT_REVEAL_SPACE,following:true,touching:false,dragging:false,momentum:false,jumping:false});
 const frame=useRef<number|undefined>(undefined);
 const pendingFollow=useRef(false),requestFollow=useRef(()=>{});
 const publishScrollButton=useMemo(()=>(visible:boolean)=>{
  if(scrollButtonVisible.current===visible)return;
  scrollButtonVisible.current=visible;
  setShowScrollToBottom(visible);
 },[]);
 useEffect(()=>{publishScrollButton(false);state.current={offset:CHAT_REVEAL_SPACE,following:true,touching:false,dragging:false,momentum:false,jumping:false};return()=>{if(frame.current!==undefined)cancelAnimationFrame(frame.current);};},[scope,publishScrollButton]);
 const listProps=useMemo(()=>{
  const follow=()=>{
   if(!state.current.following){pendingFollow.current=false;return;}
   pendingFollow.current=true;
   if(state.current.touching||state.current.dragging||state.current.momentum)return;
   if(frame.current!==undefined)cancelAnimationFrame(frame.current);
   frame.current=requestAnimationFrame(()=>{
    frame.current=undefined;
    if(state.current.following&&!state.current.touching&&!state.current.dragging&&!state.current.momentum){pendingFollow.current=false;list.current?.scrollToOffset({offset:CHAT_REVEAL_SPACE,animated:false});}
   });
  };
  requestFollow.current=follow;
  const settle=()=>{
   state.current.touching=false;state.current.dragging=false;
   // A correction from momentum-end must not start another momentum animation.
   // Android can report the rounded destination just below the requested offset,
   // causing end -> correction -> begin forever and trapping the touch responder.
   if(state.current.offset<CHAT_REVEAL_SPACE-1){
    state.current.offset=CHAT_REVEAL_SPACE;
    list.current?.scrollToOffset({offset:CHAT_REVEAL_SPACE,animated:false});
   }
   if(pendingFollow.current)follow();
  };
  return {
   contentContainerStyle:{minHeight:height+CHAT_REVEAL_SPACE},
   scrollEventThrottle:16,
   onScroll:(event:NativeSyntheticEvent<NativeScrollEvent>)=>{
    state.current.offset=event.nativeEvent.contentOffset.y;
    if(state.current.offset<=CHAT_REVEAL_SPACE+24)state.current.jumping=false;
    // Native anchoring changes offset when rows are inserted. It is not a
    // user request to stop following the bottom.
    if(state.current.jumping)state.current.following=true;
    else if(state.current.dragging||state.current.momentum)state.current.following=state.current.offset<=CHAT_REVEAL_SPACE+24;
    else if(state.current.offset<=CHAT_REVEAL_SPACE+24)state.current.following=true;
    publishScrollButton(!state.current.following);
   },
   // Yield before native scrolling has recognized the gesture. Never issue
   // corrective scroll commands in response to scroll events themselves.
   onTouchStart:()=>{state.current.touching=true;state.current.jumping=false;if(frame.current!==undefined){cancelAnimationFrame(frame.current);frame.current=undefined;}},
   onTouchEnd:()=>{state.current.touching=false;if(!state.current.dragging&&!state.current.momentum)follow();},
   onTouchCancel:()=>{state.current.touching=false;state.current.dragging=false;state.current.momentum=false;state.current.jumping=false;},
   onScrollBeginDrag:()=>{if(frame.current!==undefined){cancelAnimationFrame(frame.current);frame.current=undefined;}state.current.dragging=true;state.current.momentum=false;state.current.jumping=false;state.current.following=state.current.offset<=CHAT_REVEAL_SPACE+24;},
   onScrollEndDrag:settle,
   onMomentumScrollBegin:()=>{state.current.momentum=true;},
   onMomentumScrollEnd:()=>{state.current.momentum=false;settle();},
   onLayout:(event:LayoutChangeEvent)=>{setHeight(event.nativeEvent.layout.height);follow();},
   onContentSizeChange:follow,
  };
 },[list,scope,height,publishScrollButton]);
 // A short chat can keep the same content size when a row is inserted. Native
 // anchoring alone then leaves the new row behind the floating composer.
 useEffect(()=>{requestFollow.current();},[scope,newestKey]);
 useEffect(()=>{
  const shown=Keyboard.addListener('keyboardDidShow',()=>requestFollow.current());
  const hidden=Keyboard.addListener('keyboardDidHide',()=>requestFollow.current());
  return()=>{shown.remove();hidden.remove();};
 },[scope]);
 const scrollToBottom=useMemo(()=>()=>{
  if(frame.current!==undefined){cancelAnimationFrame(frame.current);frame.current=undefined;}
  state.current.following=true;
  state.current.jumping=true;
  state.current.dragging=false;
  state.current.momentum=false;
  list.current?.scrollToOffset({offset:CHAT_REVEAL_SPACE,animated:true});
 },[list,scope]);
 const stopFollowing=useMemo(()=>()=>{state.current.following=false;state.current.jumping=false;if(frame.current!==undefined)cancelAnimationFrame(frame.current);publishScrollButton(true);},[scope,publishScrollButton]);
 return {listProps,showScrollToBottom,scrollToBottom,stopFollowing};
}
