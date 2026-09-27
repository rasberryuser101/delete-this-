import { expect,it } from 'vitest';
import { PhotoChannel,CHUNK_BYTES } from '../src/photoChannel';
import { receivePhoto,transferPhoto,type PhotoMetadata } from '../src/transfer';
import { channelPair } from './fakeChannel';
it('überträgt 400 KB durch die echten neuen RTC-Wire-Handler mit Chunking und ACK',async()=>{
 const {a,b}=channelPair();const bytes=new Uint8Array(400000);bytes.set([255,216,255]);
 const meta:PhotoMetadata={version:2,id:'photo',roundId:'round',bytes:bytes.length,mime:'image/jpeg'};let received:Blob|null=null;
 const host=new PhotoChannel(a.asRTC(),'guest',()=>true,async(data,{metadata})=>{received=await receivePhoto(data,metadata as PhotoMetadata,async()=>{});return {ok:true,id:meta.id,roundId:meta.roundId};},'PUBLIC');
 const guest=new PhotoChannel(b.asRTC(),'host',()=>true,async()=>{throw new Error();},'PRIVATE');
 const progress:number[]=[];await transferPhoto({request:(data,opts)=>guest.request(data,opts),onRequest:null},'host',new Blob([bytes],{type:meta.mime}),meta,new AbortController().signal,n=>progress.push(n));
 expect((received as Blob|null)?.size).toBe(400000);expect(progress.at(-1)).toBe(100);expect(b.sent.filter(x=>x instanceof ArrayBuffer)).toHaveLength(Math.ceil(400000/CHUNK_BYTES));expect(b.sent.every(x=>typeof x==='string'||x.byteLength<=16384)).toBe(true);
 host.close();guest.close();expect(host.active+guest.active).toBe(0);
});
