/** Scroll just enough to keep the field and a nearby action above the keyboard. */
export function keyboardScrollDelta(fieldTop:number,fieldHeight:number,viewportTop:number,viewportHeight:number,keyboardTop:number){
 const top=viewportTop+12,bottom=Math.min(viewportTop+viewportHeight,keyboardTop)-96;
 if(fieldTop<top)return fieldTop-top;
 // For a tall multiline field, prioritize its top rather than overscrolling it.
 const visibleHeight=Math.max(0,bottom-top);
 return Math.max(0,fieldTop+Math.min(fieldHeight,visibleHeight)-bottom);
}
