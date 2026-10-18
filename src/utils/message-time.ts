/** Construct once per visible-screen context, not once per message render.
 * Callers recreate on focus/resume so system locale/time-zone changes apply. */
export function createMessageTimeFormatter(locales:string|string[]=[],timeZone?:string){
 const options:Intl.DateTimeFormatOptions={hour:'2-digit',minute:'2-digit',...(timeZone?{timeZone}:{})};
 const formatter=new Intl.DateTimeFormat(locales,options);
 return (at:number)=>{const date=new Date(at);return Number.isNaN(date.getTime())?date.toLocaleTimeString(locales,options):formatter.format(date);};
}
