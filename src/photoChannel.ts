import { MAX_IMAGE_BYTES } from './image';
import { parsePhotoMetadata, type PhotoMetadata, type PhotoAck } from './transfer';
import type { RequestContext, RequestOptions } from './actions';
export const CHUNK_BYTES = 16 * 1024 - 40;
const HIGH_WATER = 256 * 1024;
const LOW_WATER = 64 * 1024;
export type PhotoTransferMessage =
  | {type:'TRANSFER_START';transferId:string;totalBytes:number;totalChunks:number;mimeType:string;visibility:'PRIVATE'|'PUBLIC';metadata:PhotoMetadata}
  | {type:'TRANSFER_COMPLETE';transferId:string}
  | {type:'TRANSFER_CANCEL';transferId:string}
  | {type:'TRANSFER_ACK';transferId:string;ack:PhotoAck};
// PHOTO_CHUNK is binary: 36 ASCII UUID bytes, 4-byte index, followed by image bytes.
const uuid = (v:unknown):v is string => typeof v==='string'&&/^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/.test(v);
export function parseTransfer(value:unknown):PhotoTransferMessage|null {
  if(typeof value!=='string'||value.length>1000)return null;
  try {
    const v=JSON.parse(value);if(!v||!uuid(v.transferId))return null;
    if(v.type==='TRANSFER_START') {
      const meta=parsePhotoMetadata(v.metadata);
      if(!meta||v.totalBytes!==meta.bytes||v.totalBytes>MAX_IMAGE_BYTES||v.mimeType!==meta.mime||v.totalChunks!==Math.ceil(meta.bytes/CHUNK_BYTES)||!['PUBLIC','PRIVATE'].includes(v.visibility))return null;
      return {type:v.type,transferId:v.transferId,totalBytes:v.totalBytes,totalChunks:v.totalChunks,mimeType:meta.mime,visibility:v.visibility,metadata:meta};
    }
    if(v.type==='TRANSFER_CANCEL'||v.type==='TRANSFER_COMPLETE')return {type:v.type,transferId:v.transferId};
    if(v.type==='TRANSFER_ACK'&&v.ack?.ok===true&&typeof v.ack.id==='string'&&typeof v.ack.roundId==='string')return v;
  }catch{/* Invalid wire input is discarded. */}return null;
}
export function waitForBuffer(channel:RTCDataChannel, signal:AbortSignal):Promise<void> {
  if(signal.aborted||channel.readyState!=='open')return Promise.reject(new Error('Fotoverbindung unterbrochen.'));
  if(channel.bufferedAmount<=HIGH_WATER)return Promise.resolve();
  channel.bufferedAmountLowThreshold=LOW_WATER;
  return new Promise((resolve,reject)=>{
    const cleanup=()=>{clearTimeout(timer);channel.removeEventListener('bufferedamountlow',ready);channel.removeEventListener('close',cancel);signal.removeEventListener('abort',cancel);};
    const ready=()=>{if(channel.bufferedAmount<=LOW_WATER){cleanup();resolve();}};
    const cancel=()=>{cleanup();reject(new Error('Fotoübertragung abgebrochen.'));};
    const timer=setTimeout(cancel,15_000);
    channel.addEventListener('bufferedamountlow',ready);channel.addEventListener('close',cancel);signal.addEventListener('abort',cancel,{once:true});ready();
  });
}
type Incoming = {meta:PhotoMetadata;visibility:'PRIVATE'|'PUBLIC';data:Uint8Array;chunks:number;next:number;timer:ReturnType<typeof setTimeout>;abort:AbortController};
/** One bounded upload per approved peer, on a genuine RTCDataChannel only. */
export class PhotoChannel {
  private incoming=new Map<string,Incoming>();
  private outgoing=new Map<string,{resolve:(ack:PhotoAck)=>void;reject:(e:Error)=>void}>();
  private lifetime=new AbortController();
  private sending=false;
  private closed=false;
  constructor(readonly channel:RTCDataChannel,private peerId:string,
    private permitted:(direction:'send'|'receive',meta:PhotoMetadata,visibility:'PRIVATE'|'PUBLIC')=>boolean,
    private receive:(data:Uint8Array,context:RequestContext)=>Promise<PhotoAck>,
    private visibility:'PRIVATE'|'PUBLIC') {
    channel.binaryType='arraybuffer';channel.bufferedAmountLowThreshold=LOW_WATER;
    channel.addEventListener('message',this.onMessage);channel.addEventListener('close',this.onClose);channel.addEventListener('error',this.onClose);
  }
  get active(){return this.incoming.size+this.outgoing.size;}
  private sendControl(message:PhotoTransferMessage){if(!this.closed&&this.channel.readyState==='open')this.channel.send(JSON.stringify(message));}
  private drop(id:string){const item=this.incoming.get(id);if(item){clearTimeout(item.timer);item.abort.abort();item.data=new Uint8Array();this.incoming.delete(id);}}
  private onMessage=(event:MessageEvent)=>{void this.handle(event.data).catch(()=>{this.close();});};
  private async handle(data:unknown) {
    if(this.closed)return;
    if(data instanceof ArrayBuffer) {
      if(data.byteLength<=40||data.byteLength>CHUNK_BYTES+40)throw new Error('Ungültiger Chunk.');
      const id=new TextDecoder().decode(new Uint8Array(data,0,36)),index=new DataView(data).getUint32(36);
      const item=this.incoming.get(id);if(!item)return;
      if(!this.permitted('receive',item.meta,item.visibility)){this.drop(id);return;}
      const expected=Math.min(CHUNK_BYTES,item.meta.bytes-item.next*CHUNK_BYTES);
      if(index!==item.next||data.byteLength-40!==expected)throw new Error('Ungültige Reihenfolge.');
      item.data.set(new Uint8Array(data,40),index*CHUNK_BYTES);item.next++;return;
    }
    const msg=parseTransfer(data);if(!msg)return;
    if(msg.type==='TRANSFER_START') {
      if(this.incoming.size||!this.permitted('receive',msg.metadata,msg.visibility)) {this.sendControl({type:'TRANSFER_CANCEL',transferId:msg.transferId});return;}
      this.incoming.set(msg.transferId,{meta:msg.metadata,visibility:msg.visibility,data:new Uint8Array(msg.totalBytes),chunks:msg.totalChunks,next:0,abort:new AbortController(),timer:setTimeout(()=>{this.drop(msg.transferId);this.sendControl({type:'TRANSFER_CANCEL',transferId:msg.transferId});},30_000)});
    } else if(msg.type==='TRANSFER_CANCEL'){this.drop(msg.transferId);this.outgoing.get(msg.transferId)?.reject(new Error('Fotoübertragung abgelehnt.'));}
    else if(msg.type==='TRANSFER_ACK')this.outgoing.get(msg.transferId)?.resolve(msg.ack);
    else {
      const item=this.incoming.get(msg.transferId);if(!item)return;
      if(item.next!==item.chunks)throw new Error('Unvollständiges Foto.');
      try {
        const ack=await this.receive(item.data,{peerId:this.peerId,metadata:item.meta,signal:item.abort.signal});
        if(!item.abort.signal.aborted)this.sendControl({type:'TRANSFER_ACK',transferId:msg.transferId,ack});
      } catch {this.sendControl({type:'TRANSFER_CANCEL',transferId:msg.transferId});}
      finally{this.drop(msg.transferId);}
    }
  }
  async request(data:Uint8Array,opts:RequestOptions):Promise<PhotoAck> {
    const meta=parsePhotoMetadata(opts.metadata);
    if(!meta||data.byteLength!==meta.bytes||!this.permitted('send',meta,this.visibility)||this.sending||this.channel.readyState!=='open')throw new Error('Fotoverbindung noch nicht bereit oder nicht freigegeben.');
    this.sending=true;const id=crypto.randomUUID();const abort=new AbortController();
    const cancel=()=>abort.abort();this.lifetime.signal.addEventListener('abort',cancel);opts.signal?.addEventListener('abort',cancel);
    if(opts.signal?.aborted||this.lifetime.signal.aborted)abort.abort();
    const timeout=setTimeout(cancel,opts.timeoutMs??30_000);
    const ack=new Promise<PhotoAck>((resolve,reject)=>{this.outgoing.set(id,{resolve,reject});});void ack.catch(()=>{});
    const aborted=()=>this.outgoing.get(id)?.reject(new Error('Fotoübertragung unterbrochen.'));
    abort.signal.addEventListener('abort',aborted);
    try {
      await waitForBuffer(this.channel,abort.signal);
      this.sendControl({type:'TRANSFER_START',transferId:id,totalBytes:meta.bytes,totalChunks:Math.ceil(meta.bytes/CHUNK_BYTES),mimeType:meta.mime,visibility:this.visibility,metadata:meta});
      for(let offset=0,index=0;offset<data.byteLength;offset+=CHUNK_BYTES,index++) {
        await waitForBuffer(this.channel,abort.signal);
        if(!this.permitted('send',meta,this.visibility))throw new Error('Freigabe beendet.');
        const slice=data.subarray(offset,offset+CHUNK_BYTES),packet=new Uint8Array(40+slice.length);
        packet.set(new TextEncoder().encode(id));new DataView(packet.buffer).setUint32(36,index);packet.set(slice,40);
        this.channel.send(packet.buffer);opts.onProgress?.((offset+slice.length)/data.length);
      }
      this.sendControl({type:'TRANSFER_COMPLETE',transferId:id});return await ack;
    } catch(e){this.sendControl({type:'TRANSFER_CANCEL',transferId:id});throw e;}
    finally {clearTimeout(timeout);this.outgoing.delete(id);this.lifetime.signal.removeEventListener('abort',cancel);opts.signal?.removeEventListener('abort',cancel);abort.signal.removeEventListener('abort',aborted);this.sending=false;}
  }
  clear(){this.lifetime.abort();this.lifetime=new AbortController();for(const id of this.incoming.keys()){this.sendControl({type:'TRANSFER_CANCEL',transferId:id});this.drop(id);}for(const [id,p] of this.outgoing){this.sendControl({type:'TRANSFER_CANCEL',transferId:id});p.reject(new Error('Runde beendet.'));}this.outgoing.clear();}
  private onClose=()=>this.close();
  close(){if(this.closed)return;this.closed=true;this.lifetime.abort();this.clear();this.channel.removeEventListener('message',this.onMessage);this.channel.removeEventListener('close',this.onClose);this.channel.removeEventListener('error',this.onClose);this.channel.close();}
}
