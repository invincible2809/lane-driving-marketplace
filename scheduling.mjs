export const ukParts = instant => {
 const fields=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/London',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(instant));
 const p=Object.fromEntries(fields.map(x=>[x.type,x.value]));return {day:`${p.year}-${p.month}-${p.day}`,time:`${p.hour}:${p.minute}`,hour:Number(p.hour),weekday:new Date(`${p.year}-${p.month}-${p.day}T12:00:00Z`).getUTCDay()};
};
export function ukInstant(day,time) {
 if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(time))throw new Error('Choose a valid date and time.');
 const target=Date.parse(`${day}T${time}:00Z`);if(!Number.isFinite(target)||new Date(target).toISOString().slice(0,10)!==day)throw new Error('Choose a valid date.');
 const candidates=[target,target-3600000].filter(t=>{const p=ukParts(t);return p.day===day&&p.time===time});
 if(candidates.length!==1)throw new Error('That UK time is missing or ambiguous because the clocks change. Choose another time.');
 return new Date(candidates[0]).toISOString();
}
export const bookingStart = b => b.starts_at||b.start;
export const bookingEnd = b => b.ends_at||new Date(Date.parse(b.start)+b.duration*3600000).toISOString();
export function availableStarts(slot,bookings,blackouts,buffer=0,duration=2,ignoreId=null) {
 const result=[];const now=Date.now();const milliseconds=duration*3600000;const gap=buffer*60000;
 for(let at=Date.parse(slot.start);at+milliseconds<=Date.parse(slot.end);at+=1800000){
 if(at<=now||slot.blocked)continue;const end=at+milliseconds;
 if(blackouts.some(b=>Date.parse(b.start)<end&&Date.parse(b.end)>at))continue;
 if(bookings.some(b=>b.id!==ignoreId&&['confirmed','pending'].includes(b.status)&&Date.parse(bookingStart(b))<end+gap&&Date.parse(bookingEnd(b))>at-gap))continue;
 result.push(new Date(at).toISOString());
 }
 return result;
}
