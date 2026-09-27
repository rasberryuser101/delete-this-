import { expect, it } from 'vitest';
// Exercise the pinned dependency's REAL serializer/reassembler, not a mock Blob transport.
// @ts-expect-error Trystero ships this runtime module without a declaration file.
import { createActionManager } from '../node_modules/@trystero-p2p/core/dist/actions.mjs';
import { receivePhoto, transferPhoto, type PhotoMetadata } from '../src/transfer';
it('überträgt 400 KB durch die echten Trystero-Wire-Handler inklusive Rückbestätigung',async()=>{
  const make=(id:string,target:string)=>{
    const peer={channel:{readyState:'open',bufferedAmount:0,bufferedAmountLowThreshold:64000},sendData:(data:Uint8Array)=>queueMicrotask(()=>other.handleData(id,data))};
    const manager=createActionManager({getPeer:(requested:string)=>requested===target?peer:undefined,getPeerIds:()=>[target],canReceiveFromPeer:()=>true});
    let other:typeof manager;
    return {manager,connect:(remote:typeof manager)=>{other=remote;}};
  };
  const host=make('host','guest'),guest=make('guest','host');host.connect(guest.manager);guest.connect(host.manager);
  const receiver=host.manager.makeAction<Uint8Array,{ok:true;id:string;roundId:string}>('photo-v3',{kind:'request'});
  const sender=guest.manager.makeAction<Uint8Array,{ok:true;id:string;roundId:string}>('photo-v3',{kind:'request'});
  const bytes=new Uint8Array(400000);bytes.set([255,216,255]);
  const meta:PhotoMetadata={version:2,id:'photo',roundId:'round',bytes:bytes.length,mime:'image/jpeg'};
  let received:Blob|null=null;
  receiver.onRequest=async(data:Uint8Array,{metadata}:{metadata?:unknown})=>{
    expect(data).toBeInstanceOf(Uint8Array);
    received=await receivePhoto(data,metadata as PhotoMetadata,async()=>{});
    return {ok:true,id:meta.id,roundId:meta.roundId};
  };
  const progress:number[]=[];
  await transferPhoto(sender,'host',new Blob([bytes],{type:meta.mime}),meta,new AbortController().signal,n=>progress.push(n));
  expect((received as Blob|null)?.size).toBe(400000);expect(progress.at(-1)).toBe(100);
  host.manager.clearPeer('guest',new Error('cleanup'));guest.manager.clearPeer('host',new Error('cleanup'));
});
