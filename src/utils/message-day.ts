/** Compare calendar dates, not elapsed 24-hour periods (DST days differ). */
export function startsMessageDay(at:number,olderAt?:number){
 const day=new Date(at);
 if(!Number.isFinite(day.getTime()))return false;
 if(olderAt===undefined)return true;
 const older=new Date(olderAt);
 return day.getFullYear()!==older.getFullYear()||day.getMonth()!==older.getMonth()||day.getDate()!==older.getDate();
}
