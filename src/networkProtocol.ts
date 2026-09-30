import { validateMessage, type ControlMessage } from './protocol';
import type { GuestRole } from './identity';
export type JoinRequestMessage = {type:'JOIN';id:string;role:GuestRole;name:string;publicKey:string;signature:string};
export type NetworkControl =
 | {type:'HOST';id:string;publicKey:string;signature:string}
 | JoinRequestMessage
 | {type:'APPROVED';id:string;role:GuestRole}
 | {type:'DENIED'}
 | {type:'CONTROL';requestId:string;message:ControlMessage;ack?:false}
 | {type:'ACK';requestId:string;ok:boolean};
export const safeId=(v:unknown):v is string=>typeof v==='string'&&/^[\w-]{1,100}$/.test(v);
const fields:Record<NetworkControl['type'],string[]>={HOST:['type','id','publicKey','signature'],JOIN:['type','id','role','name','publicKey','signature'],APPROVED:['type','id','role'],DENIED:['type'],CONTROL:['type','requestId','message','ack'],ACK:['type','requestId','ok']};
export function parseNetwork(value:unknown):NetworkControl|null {
 if(!value||typeof value!=='object'||Array.isArray(value))return null;
 let size:number;try{size=JSON.stringify(value).length;}catch{return null;}if(size>32000)return null;
 const v=value as Record<string,unknown>,allowed=fields[v.type as NetworkControl['type']];
 if(!allowed||Object.keys(v).some(k=>!allowed.includes(k)))return null;
 if(v.type==='DENIED')return {type:'DENIED'};
 if(v.type==='CONTROL'&&safeId(v.requestId)){const message=validateMessage(v.message);if(!message||(v.ack!==undefined&&(v.ack!==false||message.type!=='reaction')))return null;return {type:'CONTROL',requestId:v.requestId,message,...(v.ack===false?{ack:false as const}:{})};}
 if(v.type==='ACK'&&safeId(v.requestId)&&typeof v.ok==='boolean')return {type:'ACK',requestId:v.requestId,ok:v.ok};
 if(!safeId(v.id))return null;
 if(v.type==='APPROVED'&&['PLAYER','DISPLAY'].includes(v.role as string))return v as NetworkControl;
 if(typeof v.publicKey!=='string'||!/^04[\da-f]{128}$/.test(v.publicKey)||typeof v.signature!=='string'||!/^[\da-f]{128}$/.test(v.signature))return null;
 if(v.type==='HOST')return v as NetworkControl;
 if(v.type==='JOIN'&&['PLAYER','DISPLAY'].includes(v.role as string)&&typeof v.name==='string'&&v.name.trim().length>0&&v.name.length<=30)return v as NetworkControl;
 return null;
}
